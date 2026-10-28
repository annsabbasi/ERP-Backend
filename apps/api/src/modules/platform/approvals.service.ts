import { Injectable } from '@nestjs/common';
import { uuidv7, type Approval, type ApprovalAction, type StaffPermission } from '@erp/contracts';
import { ProblemException } from '../../common/problem';
import { PlatformAuditService, type Tx } from './platform-audit.service';
import { PlatformDatabase } from './platform-database.service';
import type { StaffContext } from './staff-access.service';

// Four-eyes (◐ in Part 03 §3.2.1): a change that runs only after a second eligible staff member
// approves it. Eligible means holding the action's permission; nobody decides their own request
// (also a CHECK in the database). A request expires after 7 days. The services that own each
// action register what approval runs and what rejection undoes.

const EXPIRY_DAYS = 7;

/** The permission an approver must hold, per action. */
export const APPROVER_PERMISSION: Readonly<Record<ApprovalAction, StaffPermission>> = {
  'template.publish': 'catalogue.publish',
  'country_pack.publish': 'country_packs.publish',
  'plan.prices': 'catalogue.prices',
};

export type ApprovalRow = {
  id: string;
  action: ApprovalAction;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
};

export type ApprovalHandler = {
  /** Runs the approved change inside the approval's transaction; returns what to record. */
  execute(tx: Tx, approval: ApprovalRow, approver: StaffContext): Promise<Record<string, unknown>>;
  /** Undoes the "in review" state when a request is rejected or cancelled. */
  release?(tx: Tx, approval: ApprovalRow): Promise<void>;
};

@Injectable()
export class ApprovalsService {
  private readonly handlers = new Map<ApprovalAction, ApprovalHandler>();

  constructor(
    private readonly platform: PlatformDatabase,
    private readonly audit: PlatformAuditService,
  ) {}

  register(action: ApprovalAction, handler: ApprovalHandler): void {
    this.handlers.set(action, handler);
  }

