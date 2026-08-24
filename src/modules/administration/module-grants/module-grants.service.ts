import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalDecision, ApprovalRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  USER_MODULE_GRANT,
  UserModuleGrantSnapshot,
  assertModuleEnabled,
} from '../approvals/approval-effects';

/** Who is asking. `isSuperAdmin` is the flag, never the role — the role can drift. */
export interface GrantActor {
  sub: string;
  isSuperAdmin?: boolean;
}

/**
 * Module access, granted through approval.
 *
 * `user_modules` means effective access and nothing else: a row exists exactly
 * when the user has the module right now. Pending lives in `approval_requests`,
 * never here. There is deliberately no status column — every permission check
 * in the codebase reads this table, and the day one of them forgets to filter
 * on a status, a pending grant becomes live access.
 */
@Injectable()
export class ModuleGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Asks for a user to be given a module.
   *
   * A platform operator's own grant is recorded as approved rather than routed:
   * they are the approver, so routing it would only ask them to approve
   * themselves. It is still written as a full request with a decision on it, so
   * the audit trail says who granted what and when — an auto-approval that
   * skipped the paperwork would be indistinguishable from a grant that never
   * went through the control at all.
   */
  async request(
    companyId: string,
    actor: GrantActor,
    dto: { userId: string; moduleId: string; remarks?: string },
  ) {
    const { user, module } = await this.validate(companyId, dto.userId, dto.moduleId);

    const already = await this.prisma.userModule.findUnique({
      where: { userId_moduleId: { userId: dto.userId, moduleId: dto.moduleId } },
    });
    if (already) {
      throw new ConflictException(`${user.email} already has the ${module.name} module.`);
    }

    const pending = await this.findPending(companyId, dto.userId, dto.moduleId);
    if (pending) {
      throw new ConflictException(
        `A request to give ${user.email} the ${module.name} module is already awaiting approval.`,
      );
    }

    const snapshot: UserModuleGrantSnapshot = {
      userId: dto.userId,
      moduleId: dto.moduleId,
      userEmail: user.email,
      moduleSlug: module.slug,
    };

    if (actor.isSuperAdmin) {
      return this.recordAutoApproved(companyId, actor.sub, snapshot, dto.remarks);
    }

    const outcome = await this.approvals.submit(companyId, actor.sub, {
      documentType: USER_MODULE_GRANT,
      documentId: `${dto.userId}:${dto.moduleId}`,
      document: snapshot as unknown as Record<string, unknown>,
      remarks: dto.remarks,
    } as never);

    // No template matched, so nothing would review this. Failing closed is the
    // only safe reading: granting anyway would turn a missing configuration
    // into a silent bypass of the whole control.
    if (!outcome.required) {
      throw new BadRequestException(
        'No approval template covers module grants for this company, so the grant cannot be ' +
          'reviewed. Add one naming the approver before granting module access.',
      );
    }
    return { autoApproved: false, ...outcome };
  }

  /** Pending grant requests for one company. */
  async pending(companyId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { companyId, documentType: USER_MODULE_GRANT, status: ApprovalRequestStatus.PENDING },
      include: {
        originator: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every pending grant across every company.
   *
   * The platform operator approves for all tenants, so their queue cannot be
   * scoped to one — the same cross-company read the user listing needed.
   */
  async pendingAcrossCompanies() {
    return this.prisma.approvalRequest.findMany({
      where: { documentType: USER_MODULE_GRANT, status: ApprovalRequestStatus.PENDING },
      include: {
        originator: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ companyId: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** Removes access. Revocation is a delete, because a row means access. */
  async revoke(companyId: string, userId: string, moduleId: string) {
    const { user } = await this.validate(companyId, userId, moduleId, { requireEnabled: false });
    const existing = await this.prisma.userModule.findUnique({
      where: { userId_moduleId: { userId, moduleId } },
    });
    if (!existing) throw new NotFoundException(`${user.email} does not have that module.`);
    await this.prisma.userModule.delete({ where: { userId_moduleId: { userId, moduleId } } });
    return { userId, moduleId, message: 'Module access removed' };
  }

  /**
   * Writes an approved request and its grant together.
   *
   * Everything here is one transaction so the grant and the record of who
   * authorised it cannot come apart.
   */
  private async recordAutoApproved(
    companyId: string,
    approverId: string,
    snapshot: UserModuleGrantSnapshot,
    remarks?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const template = await this.ensureAutoApprovalTemplate(tx, companyId);
      const stage = template.stages[0];

      const request = await tx.approvalRequest.create({
        data: {
          companyId,
          templateId: template.id,
          documentType: USER_MODULE_GRANT,
          documentId: `${snapshot.userId}:${snapshot.moduleId}`,
          originatorId: approverId,
          status: ApprovalRequestStatus.APPROVED,
          currentStageOrder: stage.ordering,
          remarks: remarks ?? 'Granted by a platform operator; no separate approval required.',
          documentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          resolvedAt: new Date(),
          stages: {
            create: [{
              stageId: stage.stageId,
              ordering: stage.ordering,
              status: ApprovalRequestStatus.APPROVED,
              resolvedAt: new Date(),
            }],
          },
        },
        include: { stages: true },
      });

      await tx.documentApprovalDecision.create({
        data: {
          requestId: request.id,
          requestStageId: request.stages[0].id,
          approverId,
          decision: ApprovalDecision.APPROVED,
          remarks: 'Auto-approved: the requester is the approver.',
        },
      });

      await assertModuleEnabled(tx, companyId, snapshot.moduleId);
      await tx.userModule.createMany({
        data: [{ userId: snapshot.userId, moduleId: snapshot.moduleId }],
        skipDuplicates: true,
      });

      return { autoApproved: true, required: true, requests: [request] };
    });
  }

  /**
   * The template an auto-approved grant is recorded against.
   *
   * A request needs a template and a stage to hang its decision on. Onboarding
   * seeds one per company; this creates it if a company predates that, so a
   * platform operator is never blocked by setup they did not know was missing.
   */
  private async ensureAutoApprovalTemplate(tx: Prisma.TransactionClient, companyId: string) {
    const existing = await tx.approvalTemplate.findFirst({
      where: { companyId, documentTypes: { has: USER_MODULE_GRANT } },
      include: { stages: { orderBy: { ordering: 'asc' } } },
    });
    if (existing?.stages.length) return existing;

    const stage =
      (await tx.approvalStage.findFirst({ where: { companyId, name: 'Platform Operator' } })) ??
      (await tx.approvalStage.create({
        data: {
          companyId,
          name: 'Platform Operator',
          description: 'Approved by the platform operator.',
          requiredApprovals: 1,
        },
      }));

    if (existing) {
      await tx.approvalTemplateStage.create({
        data: { templateId: existing.id, stageId: stage.id, ordering: 0 },
      });
      return { ...existing, stages: [{ stageId: stage.id, ordering: 0 }] } as typeof existing;
    }

    const template = await tx.approvalTemplate.create({
      data: {
        companyId,
        name: 'Module Access Grant',
        description: 'Module access for a user is approved by the platform operator.',
        documentTypes: [USER_MODULE_GRANT],
        stages: { create: [{ stageId: stage.id, ordering: 0 }] },
      },
      include: { stages: { orderBy: { ordering: 'asc' } } },
    });
    return template;
  }

  private findPending(companyId: string, userId: string, moduleId: string) {
    return this.prisma.approvalRequest.findFirst({
      where: {
        companyId,
        documentType: USER_MODULE_GRANT,
        status: ApprovalRequestStatus.PENDING,
        documentId: `${userId}:${moduleId}`,
      },
    });
  }

  private async validate(
    companyId: string,
    userId: string,
    moduleId: string,
    opts: { requireEnabled?: boolean } = {},
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found in this company');

    const module = await this.prisma.systemModule.findUnique({
      where: { id: moduleId },
      select: { id: true, name: true, slug: true },
    });
    if (!module) throw new NotFoundException('Module not found');

    if (opts.requireEnabled !== false) {
      const enabled = await this.prisma.companyModule.findFirst({
        where: { companyId, moduleId, isEnabled: true },
        select: { moduleId: true },
      });
      if (!enabled) {
        throw new BadRequestException(
          `${module.name} is not enabled for this company, so it cannot be granted.`,
        );
      }
    }
    return { user, module };
  }
}
