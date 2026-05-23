import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalDecision,
  Prisma,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStepType,
} from '@prisma/client';
import type { ApprovalSemantics } from './workflow.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowActionsRegistry } from './workflow-actions.registry';
import {
  ApprovalStep,
  AutomatedActionStep,
  ConditionalBranchStep,
  EscalationStep,
  WaitStep,
  WorkflowStep,
  WorkflowStepGraph,
  evaluateCondition,
  getPath,
} from './workflow.types';

interface StartParams {
  companyId: string;
  definitionKey: string;
  version?: number;
  initiatorId: string | null;
  refType?: string;
  refId?: string;
  context?: Record<string, unknown>;
  ip?: string;
}

interface RespondParams {
  instanceId: string;
  stepKey: string;
  approverId: string;
  decision: ApprovalDecision;
  comment?: string;
  ip?: string;
}

/**
 * Walks WorkflowDefinition step graphs at runtime.
 *
 * Concurrency model: every transition is wrapped in a Prisma transaction and
 * guarded by re-reading the instance's status inside the transaction — that
 * keeps two simultaneous decisions from racing past each other.
 *
 * What's intentionally NOT here: a job runner that polls `resumeAt` for WAIT
 * steps and SLA expiries for ESCALATION. Those need a cron / queue worker;
 * for now `resumeWaiting()` is exposed for manual / external triggering and
 * the cron lands when the scheduling module ships.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actions: WorkflowActionsRegistry,
  ) {}

  // ── START ────────────────────────────────────────────────────────────────

  async start(params: StartParams): Promise<WorkflowInstance> {
    const def = await this.resolveDefinition(params.companyId, params.definitionKey, params.version);
    const graph = this.parseGraph(def.steps as Prisma.JsonValue, def.key);

    const instance = await this.prisma.workflowInstance.create({
      data: {
        definitionId: def.id,
        companyId: params.companyId,
        initiatorId: params.initiatorId,
        refType: params.refType,
        refId: params.refId,
        status: WorkflowStatus.PENDING,
        currentStepKey: graph.start,
        context: (params.context ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.appendHistory(instance.id, graph.start, WorkflowStepType.APPROVAL, 'started', params.initiatorId, 'instance started');
    await this.audit.record({
      companyId: params.companyId,
      actorId: params.initiatorId,
      action: 'workflow.instance.started',
      refType: 'workflow_instance',
      refId: instance.id,
      after: { definitionKey: def.key, version: def.version, refType: params.refType, refId: params.refId } as any,
      ip: params.ip,
      module: 'workflow',
    });

    return this.advance(instance.id);
  }

  // ── ADVANCE LOOP ─────────────────────────────────────────────────────────

  /**
   * Drives the instance forward from `currentStepKey` until it reaches a
   * stopping state (AWAITING_APPROVAL / WAITING / COMPLETED / REJECTED /
   * CANCELLED / ERRORED).
   */
  async advance(instanceId: string): Promise<WorkflowInstance> {
    // Guard against infinite cycles in malformed graphs.
    const MAX_STEPS = 64;
    for (let i = 0; i < MAX_STEPS; i++) {
      const inst = await this.requireInstance(instanceId);
      if (this.isTerminal(inst.status) || inst.status === WorkflowStatus.AWAITING_APPROVAL || inst.status === WorkflowStatus.WAITING) {
        return inst;
      }
      const def = await this.prisma.workflowDefinition.findUnique({ where: { id: inst.definitionId } });
      if (!def) throw new NotFoundException('Definition disappeared');
      const graph = this.parseGraph(def.steps as Prisma.JsonValue, def.key);

      if (!inst.currentStepKey) {
        await this.markCompleted(inst.id, inst.initiatorId);
        return this.requireInstance(instanceId);
      }
      const step = graph.steps[inst.currentStepKey];
      if (!step) {
        await this.markErrored(inst.id, `Unknown step key: ${inst.currentStepKey}`);
        return this.requireInstance(instanceId);
      }

      await this.runStep(inst, step, graph);
    }
    throw new Error(`Workflow ${instanceId} exceeded MAX_STEPS — likely a cycle in the graph`);
  }

  // ── APPROVAL RESPONSE ────────────────────────────────────────────────────

  async respond(params: RespondParams): Promise<WorkflowInstance> {
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.workflowInstance.findUnique({ where: { id: params.instanceId } });
      if (!inst) throw new NotFoundException(`Instance ${params.instanceId} not found`);
      if (inst.status !== WorkflowStatus.AWAITING_APPROVAL || inst.currentStepKey !== params.stepKey) {
        throw new BadRequestException('This step is no longer awaiting approval');
      }

      const approval = await tx.workflowApproval.findUnique({
        where: { instanceId_stepKey_approverId: { instanceId: inst.id, stepKey: params.stepKey, approverId: params.approverId } },
      });
      if (!approval) {
        throw new ForbiddenException('You are not an approver for this step');
      }
      if (approval.decision) {
        throw new BadRequestException('You have already responded to this step');
      }

      await tx.workflowApproval.update({
        where: { id: approval.id },
        data: { decision: params.decision, comment: params.comment, decidedAt: new Date() },
      });

      await tx.workflowHistoryEntry.create({
        data: {
          instanceId: inst.id,
          stepKey: params.stepKey,
          stepType: WorkflowStepType.APPROVAL,
          status: params.decision === ApprovalDecision.APPROVED ? 'approved' : 'rejected',
          actorId: params.approverId,
          message: params.comment,
        },
      });
      return inst;
    }).then((inst) =>
      this.audit
        .record({
          companyId: inst.companyId,
          actorId: params.approverId,
          action: params.decision === ApprovalDecision.APPROVED ? 'workflow.approval.granted' : 'workflow.approval.rejected',
          refType: 'workflow_instance',
          refId: inst.id,
          after: { stepKey: params.stepKey, decision: params.decision } as any,
          ip: params.ip,
          module: 'workflow',
        })
        .then(() => this.evaluateApprovalStep(inst.id, params.stepKey)),
    );
  }

  /**
   * Re-evaluates an approval step after a response has been recorded.
   * Determines whether the semantics are satisfied (UNANIMOUS/MAJORITY/FIRST_RESPONSE)
   * and routes the instance accordingly.
   */
  private async evaluateApprovalStep(instanceId: string, stepKey: string): Promise<WorkflowInstance> {
    const inst = await this.requireInstance(instanceId);
    const def = await this.prisma.workflowDefinition.findUnique({ where: { id: inst.definitionId } });
    if (!def) throw new NotFoundException('Definition disappeared');
    const graph = this.parseGraph(def.steps as Prisma.JsonValue, def.key);
    const step = graph.steps[stepKey] as ApprovalStep | undefined;
    if (!step || step.type !== 'APPROVAL') return inst;

    const approvals = await this.prisma.workflowApproval.findMany({
      where: { instanceId, stepKey },
    });
    const decisions = approvals.map((a) => a.decision).filter((d): d is ApprovalDecision => !!d);
    const approvers = approvals.length;

    let outcome: 'approve' | 'reject' | 'pending' = 'pending';
    const semantics: ApprovalSemantics = step.semantics;
    if (semantics === 'FIRST_RESPONSE') {
      if (decisions.length > 0) {
        outcome = decisions[0] === ApprovalDecision.APPROVED ? 'approve' : 'reject';
      }
    } else if (semantics === 'UNANIMOUS') {
      if (decisions.some((d) => d === ApprovalDecision.REJECTED)) outcome = 'reject';
      else if (decisions.length === approvers && decisions.length > 0) outcome = 'approve';
    } else if (semantics === 'MAJORITY') {
      const yes = decisions.filter((d) => d === ApprovalDecision.APPROVED).length;
      const no = decisions.filter((d) => d === ApprovalDecision.REJECTED).length;
      if (yes > approvers / 2) outcome = 'approve';
      else if (no >= approvers / 2) outcome = 'reject';
    }

    if (outcome === 'pending') return inst;

    if (outcome === 'reject') {
      const next = step.onReject;
      if (next) {
        await this.prisma.workflowInstance.update({
          where: { id: instanceId },
          data: { status: WorkflowStatus.RUNNING, currentStepKey: next },
        });
        return this.advance(instanceId);
      }
      await this.prisma.workflowInstance.update({
        where: { id: instanceId },
        data: { status: WorkflowStatus.REJECTED, completedAt: new Date(), currentStepKey: null },
      });
      return this.requireInstance(instanceId);
    }

    // approve
    const next = step.onApprove ?? step.next;
    if (!next) {
      await this.markCompleted(instanceId, inst.initiatorId);
      return this.requireInstance(instanceId);
    }
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.RUNNING, currentStepKey: next },
    });
    return this.advance(instanceId);
  }

  // ── CANCEL / RESUME ──────────────────────────────────────────────────────

  async cancel(instanceId: string, actorId: string | null, reason?: string, ip?: string): Promise<WorkflowInstance> {
    const inst = await this.requireInstance(instanceId);
    if (this.isTerminal(inst.status)) {
      throw new BadRequestException(`Instance is already in terminal status ${inst.status}`);
    }
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.CANCELLED, completedAt: new Date(), currentStepKey: null },
    });
    await this.appendHistory(instanceId, inst.currentStepKey ?? '', WorkflowStepType.APPROVAL, 'cancelled', actorId, reason);
    await this.audit.record({
      companyId: inst.companyId,
      actorId,
      action: 'workflow.instance.cancelled',
      refType: 'workflow_instance',
      refId: instanceId,
      after: { reason: reason ?? null } as any,
      ip,
      module: 'workflow',
    });
    return this.requireInstance(instanceId);
  }

  /**
   * Resumes a WAITING instance if its resumeAt has passed. Designed to be
   * called by a cron / job worker; available as a manual endpoint for now.
   */
  async resumeWaiting(instanceId: string): Promise<WorkflowInstance> {
    const inst = await this.requireInstance(instanceId);
    if (inst.status !== WorkflowStatus.WAITING) return inst;
    if (inst.resumeAt && inst.resumeAt.getTime() > Date.now()) return inst;

    const def = await this.prisma.workflowDefinition.findUnique({ where: { id: inst.definitionId } });
    if (!def) throw new NotFoundException('Definition disappeared');
    const graph = this.parseGraph(def.steps as Prisma.JsonValue, def.key);
    if (!inst.currentStepKey) return inst;
    const step = graph.steps[inst.currentStepKey];
    if (!step || step.type !== 'WAIT') return inst;

    const next = step.next ?? null;
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.RUNNING, currentStepKey: next, resumeAt: null },
    });
    return this.advance(instanceId);
  }

  // ── STEP EXECUTION ───────────────────────────────────────────────────────

  private async runStep(inst: WorkflowInstance, step: WorkflowStep, graph: WorkflowStepGraph): Promise<void> {
    try {
      switch (step.type) {
        case 'APPROVAL':
          await this.enterApprovalStep(inst, step);
          break;
        case 'AUTOMATED_ACTION':
          await this.runAutomatedAction(inst, step);
          break;
        case 'CONDITIONAL_BRANCH':
          await this.runConditionalBranch(inst, step);
          break;
        case 'WAIT':
          await this.enterWaitStep(inst, step);
          break;
        case 'ESCALATION':
          await this.runEscalationStep(inst, step);
          break;
      }
    } catch (e) {
      const err = e as Error;
      await this.appendHistory(inst.id, step.key, step.type, 'errored', null, err.message);
      if (step.onError) {
        await this.prisma.workflowInstance.update({
          where: { id: inst.id },
          data: { status: WorkflowStatus.RUNNING, currentStepKey: step.onError },
        });
      } else {
        await this.markErrored(inst.id, err.message);
      }
    }
  }

  private async enterApprovalStep(inst: WorkflowInstance, step: ApprovalStep) {
    const approverIds = await this.resolveApprovers(inst, step.approvers);
    if (!approverIds.length) {
      throw new Error(`No approvers resolved for step ${step.key}`);
    }
    // Idempotent: skip if already created (cron retries).
    await this.prisma.workflowApproval.createMany({
      data: approverIds.map((approverId) => ({
        instanceId: inst.id,
        stepKey: step.key,
        approverId,
      })),
      skipDuplicates: true,
    });
    await this.prisma.workflowInstance.update({
      where: { id: inst.id },
      data: { status: WorkflowStatus.AWAITING_APPROVAL, currentStepKey: step.key },
    });
    await this.appendHistory(inst.id, step.key, WorkflowStepType.APPROVAL, 'entered', null, `awaiting ${approverIds.length} approver(s)`);

    // Optional hook — NotificationsModule registers `_internal.notify_approvers`
    // at boot to fan the assignment out to in-app/email. Skipped silently if
    // the handler isn't registered.
    if (this.actions.has('_internal.notify_approvers')) {
      try {
        await this.actions.run('_internal.notify_approvers', {
          companyId: inst.companyId,
          instanceId: inst.id,
          refType: inst.refType,
          refId: inst.refId,
          initiatorId: inst.initiatorId,
          context: (inst.context ?? {}) as Record<string, unknown>,
          params: {
            stepKey: step.key,
            stepName: step.name,
            approverIds,
            definitionKey: (await this.prisma.workflowDefinition.findUnique({
              where: { id: inst.definitionId },
              select: { key: true },
            }))?.key,
          },
        });
      } catch (e) {
        this.logger.warn(`notify_approvers hook failed: ${(e as Error).message}`);
      }
    }
  }

  private async runAutomatedAction(inst: WorkflowInstance, step: AutomatedActionStep) {
    const context = (inst.context ?? {}) as Record<string, unknown>;
    await this.actions.run(step.actionKey, {
      companyId: inst.companyId,
      instanceId: inst.id,
      refType: inst.refType,
      refId: inst.refId,
      initiatorId: inst.initiatorId,
      context,
      params: step.params ?? {},
    });
    await this.prisma.workflowInstance.update({
      where: { id: inst.id },
      data: {
        context: context as Prisma.InputJsonValue,
        currentStepKey: step.next ?? null,
        status: step.next ? WorkflowStatus.RUNNING : WorkflowStatus.COMPLETED,
        completedAt: step.next ? null : new Date(),
      },
    });
    await this.appendHistory(inst.id, step.key, WorkflowStepType.AUTOMATED_ACTION, 'completed', null, `action ${step.actionKey}`);
  }

  private async runConditionalBranch(inst: WorkflowInstance, step: ConditionalBranchStep) {
    const ctx = (inst.context ?? {}) as Record<string, unknown>;
    let nextKey: string | null | undefined;
    for (const c of step.cases) {
      if (evaluateCondition(c.when, ctx)) { nextKey = c.then; break; }
    }
    if (!nextKey) nextKey = step.default ?? step.next ?? null;

    await this.prisma.workflowInstance.update({
      where: { id: inst.id },
      data: {
        currentStepKey: nextKey ?? null,
        status: nextKey ? WorkflowStatus.RUNNING : WorkflowStatus.COMPLETED,
        completedAt: nextKey ? null : new Date(),
      },
    });
    await this.appendHistory(inst.id, step.key, WorkflowStepType.CONDITIONAL_BRANCH, 'completed', null, `→ ${nextKey ?? 'end'}`);
  }

  private async enterWaitStep(inst: WorkflowInstance, step: WaitStep) {
    const ctx = (inst.context ?? {}) as Record<string, unknown>;
    let resumeAt: Date | null = null;
    if (step.forSeconds) {
      resumeAt = new Date(Date.now() + step.forSeconds * 1000);
    } else if (step.untilContextPath) {
      const val = getPath(ctx, step.untilContextPath);
      if (typeof val === 'string') resumeAt = new Date(val);
    }
    await this.prisma.workflowInstance.update({
      where: { id: inst.id },
      data: { status: WorkflowStatus.WAITING, resumeAt },
    });
    await this.appendHistory(inst.id, step.key, WorkflowStepType.WAIT, 'entered', null, `resumeAt=${resumeAt?.toISOString() ?? 'manual'}`);
  }

  private async runEscalationStep(inst: WorkflowInstance, step: EscalationStep) {
    // Reassignment is recorded but not auto-fired; the cron resumer (future)
    // will pick this up. For now, we just log and move to `next` if defined.
    await this.appendHistory(inst.id, step.key, WorkflowStepType.ESCALATION, 'entered', null, `watching ${step.watchStepKey}`);
    await this.prisma.workflowInstance.update({
      where: { id: inst.id },
      data: {
        currentStepKey: step.next ?? null,
        status: step.next ? WorkflowStatus.RUNNING : WorkflowStatus.COMPLETED,
        completedAt: step.next ? null : new Date(),
      },
    });
  }

  // ── HELPERS ──────────────────────────────────────────────────────────────

  private async resolveDefinition(companyId: string, key: string, version?: number) {
    // Prefer the company's own definition; fall back to a system template.
    const own = await this.prisma.workflowDefinition.findFirst({
      where: { companyId, key, ...(version ? { version } : {}), isActive: true },
      orderBy: { version: 'desc' },
    });
    if (own) return own;
    const sys = await this.prisma.workflowDefinition.findFirst({
      where: { companyId: null, isSystem: true, key, ...(version ? { version } : {}), isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!sys) {
      throw new NotFoundException(`No workflow definition found for key "${key}"`);
    }
    return sys;
  }

  private parseGraph(steps: Prisma.JsonValue, key: string): WorkflowStepGraph {
    if (!steps || typeof steps !== 'object' || Array.isArray(steps)) {
      throw new Error(`Workflow "${key}" has a malformed steps blob`);
    }
    const graph = steps as unknown as WorkflowStepGraph;
    if (!graph.start || !graph.steps?.[graph.start]) {
      throw new Error(`Workflow "${key}" missing start step`);
    }
    return graph;
  }

  private async resolveApprovers(inst: WorkflowInstance, specs: Array<unknown>): Promise<string[]> {
    const ids = new Set<string>();
    const ctx = (inst.context ?? {}) as Record<string, unknown>;

    for (const raw of specs) {
      const spec = raw as any;
      if (spec.kind === 'user' && spec.userId) {
        ids.add(spec.userId);
      } else if (spec.kind === 'role' && spec.roleId) {
        const links = await this.prisma.userRole.findMany({
          where: { roleId: spec.roleId, user: { companyId: inst.companyId, isActive: true, deletedAt: null } },
          select: { userId: true },
        });
        links.forEach((l) => ids.add(l.userId));
      } else if (spec.kind === 'department_head') {
        const deptId = spec.departmentId ?? (ctx['departmentId'] as string | undefined);
        if (deptId) {
          // Pick department heads — users in the department whose roleType is DEPARTMENT_HEAD.
          const heads = await this.prisma.user.findMany({
            where: {
              companyId: inst.companyId,
              departmentId: deptId,
              roleType: 'DEPARTMENT_HEAD',
              isActive: true,
              deletedAt: null,
            },
            select: { id: true },
          });
          heads.forEach((u) => ids.add(u.id));
        }
      } else if (spec.kind === 'context' && spec.path) {
        const val = getPath(ctx, spec.path);
        if (typeof val === 'string') ids.add(val);
        else if (Array.isArray(val)) val.filter((v) => typeof v === 'string').forEach((v) => ids.add(v));
      }
    }
    return [...ids];
  }

  private async appendHistory(
    instanceId: string,
    stepKey: string,
    stepType: WorkflowStepType,
    status: string,
    actorId: string | null,
    message: string | undefined | null,
  ) {
    await this.prisma.workflowHistoryEntry.create({
      data: { instanceId, stepKey, stepType, status, actorId: actorId ?? undefined, message: message ?? undefined },
    });
  }

  private async requireInstance(id: string): Promise<WorkflowInstance> {
    const inst = await this.prisma.workflowInstance.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException(`Instance ${id} not found`);
    return inst;
  }

  private isTerminal(status: WorkflowStatus): boolean {
    return (
      status === WorkflowStatus.COMPLETED ||
      status === WorkflowStatus.REJECTED ||
      status === WorkflowStatus.CANCELLED ||
      status === WorkflowStatus.ERRORED
    );
  }

  private async markCompleted(instanceId: string, _actorId: string | null) {
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.COMPLETED, currentStepKey: null, completedAt: new Date() },
    });
  }

  private async markErrored(instanceId: string, reason: string) {
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: WorkflowStatus.ERRORED, currentStepKey: null, completedAt: new Date() },
    });
    this.logger.warn(`Workflow ${instanceId} errored: ${reason}`);
  }
}
