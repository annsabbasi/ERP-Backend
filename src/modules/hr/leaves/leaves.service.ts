import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveRequest,
  LeaveRequestStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { WorkflowEngineService } from '../../workflows/workflow-engine.service';
import {
  AdjustBalanceDto,
  CreateLeaveTypeDto,
  DecideLeaveRequestDto,
  ReplaceLeaveDateRangesDto,
  SubmitLeaveRequestDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

/**
 * Leave management. Three concerns:
 *
 *   1. **Leave types** — per-company catalog with accrual config.
 *   2. **Balances** — per (employee, type, period) running counts of
 *      accrued/used/pending/carry-over days. Periodic accrual is a cron job
 *      pending the scheduler module; manual adjustments work today.
 *   3. **Requests** — submitted by the employee, optionally routed through
 *      a WorkflowDefinition (default key "leave_request" — system template
 *      from Module 5). Approval callbacks update both the request status
 *      and the relevant balance.
 */
@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowEngineService,
  ) {}

  // ── Leave Types ──────────────────────────────────────────────────────────

  listTypes(companyId: string) {
    return this.prisma.leaveType.findMany({
      where: { companyId },
      include: { dateRanges: { orderBy: { ordering: 'asc' } } },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async createType(companyId: string, dto: CreateLeaveTypeDto, meta: AuditMeta) {
    const conflict = await this.prisma.leaveType.findFirst({ where: { companyId, code: dto.code } });
    if (conflict) throw new BadRequestException(`Leave type "${dto.code}" already exists`);

    const lt = await this.prisma.leaveType.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        accrualMode: dto.accrualMode ?? undefined,
        accrualDays: dto.accrualDays as any,
        accrualPeriod: dto.accrualPeriod,
        maxBalance: dto.maxBalance as any,
        paid: dto.paid ?? true,
        requiresApproval: dto.requiresApproval ?? true,
        workflowKey: dto.workflowKey,
        isActive: dto.isActive ?? true,
        totalLeavesInYear: dto.totalLeavesInYear as any,
        totalLeavesInYearForTrainer: dto.totalLeavesInYearForTrainer as any,
        leaveCategory: dto.leaveCategory,
        applicableDuringProbation: dto.applicableDuringProbation ?? false,
        encashable: dto.encashable ?? false,
        minBalanceForEncash: dto.minBalanceForEncash as any,
        maxLeaveToEncash: dto.maxLeaveToEncash as any,
        payableLeave: dto.payableLeave ?? false,
        maxMonthlyApplications: dto.maxMonthlyApplications as any,
        minContinuousDays: dto.minContinuousDays as any,
        maxContinuousDays: dto.maxContinuousDays as any,
        minContinuousDurationProb: dto.minContinuousDurationProb as any,
        maxContinuousDurationProb: dto.maxContinuousDurationProb as any,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        carryForwardToNextYear: dto.carryForwardToNextYear ?? false,
        maxLeaveCarryForward: dto.maxLeaveCarryForward as any,
        isClosed: dto.isClosed ?? false,
        remarks: dto.remarks,
      },
    });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave_type.created', refType: 'leave_type', refId: lt.id,
      after: lt as any, ip: meta.ip, module: 'hr-payroll',
    });
    return lt;
  }

  async updateType(companyId: string, id: string, dto: UpdateLeaveTypeDto, meta: AuditMeta) {
    const before = await this.prisma.leaveType.findFirst({ where: { id, companyId } });
    if (!before) throw new NotFoundException(`Leave type ${id} not found`);

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        accrualMode: dto.accrualMode ?? undefined,
        accrualDays: (dto.accrualDays as any) ?? undefined,
        accrualPeriod: dto.accrualPeriod ?? undefined,
        maxBalance: (dto.maxBalance as any) ?? undefined,
        paid: dto.paid ?? undefined,
        requiresApproval: dto.requiresApproval ?? undefined,
        workflowKey: dto.workflowKey ?? undefined,
        isActive: dto.isActive ?? undefined,
        totalLeavesInYear: (dto.totalLeavesInYear as any) ?? undefined,
        totalLeavesInYearForTrainer: (dto.totalLeavesInYearForTrainer as any) ?? undefined,
        leaveCategory: dto.leaveCategory ?? undefined,
        applicableDuringProbation: dto.applicableDuringProbation ?? undefined,
        encashable: dto.encashable ?? undefined,
        minBalanceForEncash: (dto.minBalanceForEncash as any) ?? undefined,
        maxLeaveToEncash: (dto.maxLeaveToEncash as any) ?? undefined,
        payableLeave: dto.payableLeave ?? undefined,
        maxMonthlyApplications: (dto.maxMonthlyApplications as any) ?? undefined,
        minContinuousDays: (dto.minContinuousDays as any) ?? undefined,
        maxContinuousDays: (dto.maxContinuousDays as any) ?? undefined,
        minContinuousDurationProb: (dto.minContinuousDurationProb as any) ?? undefined,
        maxContinuousDurationProb: (dto.maxContinuousDurationProb as any) ?? undefined,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        carryForwardToNextYear: dto.carryForwardToNextYear ?? undefined,
        maxLeaveCarryForward: (dto.maxLeaveCarryForward as any) ?? undefined,
        isClosed: dto.isClosed ?? undefined,
        remarks: dto.remarks ?? undefined,
      },
    });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave_type.updated', refType: 'leave_type', refId: id,
      before: before as any, after: updated as any, ip: meta.ip, module: 'hr-payroll',
    });
    return updated;
  }

  async removeType(companyId: string, id: string, meta: AuditMeta) {
    const before = await this.prisma.leaveType.findFirst({ where: { id, companyId } });
    if (!before) throw new NotFoundException(`Leave type ${id} not found`);
    const inUse = await this.prisma.leaveBalance.count({ where: { leaveTypeId: id } })
      + await this.prisma.leaveRequest.count({ where: { leaveTypeId: id } });
    if (inUse) {
      const deactivated = await this.prisma.leaveType.update({ where: { id }, data: { isActive: false } });
      return { message: `Leave type ${id} deactivated (still referenced by ${inUse} record(s))`, leaveType: deactivated };
    }
    await this.prisma.leaveType.delete({ where: { id } });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave_type.deleted', refType: 'leave_type', refId: id,
      before: before as any, ip: meta.ip, module: 'hr-payroll',
    });
    return { message: `Leave type ${id} deleted` };
  }

  // ── Date ranges (Leave Master's small grid) ─────────────────────────────────

  async replaceDateRanges(companyId: string, leaveTypeId: string, dto: ReplaceLeaveDateRangesDto, meta: AuditMeta) {
    const type = await this.prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId } });
    if (!type) throw new NotFoundException(`Leave type ${leaveTypeId} not found`);

    await this.prisma.$transaction([
      this.prisma.leaveTypeDateRange.deleteMany({ where: { leaveTypeId } }),
      this.prisma.leaveTypeDateRange.createMany({
        data: dto.rows.map((row, i) => ({
          leaveTypeId,
          fromDate: new Date(row.fromDate),
          toDate: new Date(row.toDate),
          isLocked: row.isLocked ?? false,
          ordering: i,
        })),
      }),
    ]);
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave_type.date_ranges_replaced', refType: 'leave_type', refId: leaveTypeId,
      after: dto.rows as any, ip: meta.ip, module: 'hr-payroll',
    });
    return this.prisma.leaveTypeDateRange.findMany({ where: { leaveTypeId }, orderBy: { ordering: 'asc' } });
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  async listBalances(companyId: string, opts: { employeeId?: string; periodKey?: string } = {}) {
    return this.prisma.leaveBalance.findMany({
      where: {
        employee: { companyId },
        ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
        ...(opts.periodKey ? { periodKey: opts.periodKey } : {}),
      },
      include: { leaveType: { select: { id: true, code: true, name: true } } },
      orderBy: [{ employeeId: 'asc' }, { periodKey: 'desc' }],
    });
  }

  /**
   * Manually adjusts a balance (HR-only). Used for opening balances, carry-overs,
   * and corrections; periodic accrual is a separate scheduler job.
   */
  async adjustBalance(companyId: string, dto: AdjustBalanceDto, meta: AuditMeta) {
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
    if (!emp) throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    const type = await this.prisma.leaveType.findFirst({ where: { id: dto.leaveTypeId, companyId } });
    if (!type) throw new NotFoundException(`Leave type ${dto.leaveTypeId} not found`);

    const existing = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_periodKey: {
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          periodKey: dto.periodKey,
        },
      },
    });

    const balance = await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_periodKey: {
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          periodKey: dto.periodKey,
        },
      },
      update: {
        accruedDays: { increment: dto.accruedDelta as any },
      },
      create: {
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        periodKey: dto.periodKey,
        accruedDays: dto.accruedDelta as any,
      },
    });

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave_balance.adjusted',
      refType: 'leave_balance', refId: balance.id,
      before: existing as any, after: balance as any,
      ip: meta.ip, module: 'hr-payroll',
    });
    return balance;
  }

  // ── Requests ─────────────────────────────────────────────────────────────

  async listRequests(
    companyId: string,
    opts: { employeeId?: string; status?: LeaveRequestStatus } = {},
  ) {
    return this.prisma.leaveRequest.findMany({
      where: {
        companyId,
        ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      include: {
        employee: { select: { id: true, name: true, managerId: true } },
        leaveType: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submit(
    companyId: string,
    employeeId: string,
    dto: SubmitLeaveRequestDto,
    meta: AuditMeta,
  ): Promise<LeaveRequest> {
    // Submitting a leave request is a long chain of round trips (lookups,
    // create, balance reservation, workflow start, audit). Against a hosted
    // database that chain was measured at ~13s — inside the client's 15s
    // timeout by barely a second. These two lookups do not depend on each
    // other, so they go together rather than one after the other.
    const [emp, type] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: employeeId, companyId },
        include: { manager: { select: { userId: true } } },
      }),
      this.prisma.leaveType.findFirst({ where: { id: dto.leaveTypeId, companyId, isActive: true } }),
    ]);
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`);
    if (!type) throw new BadRequestException(`Leave type not available`);

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('endDate must be on or after startDate');

    const request = await this.prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId,
        leaveTypeId: type.id,
        startDate: start,
        endDate: end,
        days: dto.days as any,
        reason: dto.reason,
        leaveDurationType: dto.leaveDurationType ?? 'Full',
        signedBy: dto.signedBy,
        contactNo: dto.contactNo,
        preparedBy: dto.preparedBy,
        status: type.requiresApproval ? LeaveRequestStatus.PENDING : LeaveRequestStatus.APPROVED,
      },
    });

    // Reserve the balance against `pendingDays` while approval is in flight.
    if (type.requiresApproval) {
      await this.updatePendingDays(employeeId, type.id, periodKeyFor(start), dto.days);
    } else {
      await this.applyApproval(request.id);
    }

    // Start the configured workflow (default "leave_request") so the manager
    // gets an approval notification via Module 6.
    if (type.requiresApproval) {
      const wfKey = type.workflowKey ?? 'leave_request';
      try {
        const instance = await this.workflow.start({
          companyId,
          definitionKey: wfKey,
          initiatorId: meta.actorId,
          refType: 'leave_request',
          refId: request.id,
          context: {
            requesterId: emp.userId ?? null,
            managerId: emp.manager?.userId ?? null,
            employeeId,
            leaveTypeId: type.id,
            days: Number(dto.days),
            startDate: dto.startDate,
            endDate: dto.endDate,
          },
          ip: meta.ip,
        });
        await this.prisma.leaveRequest.update({
          where: { id: request.id },
          data: { workflowInstanceId: instance.id },
        });
      } catch {
        // Workflow definition missing → leave the request PENDING for manual decide.
      }
    }

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave.submitted',
      refType: 'leave_request', refId: request.id,
      after: { employeeId, leaveTypeId: type.id, days: Number(dto.days) } as any,
      ip: meta.ip, module: 'hr',
    });
    return request;
  }

  async approve(companyId: string, requestId: string, dto: DecideLeaveRequestDto, meta: AuditMeta) {
    const req = await this.requireRequest(companyId, requestId);
    if (req.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException(`Request is ${req.status}, cannot approve`);
    }
    if (!this.canApprove(req, meta.actorId)) {
      throw new ForbiddenException('Not authorized to approve this request');
    }
    await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: LeaveRequestStatus.APPROVED,
        approvedById: meta.actorId ?? undefined,
        approvedAt: new Date(),
        approvedByName: dto.approvedByName ?? undefined,
      },
    });
    await this.applyApproval(requestId);
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave.approved',
      refType: 'leave_request', refId: requestId,
      ip: meta.ip, module: 'hr',
    });
    return this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
  }

  async reject(companyId: string, requestId: string, dto: DecideLeaveRequestDto, meta: AuditMeta) {
    const req = await this.requireRequest(companyId, requestId);
    if (req.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException(`Request is ${req.status}, cannot reject`);
    }
    if (!this.canApprove(req, meta.actorId)) {
      throw new ForbiddenException('Not authorized to reject this request');
    }
    await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: LeaveRequestStatus.REJECTED, rejectedReason: dto.reason },
    });
    // Release the pending reservation.
    await this.updatePendingDays(req.employeeId, req.leaveTypeId, periodKeyFor(req.startDate), -Number(req.days));
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave.rejected',
      refType: 'leave_request', refId: requestId,
      after: { reason: dto.reason } as any,
      ip: meta.ip, module: 'hr',
    });
    return this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
  }

  async cancel(companyId: string, requestId: string, meta: AuditMeta) {
    const req = await this.requireRequest(companyId, requestId);
    if (req.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException(`Request is ${req.status}, cannot cancel`);
    }
    if (req.employeeId && meta.actorId) {
      // Caller must be the employee (their userId match) or HR admin.
      const emp = await this.prisma.employee.findUnique({ where: { id: req.employeeId } });
      if (emp?.userId && emp.userId !== meta.actorId) {
        throw new ForbiddenException('Only the requester can cancel; HR can reject instead');
      }
    }
    await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: LeaveRequestStatus.CANCELLED },
    });
    await this.updatePendingDays(req.employeeId, req.leaveTypeId, periodKeyFor(req.startDate), -Number(req.days));
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.leave.cancelled',
      refType: 'leave_request', refId: requestId,
      ip: meta.ip, module: 'hr',
    });
    return this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async requireRequest(companyId: string, id: string) {
    const req = await this.prisma.leaveRequest.findFirst({ where: { id, companyId } });
    if (!req) throw new NotFoundException(`Leave request ${id} not found`);
    return req;
  }

  /**
   * `actorId` here is a User id (JWT.sub). We allow approval when:
   *   • Actor IS the employee's manager (by user → employee linkage), OR
   *   • Caller is HR (the controller checks `hr.leave.manage_all` permission).
   *
   * The controller is responsible for the HR permission check; here we just
   * confirm that *some* actor was supplied.
   */
  private canApprove(_req: LeaveRequest, actorId: string | null): boolean {
    return !!actorId;
  }

  private async updatePendingDays(
    employeeId: string,
    leaveTypeId: string,
    periodKey: string,
    delta: number,
  ) {
    await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_periodKey: { employeeId, leaveTypeId, periodKey },
      },
      update: { pendingDays: { increment: delta as any } },
      create: { employeeId, leaveTypeId, periodKey, pendingDays: delta as any },
    });
  }

  /**
   * On approval: pending → used. We don't enforce a positive-balance invariant
   * here; HR policy can be configured per leave type later.
   */
  private async applyApproval(requestId: string) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) return;
    const periodKey = periodKeyFor(req.startDate);
    await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_periodKey: {
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          periodKey,
        },
      },
      update: {
        pendingDays: { decrement: Number(req.days) as any },
        usedDays: { increment: Number(req.days) as any },
      },
      create: {
        employeeId: req.employeeId,
        leaveTypeId: req.leaveTypeId,
        periodKey,
        usedDays: req.days,
      } as Prisma.LeaveBalanceUncheckedCreateInput,
    });
  }
}

/** Default period bucket is the calendar year of the leave start date. */
function periodKeyFor(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return String(d.getUTCFullYear());
}
