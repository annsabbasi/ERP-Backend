import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalDecision, ApprovalRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyApprovedRequest } from './approval-effects';
import {
  ApprovalDecisionDto,
  CreateApprovalStageDto,
  CreateApprovalTemplateDto,
  SubmitForApprovalDto,
  UpdateApprovalStageDto,
  UpdateApprovalTemplateDto,
} from '../administration.dto';

type Condition = { field: string; op: string; value: unknown };
type Terms = { always?: boolean; match?: 'all' | 'any'; conditions?: Condition[] };

const REQUEST_INCLUDE = {
  template: { select: { id: true, name: true, documentTypes: true } },
  originator: { select: { id: true, name: true, email: true } },
  stages: {
    orderBy: { ordering: 'asc' as const },
    include: {
      stage: {
        include: {
          approvers: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
      decisions: {
        include: { approver: { select: { id: true, name: true, email: true } } },
      },
    },
  },
};

/**
 * Document approval.
 *
 * A template matches on (documentType, originator, terms). When it matches, a
 * request is opened with one row per template stage. Stages clear strictly in
 * order; a stage clears when `requiredApprovals` distinct approvers have
 * approved it. A single rejection at any stage terminates the whole request —
 * that is the behaviour every approval workflow users know, and softening it
 * would let a rejected document quietly proceed.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── STAGES ─────────────────────────────────────────────────────────────────
  listStages(companyId: string) {
    return this.prisma.approvalStage.findMany({
      where: { companyId },
      include: {
        approvers: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { templateStages: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getStage(companyId: string, id: string) {
    const stage = await this.prisma.approvalStage.findFirst({
      where: { id, companyId },
      include: { approvers: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (!stage) throw new NotFoundException('Approval stage not found');
    return stage;
  }

  async createStage(companyId: string, dto: CreateApprovalStageDto) {
    await this.assertUsersInCompany(companyId, dto.approverIds);
    if (dto.requiredApprovals && dto.requiredApprovals > dto.approverIds.length) {
      throw new BadRequestException(
        `requiredApprovals (${dto.requiredApprovals}) exceeds the ${dto.approverIds.length} ` +
          `approver(s) assigned — the stage could never clear.`,
      );
    }
    return this.prisma.approvalStage.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        requiredApprovals: dto.requiredApprovals ?? 1,
        remarks: dto.remarks ?? null,
        isActive: dto.isActive ?? true,
        approvers: { create: dto.approverIds.map((userId) => ({ userId })) },
      },
      include: { approvers: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
  }

  async updateStage(companyId: string, id: string, dto: UpdateApprovalStageDto) {
    await this.getStage(companyId, id);
    if (dto.approverIds) await this.assertUsersInCompany(companyId, dto.approverIds);

    return this.prisma.$transaction(async (tx) => {
      if (dto.approverIds) {
        await tx.approvalStageApprover.deleteMany({ where: { stageId: id } });
      }
      return tx.approvalStage.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.requiredApprovals !== undefined ? { requiredApprovals: dto.requiredApprovals } : {}),
          ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.approverIds ? { approvers: { create: dto.approverIds.map((userId) => ({ userId })) } } : {}),
        },
        include: { approvers: { include: { user: { select: { id: true, name: true, email: true } } } } },
      });
    });
  }

  async removeStage(companyId: string, id: string) {
    const stage = await this.prisma.approvalStage.findFirst({
      where: { id, companyId },
      include: { _count: { select: { templateStages: true, requestStages: true } } },
    });
    if (!stage) throw new NotFoundException('Approval stage not found');
    if (stage._count.templateStages > 0) {
      throw new ConflictException(
        `Stage "${stage.name}" is used by ${stage._count.templateStages} template(s). Remove it from those first.`,
      );
    }
    if (stage._count.requestStages > 0) {
      throw new ConflictException(
        `Stage "${stage.name}" appears in approval history and cannot be deleted. Deactivate it instead.`,
      );
    }
    await this.prisma.approvalStage.delete({ where: { id } });
    return { id, message: 'Approval stage deleted' };
  }

  // ── TEMPLATES ──────────────────────────────────────────────────────────────
  listTemplates(companyId: string) {
    return this.prisma.approvalTemplate.findMany({
      where: { companyId },
      include: {
        originators: { include: { user: { select: { id: true, name: true, email: true } } } },
        stages: { orderBy: { ordering: 'asc' }, include: { stage: { select: { id: true, name: true } } } },
        _count: { select: { requests: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(companyId: string, id: string) {
    const t = await this.prisma.approvalTemplate.findFirst({
      where: { id, companyId },
      include: {
        originators: { include: { user: { select: { id: true, name: true, email: true } } } },
        stages: {
          orderBy: { ordering: 'asc' },
          include: {
            stage: {
              include: { approvers: { include: { user: { select: { id: true, name: true } } } } },
            },
          },
        },
      },
    });
    if (!t) throw new NotFoundException('Approval template not found');
    return t;
  }

  async createTemplate(companyId: string, dto: CreateApprovalTemplateDto) {
    await this.assertStagesInCompany(companyId, dto.stageIds);
    if (dto.originatorIds?.length) await this.assertUsersInCompany(companyId, dto.originatorIds);

    return this.prisma.approvalTemplate.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
        documentTypes: dto.documentTypes,
        terms: (dto.terms ?? {}) as Prisma.InputJsonValue,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        originators: { create: (dto.originatorIds ?? []).map((userId) => ({ userId })) },
        stages: { create: dto.stageIds.map((stageId, ordering) => ({ stageId, ordering })) },
      },
      include: {
        originators: { include: { user: { select: { id: true, name: true } } } },
        stages: { orderBy: { ordering: 'asc' }, include: { stage: { select: { id: true, name: true } } } },
      },
    });
  }

  async updateTemplate(companyId: string, id: string, dto: UpdateApprovalTemplateDto) {
    await this.getTemplate(companyId, id);
    if (dto.stageIds) await this.assertStagesInCompany(companyId, dto.stageIds);
    if (dto.originatorIds?.length) await this.assertUsersInCompany(companyId, dto.originatorIds);

    return this.prisma.$transaction(async (tx) => {
      if (dto.stageIds) await tx.approvalTemplateStage.deleteMany({ where: { templateId: id } });
      if (dto.originatorIds) await tx.approvalTemplateOriginator.deleteMany({ where: { templateId: id } });

      return tx.approvalTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.documentTypes !== undefined ? { documentTypes: dto.documentTypes } : {}),
          ...(dto.terms !== undefined ? { terms: dto.terms as Prisma.InputJsonValue } : {}),
          ...(dto.validFrom !== undefined ? { validFrom: dto.validFrom ? new Date(dto.validFrom) : null } : {}),
          ...(dto.validTo !== undefined ? { validTo: dto.validTo ? new Date(dto.validTo) : null } : {}),
          ...(dto.originatorIds ? { originators: { create: dto.originatorIds.map((userId) => ({ userId })) } } : {}),
          ...(dto.stageIds ? { stages: { create: dto.stageIds.map((stageId, ordering) => ({ stageId, ordering })) } } : {}),
        },
        include: {
          originators: { include: { user: { select: { id: true, name: true } } } },
          stages: { orderBy: { ordering: 'asc' }, include: { stage: { select: { id: true, name: true } } } },
        },
      });
    });
  }

  async removeTemplate(companyId: string, id: string) {
    const t = await this.prisma.approvalTemplate.findFirst({
      where: { id, companyId },
      include: { _count: { select: { requests: true } } },
    });
    if (!t) throw new NotFoundException('Approval template not found');
    if (t._count.requests > 0) {
      throw new ConflictException(
        `Template "${t.name}" has ${t._count.requests} approval request(s) in history. Deactivate it instead.`,
      );
    }
    await this.prisma.approvalTemplate.delete({ where: { id } });
    return { id, message: 'Approval template deleted' };
  }

  // ── SUBMISSION ─────────────────────────────────────────────────────────────
  /**
   * Opens approval requests for every template that matches the document.
   * Returns `required: false` when nothing matches, which the caller treats as
   * "post it straight away".
   */
  async submit(companyId: string, originatorId: string, dto: SubmitForApprovalDto) {
    const now = new Date();
    const templates = await this.prisma.approvalTemplate.findMany({
      where: {
        companyId,
        isActive: true,
        documentTypes: { has: dto.documentType },
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
      include: {
        originators: { select: { userId: true } },
        stages: { orderBy: { ordering: 'asc' } },
      },
    });

    const matched = templates.filter((t) => {
      // No originators listed means the template watches everyone.
      const watchesOriginator =
        t.originators.length === 0 || t.originators.some((o) => o.userId === originatorId);
      if (!watchesOriginator) return false;
      return this.termsMatch(t.terms as Terms, dto.document);
    });

    if (!matched.length) {
      return { required: false, requests: [] as unknown[] };
    }

    const requests: Awaited<ReturnType<typeof this.getRequest>>[] = [];
    for (const t of matched) {
      if (!t.stages.length) continue; // a template with no stages cannot gate anything
      const req = await this.prisma.approvalRequest.create({
        data: {
          companyId,
          templateId: t.id,
          documentType: dto.documentType,
          documentId: dto.documentId ?? null,
          documentNumber: dto.documentNumber ?? null,
          originatorId,
          remarks: dto.remarks ?? null,
          documentSnapshot: dto.document as Prisma.InputJsonValue,
          currentStageOrder: t.stages[0].ordering,
          stages: {
            create: t.stages.map((s) => ({ stageId: s.stageId, ordering: s.ordering })),
          },
        },
        include: REQUEST_INCLUDE,
      });
      requests.push(req);
    }

    return { required: requests.length > 0, requests };
  }

  /**
   * The company a request belongs to, for callers who are not inside one.
   *
   * A platform operator approves for every tenant, so `user.companyId` is null
   * and there is nothing to scope by. The request itself knows which company it
   * is for, so it is read from there rather than made the caller's problem —
   * the alternative is an operator who can see a queue they cannot act on.
   */
  async companyIdForRequest(requestId: string): Promise<string> {
    const req = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: { companyId: true },
    });
    if (!req) throw new NotFoundException('Approval request not found');
    return req.companyId;
  }

  // ── DECISIONS ──────────────────────────────────────────────────────────────
  async decide(
    companyId: string,
    requestId: string,
    approverId: string,
    dto: ApprovalDecisionDto,
  ) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id: requestId, companyId },
      include: REQUEST_INCLUDE,
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalRequestStatus.PENDING) {
      throw new ConflictException(
        `This request is already ${request.status.toLowerCase()} and accepts no further decisions.`,
      );
    }

    const stage = request.stages.find((s) => s.ordering === request.currentStageOrder);
    if (!stage) throw new ConflictException('No stage is currently awaiting a decision.');

    // The named approver, or whoever is standing in for them right now.
    const effectiveApproverId = await this.resolveApprover(
      companyId,
      request.templateId,
      approverId,
      stage.stage.approvers.map((a) => a.userId),
    );

    if (!effectiveApproverId) {
      throw new ForbiddenException(
        `You are not an approver for stage "${stage.stage.name}", and no substitution names you.`,
      );
    }
    if (stage.decisions.some((d) => d.approverId === approverId)) {
      throw new ConflictException('You have already recorded a decision on this stage.');
    }

    try {
      return await this.recordDecision(request, stage, approverId, effectiveApproverId, dto);
    } catch (e) {
      // Two approvers deciding at the same instant both pass the in-memory
      // "already decided" check above, because both read the stage before
      // either wrote. The unique index on (requestStageId, approverId) is what
      // actually settles it; this turns the loser's raw constraint violation
      // into the same answer the sequential path gives.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        String(e.meta?.target ?? '').includes('approverId')
      ) {
        throw new ConflictException('You have already recorded a decision on this stage.');
      }
      throw e;
    }
  }

  private async recordDecision(
    request: NonNullable<Awaited<ReturnType<ApprovalsService['getRequest']>>>,
    stage: (typeof request)['stages'][number],
    approverId: string,
    effectiveApproverId: string,
    dto: ApprovalDecisionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.documentApprovalDecision.create({
        data: {
          requestId: request.id,
          requestStageId: stage.id,
          approverId,
          decision: dto.decision,
          remarks: dto.remarks ?? null,
          onBehalfOfId: effectiveApproverId === approverId ? null : effectiveApproverId,
        },
      });

      // One rejection ends the request outright.
      if (dto.decision === ApprovalDecision.REJECTED) {
        await tx.approvalRequestStage.update({
          where: { id: stage.id },
          data: { status: ApprovalRequestStatus.REJECTED, resolvedAt: new Date() },
        });
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: ApprovalRequestStatus.REJECTED, resolvedAt: new Date() },
        });
        return tx.approvalRequest.findUnique({ where: { id: request.id }, include: REQUEST_INCLUDE });
      }

      const approvals = stage.decisions.filter(
        (d) => d.decision === ApprovalDecision.APPROVED,
      ).length + 1;

      if (approvals < stage.stage.requiredApprovals) {
        // Stage still needs more approvals; leave it pending.
        return tx.approvalRequest.findUnique({ where: { id: request.id }, include: REQUEST_INCLUDE });
      }

      await tx.approvalRequestStage.update({
        where: { id: stage.id },
        data: { status: ApprovalRequestStatus.APPROVED, resolvedAt: new Date() },
      });

      const next = request.stages
        .filter((s) => s.ordering > stage.ordering)
        .sort((a, b) => a.ordering - b.ordering)[0];

      await tx.approvalRequest.update({
        where: { id: request.id },
        data: next
          ? { currentStageOrder: next.ordering }
          : { status: ApprovalRequestStatus.APPROVED, resolvedAt: new Date() },
      });

      // The last stage has cleared, so whatever the request was asking for
      // happens now — in this transaction, alongside the approval that
      // authorises it. Doing it afterwards would leave a window where the
      // request reads approved and the access does not exist, and doing it
      // earlier would mean pending access is real access.
      if (!next) {
        await applyApprovedRequest(tx, request);
      }

      return tx.approvalRequest.findUnique({ where: { id: request.id }, include: REQUEST_INCLUDE });
    });
  }

  async cancel(companyId: string, requestId: string, userId: string) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalRequestStatus.PENDING) {
      throw new ConflictException(`Request is already ${request.status.toLowerCase()}.`);
    }
    // Only the person who raised it can withdraw it; approvers reject instead.
    if (request.originatorId !== userId) {
      throw new ForbiddenException('Only the originator can cancel an approval request.');
    }
    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: ApprovalRequestStatus.CANCELLED, resolvedAt: new Date() },
      include: REQUEST_INCLUDE,
    });
  }

  // ── QUERIES ────────────────────────────────────────────────────────────────
  /** Approval Status Report. */
  listRequests(
    companyId: string,
    filters: { status?: ApprovalRequestStatus; documentType?: string; originatorId?: string } = {},
  ) {
    return this.prisma.approvalRequest.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.documentType ? { documentType: filters.documentType } : {}),
        ...(filters.originatorId ? { originatorId: filters.originatorId } : {}),
      },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRequest(companyId: string, id: string) {
    const r = await this.prisma.approvalRequest.findFirst({
      where: { id, companyId },
      include: REQUEST_INCLUDE,
    });
    if (!r) throw new NotFoundException('Approval request not found');
    return r;
  }

  /** The signed-in user's queue — requests waiting on a stage they can clear. */
  async myQueue(companyId: string, userId: string) {
    const standInFor = await this.activeSubstitutions(companyId, userId);
    const actAs = [userId, ...standInFor];

    const pending = await this.prisma.approvalRequest.findMany({
      where: { companyId, status: ApprovalRequestStatus.PENDING },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    return pending.filter((r) => {
      const stage = r.stages.find((s) => s.ordering === r.currentStageOrder);
      if (!stage) return false;
      const isApprover = stage.stage.approvers.some((a) => actAs.includes(a.userId));
      const alreadyDecided = stage.decisions.some((d) => d.approverId === userId);
      return isApprover && !alreadyDecided;
    });
  }

  /** Approval Decision Report — every decision cast, newest first. */
  listDecisions(
    companyId: string,
    filters: { approverId?: string; from?: Date; to?: Date } = {},
  ) {
    return this.prisma.documentApprovalDecision.findMany({
      where: {
        request: { companyId },
        ...(filters.approverId ? { approverId: filters.approverId } : {}),
        ...(filters.from || filters.to
          ? {
              decidedAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      include: {
        approver: { select: { id: true, name: true, email: true } },
        request: {
          select: {
            id: true, documentType: true, documentNumber: true, status: true,
            originator: { select: { id: true, name: true } },
            template: { select: { id: true, name: true } },
          },
        },
        requestStage: { include: { stage: { select: { id: true, name: true } } } },
      },
      orderBy: { decidedAt: 'desc' },
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  /**
   * Evaluates a template's trigger terms against the submitted document.
   * Unknown operators and missing fields evaluate to false rather than throwing:
   * a mis-typed condition should fail to trigger, never block every save.
   */
  private termsMatch(terms: Terms | null | undefined, doc: Record<string, unknown>): boolean {
    if (!terms || Object.keys(terms).length === 0) return true;
    if (terms.always) return true;

    const conditions = terms.conditions ?? [];
    if (!conditions.length) return true;

    const results = conditions.map((c) => {
      const actual = readPath(doc, c.field);
      switch (c.op) {
        case 'eq': return actual === c.value;
        case 'neq': return actual !== c.value;
        case 'gt': return num(actual) > num(c.value);
        case 'gte': return num(actual) >= num(c.value);
        case 'lt': return num(actual) < num(c.value);
        case 'lte': return num(actual) <= num(c.value);
        case 'in': return Array.isArray(c.value) && c.value.includes(actual as never);
        case 'contains':
          return String(actual ?? '').toLowerCase().includes(String(c.value ?? '').toLowerCase());
        default: return false;
      }
    });

    return (terms.match ?? 'all') === 'any' ? results.some(Boolean) : results.every(Boolean);
  }

  /** Returns the id this user is effectively approving as, or null if they cannot. */
  private async resolveApprover(
    companyId: string,
    templateId: string,
    userId: string,
    stageApproverIds: string[],
  ): Promise<string | null> {
    if (stageApproverIds.includes(userId)) return userId;

    const now = new Date();
    const sub = await this.prisma.substituteAuthorizer.findFirst({
      where: {
        companyId,
        substituteUserId: userId,
        isActive: true,
        validFrom: { lte: now },
        validTo: { gte: now },
        originalUserId: { in: stageApproverIds },
        OR: [{ templateId: null }, { templateId }],
      },
    });
    return sub?.originalUserId ?? null;
  }

  private async activeSubstitutions(companyId: string, userId: string): Promise<string[]> {
    const now = new Date();
    const subs = await this.prisma.substituteAuthorizer.findMany({
      where: {
        companyId,
        substituteUserId: userId,
        isActive: true,
        validFrom: { lte: now },
        validTo: { gte: now },
      },
      select: { originalUserId: true },
    });
    return subs.map((s) => s.originalUserId);
  }

  private async assertUsersInCompany(companyId: string, userIds: string[]) {
    if (!userIds.length) return;
    const found = await this.prisma.user.count({
      where: { id: { in: userIds }, companyId },
    });
    if (found !== new Set(userIds).size) {
      throw new BadRequestException('One or more users do not belong to this company.');
    }
  }

  private async assertStagesInCompany(companyId: string, stageIds: string[]) {
    const found = await this.prisma.approvalStage.count({
      where: { id: { in: stageIds }, companyId },
    });
    if (found !== new Set(stageIds).size) {
      throw new BadRequestException('One or more approval stages do not belong to this company.');
    }
  }
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