  /** Opens a request; refused while another one for the same change is pending. */
  async request(
    tx: Tx,
    staff: StaffContext,
    input: {
      action: ApprovalAction;
      targetType: string;
      targetId: string;
      payload?: Record<string, unknown>;
      reason: string;
    },
  ): Promise<string> {
    const pending = await tx.staffApproval.findFirst({
      where: {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });
    if (pending)
      throw new ProblemException(
        'conflict',
        'A request for this change is already waiting for approval',
      );
    const id = uuidv7();
    await tx.staffApproval.create({
      data: {
        id,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        payload: (input.payload ?? {}) as object,
        reason: input.reason,
        requestedBy: staff.id,
        expiresAt: new Date(Date.now() + EXPIRY_DAYS * 86_400_000),
      },
    });
    await this.audit.write(tx, {
      actor: staff.id,
      action: 'approval.requested',
      targetType: input.targetType,
      targetId: input.targetId,
      after: { approval_id: id, action: input.action, payload: input.payload ?? {} },
      reason: input.reason,
    });
    return id;
  }

  async list(viewer: StaffContext, status?: Approval['status']): Promise<Approval[]> {
    const rows = await this.platform.db.staffApproval.findMany({
      where: status ? { status } : undefined,
      include: {
        requester: { select: { id: true, name: true } },
        decider: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => {
      const expired = r.status === 'pending' && r.expiresAt <= new Date();
      return {
        id: r.id,
        action: r.action as ApprovalAction,
        target_type: r.targetType,
        target_id: r.targetId,
        payload: r.payload as Record<string, unknown>,
        reason: r.reason,
        status: expired ? 'expired' : (r.status as Approval['status']),
        requested_by: r.requester,
        requested_at: r.requestedAt.toISOString(),
        expires_at: r.expiresAt.toISOString(),
        decided_by: r.decider,
        decided_at: r.decidedAt?.toISOString() ?? null,
        decision_note: r.decisionNote,
        can_decide:
          !expired &&
          r.status === 'pending' &&
          this.mayDecide(viewer, r.action as ApprovalAction, r.requestedBy),
      };
    });
  }

  /** Approvals waiting for this person (the console's badge). */
  async waitingFor(viewer: StaffContext): Promise<number> {
    const actions = (Object.keys(APPROVER_PERMISSION) as ApprovalAction[]).filter(
      (a) => viewer.permissions[APPROVER_PERMISSION[a]],
    );
    if (!actions.length) return 0;
    return this.platform.db.staffApproval.count({
      where: {
        status: 'pending',
        action: { in: actions },
        requestedBy: { not: viewer.id },
        expiresAt: { gt: new Date() },
      },
    });
  }

  async approve(viewer: StaffContext, id: string, note?: string): Promise<void> {
    await this.platform.db.$transaction(async (tx) => {
      const approval = await this.lockPending(tx, viewer, id);
      const handler = this.handlers.get(approval.action);
      if (!handler) throw new Error(`No handler for ${approval.action}`);
      const result = await handler.execute(tx, approval, viewer);
      await tx.staffApproval.update({
        where: { id },
        data: {
          status: 'approved',
          decidedBy: viewer.id,
          decidedAt: new Date(),
          decisionNote: note ?? null,
          executedAt: new Date(),
          result: result as object,
        },
      });
      await this.audit.write(tx, {
        actor: viewer.id,
        action: 'approval.approved',
        targetType: approval.targetType,
        targetId: approval.targetId,
        after: {
          approval_id: id,
          action: approval.action,
          requested_by: approval.requestedBy,
          result,
        },
        reason: note ?? `approved request ${id}`,
      });
    });
  }

  async reject(viewer: StaffContext, id: string, note: string): Promise<void> {
    await this.close(viewer, id, 'rejected', note);
  }

  /** The requester withdraws their own request. */
  async cancel(viewer: StaffContext, id: string): Promise<void> {
    await this.close(viewer, id, 'cancelled', 'withdrawn by the requester');
  }

  private async close(
    viewer: StaffContext,
    id: string,
    status: 'rejected' | 'cancelled',
    note: string,
  ): Promise<void> {
    await this.platform.db.$transaction(async (tx) => {
      const approval =
        status === 'cancelled'
          ? await this.lockOwnPending(tx, viewer, id)
          : await this.lockPending(tx, viewer, id);
      await this.handlers.get(approval.action)?.release?.(tx, approval);
      await tx.staffApproval.update({
        where: { id },
        data: {
          status,
          decidedBy: status === 'rejected' ? viewer.id : null,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      await this.audit.write(tx, {
        actor: viewer.id,
        action: `approval.${status}`,
        targetType: approval.targetType,
        targetId: approval.targetId,
        after: { approval_id: id, action: approval.action },
        reason: note,
      });
    });
  }

  private mayDecide(viewer: StaffContext, action: ApprovalAction, requestedBy: string): boolean {
    return requestedBy !== viewer.id && Boolean(viewer.permissions[APPROVER_PERMISSION[action]]);
  }

  /** The pending request, locked; refused when expired, own, or the viewer is not eligible. */
  private async lockPending(tx: Tx, viewer: StaffContext, id: string): Promise<ApprovalRow> {
    const row = await this.lock(tx, id);
    if (row.requested_by === viewer.id) {
      throw new ProblemException(
        'permission_denied',
        'You cannot decide your own request; a second person must',
      );
    }
    if (!viewer.permissions[APPROVER_PERMISSION[row.action as ApprovalAction]]) {
      throw new ProblemException('permission_denied', 'Your staff role cannot decide this request');
    }
    return this.pending(row);
  }

  private async lockOwnPending(tx: Tx, viewer: StaffContext, id: string): Promise<ApprovalRow> {
    const row = await this.lock(tx, id);
    if (row.requested_by !== viewer.id)
      throw new ProblemException('permission_denied', 'Only the requester can withdraw a request');
    return this.pending(row);
  }

  private async lock(tx: Tx, id: string) {
    const [row] = await tx.$queryRaw<
      {
        id: string;
        action: string;
        target_type: string;
        target_id: string;
        payload: Record<string, unknown>;
        requested_by: string;
        status: string;
        expires_at: Date;
      }[]
    >`SELECT id::text, action, target_type, target_id, payload, requested_by::text, status, expires_at
      FROM platform.staff_approvals WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw new ProblemException('not_found');
    return row;
  }

  private pending(row: Awaited<ReturnType<ApprovalsService['lock']>>): ApprovalRow {
    if (row.status !== 'pending')
      throw new ProblemException('conflict', `This request is already ${row.status}`);
    // Shown as expired in lists; it stays pending in the table until someone asks again.
    if (row.expires_at <= new Date()) {
      throw new ProblemException('conflict', 'This request has expired; ask again');
    }
    return {
      id: row.id,
      action: row.action as ApprovalAction,
      targetType: row.target_type,
      targetId: row.target_id,
      payload: row.payload,
      requestedBy: row.requested_by,
    };
  }
}
