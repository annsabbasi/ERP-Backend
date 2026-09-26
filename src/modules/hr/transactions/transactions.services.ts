import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computePayslip,
  inclusiveDays,
  num,
  rowTotals,
  splitLeave,
  type LeaveWindow,
} from './payroll-calculation';
import { TenantCrudOptions, TenantCrudService } from '../../../common/crud/tenant-crud.service';
import { JournalEntriesService } from '../../financials/journal-entries/journal-entries.service';
import { JournalLineDto } from '../../financials/journal-entries/dto/journal-entry.dto';
import { AccountDeterminationService } from '../../financials/setup/setup.services';
import {
  ReplaceAttendanceSheetLinesDto,
  ReplacePayrollRunLinesDto,
  ReplacePayrollAdjustmentLinesDto,
  ReplaceLoanInstallmentsDto,
  CancelPayrollRunDto,
} from './transactions.dto';

const dayMs = 24 * 60 * 60 * 1000;

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);
const ZERO = new Prisma.Decimal(0);
const money = (v: Prisma.Decimal) => Number(v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));

/**
 * Which G/L account each side of a payroll posting lands on — keys into
 * Administration → Setup → Financials → G/L Account Determination, area
 * "PAYROLL", same pattern AR/AP's `DETERMINATION` map uses. Tax and loan
 * accounts are only resolved when the run actually has that deduction, so a
 * company that hasn't mapped `loan_receivable` can still post payroll for a
 * period with no loan deductions in it.
 */
export const PAYROLL_DETERMINATION = {
  salaryExpense: { area: 'PAYROLL', key: 'salary_expense' },
  salariesPayable: { area: 'PAYROLL', key: 'salaries_payable' },
  taxPayable: { area: 'PAYROLL', key: 'tax_payable' },
  loanReceivable: { area: 'PAYROLL', key: 'loan_receivable' },
  advanceReceivable: { area: 'PAYROLL', key: 'advance_receivable' },
} as const;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
/**
 * Post reads its lines, plans the recoveries and writes the journal inside one
 * transaction that holds the run's row lock — about a dozen round trips, which
 * on the hosted database (0.5–0.9s each) can pass the 20s default. The lock is
 * held for exactly as long as it takes; this only stops it being cut short.
 */
const PAYROLL_TX = { maxWait: 15_000, timeout: 60_000 } as const;

// ─── MONTHLY ATTENDANCE SHEET ───────────────────────────────────────────────────
@Injectable()
export class AttendanceSheetsService extends TenantCrudService {
  protected readonly modelName = 'monthlyAttendanceSheet';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Monthly attendance sheet',
    orderBy: { createdAt: 'desc' },
    searchFields: ['payPeriodMonth', 'docType'],
    filterableFields: ['status', 'payPeriodId', 'branchId'],
    include: {
      branch: { select: { id: true, name: true } },
      payPeriod: { select: { id: true, code: true, name: true } },
      _count: { select: { lines: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.fromDate) out.fromDate = new Date(out.fromDate as string);
    if (out.toDate) out.toDate = new Date(out.toDate as string);
    return out;
  }

  async getLines(companyId: string, sheetId: string) {
    await this.findOne(companyId, sheetId);
    return this.prisma.attendanceSheetLine.findMany({
      where: { sheetId },
      orderBy: { ordering: 'asc' },
      include: { employee: { select: { id: true, name: true, employeeNumber: true, departmentId: true, positionId: true } } },
    });
  }

  async replaceLines(companyId: string, sheetId: string, dto: ReplaceAttendanceSheetLinesDto) {
    await this.findOne(companyId, sheetId);
    await this.prisma.$transaction([
      this.prisma.attendanceSheetLine.deleteMany({ where: { sheetId } }),
      this.prisma.attendanceSheetLine.createMany({
        data: dto.rows.map((row, i) => ({
          sheetId,
          employeeId: row.employeeId,
          idNo: row.idNo,
          totalDays: row.totalDays as any,
          workingDays: row.workingDays as any,
          presentDays: row.presentDays as any,
          lopDays: row.lopDays as any,
          payableLeaves: row.payableLeaves as any,
          otHours: row.otHours as any,
          shortTimeHours: row.shortTimeHours as any,
          normalOtHours: row.normalOtHours as any,
          sunday: row.sunday as any,
          misBioMaterDays: row.misBioMaterDays as any,
          compOffDays: row.compOffDays as any,
          annualLeave: row.annualLeave as any,
          halfDayLeave: row.halfDayLeave as any,
          ordering: i,
        })),
      }),
    ]);
    return this.getLines(companyId, sheetId);
  }

  /**
   * Populates the grid from live data: active employees (optionally scoped to
   * the sheet's branch) crossed with their AttendanceEntry rows in
   * [fromDate, toDate]. Present-day counting excludes MISSED entries; LOP is
   * the shortfall against calendar working days. Everything else (OT,
   * comp-off, …) has no upstream source yet and starts at 0 for manual entry.
   */
  async generateLines(companyId: string, sheetId: string) {
    const sheet = await this.findOne(companyId, sheetId) as any;
    if (!sheet.fromDate || !sheet.toDate) {
      throw new BadRequestException('Set From Date and To Date on the sheet before generating.');
    }
    const from: Date = new Date(sheet.fromDate);
    const to: Date = new Date(sheet.toDate);
    const totalDays = inclusiveDays(from, to);

    const payPeriod = sheet.payPeriodId
      ? await this.prisma.payPeriod.findFirst({ where: { id: sheet.payPeriodId, companyId } })
      : null;
    // Pay is costed against the period's working days, not its calendar days —
    // using 31 where the period declares 22 understates every per-day rate.
    const workingDays = payPeriod?.workingDays ?? totalDays;

    const [employees, presentCounts, leaves] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          companyId,
          deletedAt: null,
          isActive: true,
          ...(sheet.branchId ? { branchId: sheet.branchId } : {}),
        },
        select: { id: true, employeeNumber: true },
        orderBy: { employeeNumber: 'asc' },
      }),
      this.prisma.attendanceEntry.groupBy({
        by: ['employeeId'],
        where: { companyId, date: { gte: from, lte: to }, status: { not: 'MISSED' } },
        _count: { _all: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId,
          status: { in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.TAKEN] },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        include: { leaveType: { select: { paid: true } } },
      }),
    ]);

    const presentByEmployee = new Map(presentCounts.map((p) => [p.employeeId, p._count._all]));

    const leavesByEmployee = new Map<string, LeaveWindow[]>();
    for (const l of leaves) {
      const list = leavesByEmployee.get(l.employeeId) ?? [];
      list.push({
        startDate: l.startDate,
        endDate: l.endDate,
        days: l.days,
        paid: l.leaveType?.paid ?? true,
      });
      leavesByEmployee.set(l.employeeId, list);
    }

    const rows = employees.map((emp, i) => {
      const leave = splitLeave(leavesByEmployee.get(emp.id) ?? [], from, to);
      const tracked = presentByEmployee.has(emp.id);

      // Absence is only inferred for employees the company actually clocks.
      // Deriving it for everyone marked each employee absent for the entire
      // period at any site without biometrics, which is where the "everyone is
      // 31 days LOP" payroll came from.
      const present = tracked
        ? (presentByEmployee.get(emp.id) as number)
        : Math.max(workingDays - leave.paidDays - leave.unpaidDays, 0);

      const lop = Math.max(
        Math.round((workingDays - present - leave.paidDays) * 10000) / 10000,
        0,
      );

      return {
        sheetId,
        employeeId: emp.id,
        idNo: emp.employeeNumber ?? null,
        totalDays: totalDays as any,
        workingDays: workingDays as any,
        presentDays: present as any,
        lopDays: lop as any,
        payableLeaves: leave.paidDays as any,
        otHours: 0 as any,
        shortTimeHours: 0 as any,
        normalOtHours: 0 as any,
        sunday: 0 as any,
        misBioMaterDays: 0 as any,
        compOffDays: 0 as any,
        annualLeave: leave.paidDays as any,
        halfDayLeave: 0 as any,
        ordering: i,
      };
    });

    await this.prisma.$transaction([
      this.prisma.attendanceSheetLine.deleteMany({ where: { sheetId } }),
      this.prisma.attendanceSheetLine.createMany({ data: rows }),
    ]);
    return this.getLines(companyId, sheetId);
  }
}

// ─── PAYROLL PROCESS (PayrollRun) ───────────────────────────────────────────────

/** The one status in which a run's header or lines may still change. */
const OPEN = 'Open';

/** A payroll deduction against the recovery ledger: which installment, how much. */
interface PlannedRecovery {
  loanId: string;
  installmentId: string;
  employeeId: string;
  amount: Prisma.Decimal;
}

/** An installment that still has money to recover, with how much is left. */
interface OutstandingInstallment {
  id: string;
  loanId: string;
  employeeId: string;
  isAdvance: boolean;
  dueDate: Date | null;
  outstanding: Prisma.Decimal;
}

@Injectable()
export class PayrollRunsService extends TenantCrudService {
  protected readonly modelName = 'payrollRun';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Payroll run',
    orderBy: { createdAt: 'desc' },
    searchFields: ['jeNo', 'payMonth'],
    filterableFields: ['status', 'payPeriodId', 'runType', 'employeeCategoryId'],
    include: {
      payPeriod: { select: { id: true, code: true, name: true, workingDays: true, fromDate: true, toDate: true } },
      employeeCategory: { select: { id: true, code: true, name: true } },
      journalEntry: { select: { id: true, number: true, status: true, currency: true } },
      _count: { select: { lines: true } },
    },
  };
  constructor(
    prisma: PrismaService,
    private readonly journals: JournalEntriesService,
    private readonly determinations: AccountDeterminationService,
  ) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.fromDate) out.fromDate = new Date(out.fromDate as string);
    if (out.toDate) out.toDate = new Date(out.toDate as string);
    if (out.documentDate) out.documentDate = new Date(out.documentDate as string);
    return out;
  }

  private resolve(companyId: string, which: keyof typeof PAYROLL_DETERMINATION) {
    const d = PAYROLL_DETERMINATION[which];
    return this.determinations.resolve(companyId, d.area, d.key);
  }

  private label(run: any): string {
    return run.jeNo || run.payMonth || run.payPeriod?.name || run.id;
  }

  /**
   * The server-side lock. Checked against the run as it is in the database,
   * never against anything in the request: once a run is posted its figures
   * are in the ledger, and editing the header or lines underneath a live
   * journal entry would let the two disagree.
   */
  private assertOpen(run: any, action: string) {
    const status = run.status ?? OPEN;
    if (status === OPEN) return;
    const hint =
      status === 'Posted'
        ? ' Cancel Posting first to reverse its journal entry.'
        : status === 'Cancelled'
          ? ' A cancelled run is kept as history; create a new run instead.'
          : ' Reverse its salary payments and cancel the posting first.';
    throw new ConflictException(
      `Payroll run ${this.label(run)} is ${status.toLowerCase()} and can no longer be ${action}.${hint}`,
    );
  }

  /**
   * Header rules shared by create and update, applied to the run as it will be
   * after the write: tenant-owned references, and a Regular run must name its
   * pay period (the duplicate-employee index keys on it — a Regular run with
   * no period would escape it, which is also why the DB carries a CHECK).
   */
  private async validateHeader(companyId: string, next: Record<string, any>) {
    const runType = next.runType ?? 'Regular';
    if (runType === 'Regular' && !next.payPeriodId) {
      throw new BadRequestException('A Regular payroll run needs a Pay Period. Choose one, or pick another run type.');
    }
    const [period, category] = await Promise.all([
      next.payPeriodId
        ? this.prisma.payPeriod.findFirst({ where: { id: next.payPeriodId, companyId }, select: { id: true } })
        : Promise.resolve(true),
      next.employeeCategoryId
        ? this.prisma.employeeCategory.findFirst({ where: { id: next.employeeCategoryId, companyId }, select: { id: true } })
        : Promise.resolve(true),
    ]);
    if (!period) throw new BadRequestException('The selected Pay Period does not exist in this company.');
    if (!category) throw new BadRequestException('The selected Employee Category does not exist in this company.');
    if (next.fromDate && next.toDate && new Date(next.fromDate) > new Date(next.toDate)) {
      throw new BadRequestException('From Date must be on or before To Date.');
    }
  }

  async create(companyId: string, dto: any) {
    await this.validateHeader(companyId, dto);
    return super.create(companyId, dto);
  }

  async update(companyId: string, id: string, dto: any) {
    const run = await this.findOne(companyId, id) as any;
    this.assertOpen(run, 'edited');
    await this.validateHeader(companyId, { ...run, ...dto });
    if (
      (dto.payPeriodId !== undefined && dto.payPeriodId !== run.payPeriodId) ||
      (dto.runType !== undefined && dto.runType !== run.runType)
    ) {
      // Moving a run with lines onto another period (or making it Regular) can
      // collide with employees already paid there; say who, before the index does.
      const lines = await this.prisma.payrollRunLine.findMany({ where: { payrollRunId: id }, select: { employeeId: true } });
      await this.assertNoDuplicateEmployees(companyId, { ...run, ...dto }, lines.map((l) => l.employeeId));
    }
    try {
      return await super.update(companyId, id, dto);
    } catch (e) {
      throw this.translateDuplicate(e);
    }
  }

  /** Open runs only. Its lines go with it in the same statement (FK cascade). */
  async remove(companyId: string, id: string) {
    const run = await this.findOne(companyId, id) as any;
    this.assertOpen(run, 'deleted');
    return super.remove(companyId, id);
  }

  /**
   * Takes the run's row lock inside `tx` and returns its status as of *now*.
   *
   * Every write that depends on the run being in a given state (Post, Cancel,
   * Save Grid, Generate) checks that state again under this lock, inside its
   * own transaction. Checking only before the transaction — what the code used
   * to do — let two Posts both see "Open" and both book a journal entry, and
   * let a Save Grid slip in between Post reading the lines and committing.
   * The second caller now waits for the first, then sees what it did.
   */
  private async lockRun(tx: Prisma.TransactionClient, companyId: string, runId: string): Promise<string> {
    return (await this.lockRunRow(tx, companyId, runId)).status;
  }

  /** lockRun, also returning when the run was last changed. */
  private async lockRunRow(tx: Prisma.TransactionClient, companyId: string, runId: string) {
    const rows = await tx.$queryRaw<{ status: string | null; updatedAt: Date }[]>`
      SELECT "status", "updatedAt" FROM "payroll_runs" WHERE "id" = ${runId} AND "companyId" = ${companyId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException(`Payroll run ${runId} not found`);
    return { status: rows[0].status ?? OPEN, updatedAt: rows[0].updatedAt };
  }

  /** assertOpen, against the status read under the lock. */
  private assertOpenLocked(run: any, lockedStatus: string, action: string) {
    this.assertOpen({ ...run, status: lockedStatus }, action);
  }

  async getLines(companyId: string, runId: string) {
    await this.findOne(companyId, runId);
    return this.linesOf(runId);
  }

  /** The grid rows, for a run the caller has already found in this company. */
  private linesOf(runId: string) {
    return this.prisma.payrollRunLine.findMany({
      where: { payrollRunId: runId },
      orderBy: { ordering: 'asc' },
      include: { employee: { select: { id: true, name: true, employeeNumber: true, departmentId: true, positionId: true } } },
    });
  }

  /**
   * "An employee may be in at most one active Regular run per pay period."
   * The partial unique index enforces it; this names the people and the run
   * they are already in, which a constraint violation cannot.
   */
  private async assertNoDuplicateEmployees(companyId: string, run: any, employeeIds: string[]) {
    const conflicts = await this.findRegularRunConflicts(companyId, run, employeeIds);
    if (!conflicts.length) return;
    const shown = conflicts.slice(0, 5).map((c) => `${c.employeeName} (run ${c.runLabel})`).join(', ');
    const more = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : '';
    throw new ConflictException(
      `Already in another active Regular payroll run for this pay period: ${shown}${more}. ` +
        'Remove them here, or cancel that run first.',
    );
  }

  private async findRegularRunConflicts(companyId: string, run: any, employeeIds: string[]) {
    if ((run.runType ?? 'Regular') !== 'Regular' || !run.payPeriodId || !employeeIds.length) return [];
    const rows = await this.prisma.payrollRunLine.findMany({
      where: {
        companyId,
        payPeriodId: run.payPeriodId,
        runType: 'Regular',
        runActive: true,
        employeeId: { in: employeeIds },
        payrollRunId: { not: run.id },
      },
      select: {
        employeeId: true,
        employee: { select: { name: true, employeeNumber: true } },
        payrollRun: { select: { id: true, jeNo: true, payMonth: true, status: true } },
      },
    });
    return rows.map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employee.employeeNumber ? `${r.employee.employeeNumber} ${r.employee.name}` : r.employee.name,
      runLabel: r.payrollRun.jeNo || r.payrollRun.payMonth || r.payrollRun.id.slice(0, 8),
    }));
  }

  /** The partial unique index is the backstop; this turns it into words. */
  private translateDuplicate(e: unknown): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      JSON.stringify(e.meta ?? {}).includes('one_regular_run_per_period')
    ) {
      return new ConflictException(
        'An employee on this run is already in another active Regular payroll run for the same pay period.',
      );
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      JSON.stringify(e.meta ?? {}).includes('employeeId')
    ) {
      return new ConflictException('The same employee appears twice in this payroll run.');
    }
    return e;
  }

  /**
   * Persists the grid exactly as entered, and (re)derives the four payslip
   * aggregates from the row's own earnings/deduction fields rather than
   * trusting anything the client sent for them — a manual edit to Basic or to
   * Loan Ded. must move Total Earnings/Deductions and Net Pay, and a figure
   * that decides someone's pay is never client-computed. See
   * `rowTotals` for the shared formula the frontend mirrors for live display.
   */
  async replaceLines(companyId: string, runId: string, dto: ReplacePayrollRunLinesDto) {
    const run = await this.findOne(companyId, runId) as any;
    this.assertOpen(run, 'changed');

    const ids = dto.rows.map((r) => r.employeeId);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) throw new BadRequestException('The same employee appears twice in this grid. Remove the duplicate row.');
      seen.add(id);
    }
    // employeeId is a bare UUID from the client: it must be one of this
    // company's employees, or a grid could carry another tenant's staff.
    const owned = await this.prisma.employee.count({ where: { companyId, id: { in: ids }, deletedAt: null } });
    if (owned !== ids.length) {
      throw new BadRequestException('One or more employees in this grid do not exist in this company.');
    }
    await this.assertNoDuplicateEmployees(companyId, run, ids);

    try {
      await this.prisma.$transaction(async (tx) => {
        this.assertOpenLocked(run, await this.lockRun(tx, companyId, runId), 'changed');
        await tx.payrollRunLine.deleteMany({ where: { payrollRunId: runId } });
        await tx.payrollRunLine.createMany({
          data: dto.rows.map((row, i) => {
            const totals = rowTotals(row);
            return {
              payrollRunId: runId,
              employeeId: row.employeeId,
              totalDaysWorking: row.totalDaysWorking as any,
              lopDays: row.lopDays as any,
              totalDaysWorked: row.totalDaysWorked as any,
              paidDays: row.paidDays as any,
              payLeaves: row.payLeaves as any,
              basic: row.basic as any,
              entertainment: row.entertainment as any,
              eligibleBasic: row.eligibleBasic as any,
              conveyance: row.conveyance as any,
              education: row.education as any,
              eligibleConveyance: row.eligibleConveyance as any,
              hra: row.hra as any,
              bigCity: row.bigCity as any,
              eligibleHra: row.eligibleHra as any,
              perDayRate: row.perDayRate as any,
              paidLeaveDays: row.paidLeaveDays as any,
              unpaidLeaveDays: row.unpaidLeaveDays as any,
              lopDeduction: row.lopDeduction as any,
              loanDeduction: row.loanDeduction as any,
              advanceDeduction: row.advanceDeduction as any,
              taxableGross: row.taxableGross as any,
              taxDeduction: row.taxDeduction as any,
              adjustmentAdditions: row.adjustmentAdditions as any,
              adjustmentDeductions: row.adjustmentDeductions as any,
              grossPay: totals.grossPay as any,
              totalEarnings: totals.totalEarnings as any,
              totalDeductions: totals.totalDeductions as any,
              netPay: totals.netPay as any,
              ordering: i,
            };
          }),
        });
      }, TX_OPTIONS);
    } catch (e) {
      throw this.translateDuplicate(e);
    }
    return this.linesOf(runId);
  }

  /**
   * Installments that still have something left to recover, due on or before
   * `upTo`, with their outstanding amount computed from the recovery ledger —
   * not from `status`, which is only the ledger's summary.
   *
   * Overdue installments from earlier periods are included on purpose: an
   * installment a previous run did not recover is still owed, and skipping it
   * because its due date fell in an earlier month is how a loan balance stops
   * going down.
   */
  private async outstandingInstallments(
    companyId: string,
    upTo: Date,
    employeeIds?: string[],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const rows = await client.employeeLoanInstallment.findMany({
      where: {
        dueDate: { lte: upTo },
        status: { not: 'Paid' },
        loan: {
          companyId,
          isActive: true,
          approved: true,
          status: { notIn: ['Cancelled', 'Recovered'] },
          ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
        },
      },
      orderBy: [{ dueDate: 'asc' }, { ordering: 'asc' }],
      select: {
        id: true,
        loanId: true,
        dueDate: true,
        amount: true,
        loan: { select: { employeeId: true, loanType: { select: { loanType: true } } } },
        recoveries: { where: { reversedAt: null }, select: { amount: true } },
      },
    });
    const out: OutstandingInstallment[] = [];
    for (const r of rows) {
      const recovered = r.recoveries.reduce((s, x) => s.plus(D(x.amount)), ZERO);
      const outstanding = D(r.amount).minus(recovered);
      if (outstanding.lte(ZERO)) continue;
      out.push({
        id: r.id,
        loanId: r.loanId,
        employeeId: r.loan.employeeId,
        isAdvance: (r.loan.loanType?.loanType ?? '').toLowerCase() === 'advance',
        dueDate: r.dueDate,
        outstanding,
      });
    }
    return out;
  }

  private async periodBounds(companyId: string, run: any) {
    const payPeriod = run.payPeriodId
      ? await this.prisma.payPeriod.findFirst({ where: { id: run.payPeriodId, companyId } })
      : null;
    const from = new Date(payPeriod?.fromDate ?? run.fromDate ?? run.documentDate);
    const to = new Date(payPeriod?.toDate ?? run.toDate ?? run.documentDate);
    return { payPeriod, from, to };
  }

  /**
   * Populates the grid from live data: active employees (narrowed to the run's
   * Employee Category when it has one) crossed with their Grade's first
   * pay-scale stage and, when a Monthly Attendance Sheet exists for the same
   * pay period, that sheet's day counts (falls back to PayPeriod.workingDays
   * otherwise). Employees already in another active Regular run for the same
   * period are left out and reported back, so Generate can never produce the
   * duplicate that Save or Post would then refuse.
   *
   * Loan and advance installments are only suggested on Regular runs — a
   * Supplementary/Off-cycle/Bonus run is extra pay, not the month's recovery.
   */
  async generateLines(companyId: string, runId: string) {
    const run = await this.findOne(companyId, runId) as any;
    this.assertOpen(run, 'regenerated');

    // The run's include already carries its pay period (dates, working days).
    const payPeriod = run.payPeriod ?? null;
    const { from, to } = this.boundsFromRun(run);
    const totalDays = inclusiveDays(from, to);
    const workingDays = payPeriod?.workingDays ?? totalDays;
    const isRegular = (run.runType ?? 'Regular') === 'Regular';

    // One round trip each, in parallel — these do not depend on one another,
    // and running them in sequence was most of this endpoint's latency.
    const [employees, sheet, leaves, installments, adjustments, taxFormulas] =
      await Promise.all([
        this.prisma.employee.findMany({
          where: {
            companyId,
            deletedAt: null,
            isActive: true,
            ...(run.employeeCategoryId ? { employeeCategoryId: run.employeeCategoryId } : {}),
          },
          include: { grade: { include: { payScale: { orderBy: { stage: 'asc' }, take: 1 } } } },
          orderBy: { employeeNumber: 'asc' },
        }),
        run.payPeriodId
          ? this.prisma.monthlyAttendanceSheet.findFirst({
              where: { companyId, payPeriodId: run.payPeriodId },
              orderBy: { updatedAt: 'desc' },
              include: { lines: true },
            })
          : Promise.resolve(null),
        // Only leave that actually happened reduces pay: a PENDING request is
        // not yet a fact, and a REJECTED or CANCELLED one never was.
        this.prisma.leaveRequest.findMany({
          where: {
            companyId,
            status: { in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.TAKEN] },
            startDate: { lte: to },
            endDate: { gte: from },
          },
          include: { leaveType: { select: { paid: true } } },
        }),
        isRegular ? this.outstandingInstallmentsSql(this.prisma, companyId, to) : Promise.resolve([] as OutstandingInstallment[]),
        run.payPeriodId
          ? this.prisma.payrollAdjustment.findMany({
              where: { companyId, payPeriodId: run.payPeriodId },
              orderBy: { updatedAt: 'desc' },
              include: { lines: true },
            })
          : Promise.resolve([]),
        this.prisma.taxFormula.findMany({
          where: { companyId, isActive: true },
          include: { slabs: { orderBy: { ordering: 'asc' } } },
        }),
      ]);

    const conflicts = await this.findRegularRunConflicts(companyId, run, employees.map((e) => e.id));
    const excluded = new Set(conflicts.map((c) => c.employeeId));
    // An employee with no grade, or a grade with no pay-scale stage, would come
    // out as a silent 0-pay row — indistinguishable from a real zero. They are
    // left out and named instead (a real tenant gets grades without amounts;
    // someone has to enter them). Add Row still lets a person pay them by hand.
    const unscaled = employees
      .filter((e) => !excluded.has(e.id) && !e.grade?.payScale?.[0])
      .map((e) => ({
        employeeId: e.id,
        name: e.employeeNumber ? `${e.employeeNumber} ${e.name}` : e.name,
        reason: e.grade ? `No pay scale for grade ${e.grade.code}` : 'No grade assigned',
      }));
    const unscaledIds = new Set(unscaled.map((u) => u.employeeId));
    const payable = employees.filter((e) => !excluded.has(e.id) && !unscaledIds.has(e.id));

    const attendanceByEmployee = new Map<string, any>();
    if (sheet) for (const l of sheet.lines) attendanceByEmployee.set(l.employeeId, l);

    // An adjustment document for the employee's own category wins over an
    // "All employees" one; within each, the most recently updated document.
    // (Before categories, the single latest document for the period applied.)
    const categoryDoc = new Map<string, Map<string, any>>();
    const allDoc = new Map<string, any>();
    for (const doc of [...adjustments].reverse()) {
      const target = doc.employeeCategoryId
        ? (categoryDoc.get(doc.employeeCategoryId) ?? categoryDoc.set(doc.employeeCategoryId, new Map()).get(doc.employeeCategoryId)!)
        : allDoc;
      for (const l of doc.lines) target.set(l.employeeId, l);
    }
    const adjustmentByEmployee = new Map<string, any>();
    for (const emp of employees) {
      const own = emp.employeeCategoryId ? categoryDoc.get(emp.employeeCategoryId)?.get(emp.id) : undefined;
      const line = own ?? allDoc.get(emp.id);
      if (line) adjustmentByEmployee.set(emp.id, line);
    }

    const leavesByEmployee = new Map<string, LeaveWindow[]>();
    for (const l of leaves) {
      const list = leavesByEmployee.get(l.employeeId) ?? [];
      list.push({
        startDate: l.startDate,
        endDate: l.endDate,
        days: l.days,
        paid: l.leaveType?.paid ?? true,
      });
      leavesByEmployee.set(l.employeeId, list);
    }

    const loanDueByEmployee = new Map<string, number>();
    const advanceDueByEmployee = new Map<string, number>();
    for (const inst of installments) {
      const target = inst.isAdvance ? advanceDueByEmployee : loanDueByEmployee;
      target.set(inst.employeeId, (target.get(inst.employeeId) ?? 0) + num(inst.outstanding));
    }

    // A formula tied to the employee's category wins; otherwise the company's
    // single un-scoped formula applies. No formula at all means no tax line,
    // rather than a silent zero that looks like a computed result.
    const taxByCategory = new Map<string, typeof taxFormulas[number]>();
    let defaultFormula: typeof taxFormulas[number] | null = null;
    for (const f of taxFormulas) {
      if (f.employeeCategoryId) taxByCategory.set(f.employeeCategoryId, f);
      else if (!defaultFormula) defaultFormula = f;
    }

    const rows = payable.map((emp, i) => {
      const stage = emp.grade?.payScale?.[0] ?? null;
      const att = attendanceByEmployee.get(emp.id);
      const adj = adjustmentByEmployee.get(emp.id) ?? null;
      const formula =
        (emp.employeeCategoryId ? taxByCategory.get(emp.employeeCategoryId) : null) ??
        defaultFormula;

      const leave = splitLeave(leavesByEmployee.get(emp.id) ?? [], from, to);
      // lopDeduction/loanDeduction/taxDeduction still come from computePayslip
      // — real attendance, the loan schedule and the tax slabs, not something
      // a plain sum could reconstruct. Only the headline grossPay/totalEarnings
      // /totalDeductions/netPay are then re-derived by `rowTotals` from the
      // row's own visible cells, so Generate and a later plain Save agree.
      const slip = computePayslip({
        stage,
        workingDays: att?.workingDays != null ? num(att.workingDays) : workingDays,
        totalDays,
        presentDays: att?.presentDays != null ? num(att.presentDays) : null,
        leave,
        loanDue: loanDueByEmployee.get(emp.id) ?? 0,
        advanceDue: advanceDueByEmployee.get(emp.id) ?? 0,
        adjustment: adj,
        taxBands: formula?.slabs ?? [],
        taxMonths: formula?.noOfMonths ?? 12,
      });

      const basic = stage?.basicPay ?? null;
      const conveyance = stage?.conveyanceAllowance ?? null;
      const hra = stage?.hra ?? null;
      const totals = rowTotals({
        basic, hra, conveyance, entertainment: 0, education: 0, bigCity: 0,
        adjustmentAdditions: slip.adjustmentAdditions,
        lopDeduction: slip.lopDeduction, loanDeduction: slip.loanDeduction,
        advanceDeduction: slip.advanceDeduction,
        taxDeduction: slip.taxDeduction, adjustmentDeductions: slip.adjustmentDeductions,
      });

      return {
        payrollRunId: runId,
        employeeId: emp.id,
        totalDaysWorking: slip.totalDaysWorking as any,
        lopDays: slip.lopDays as any,
        totalDaysWorked: slip.totalDaysWorked as any,
        paidDays: slip.paidDays as any,
        payLeaves: slip.paidLeaveDays as any,
        basic: basic as any,
        entertainment: 0 as any,
        eligibleBasic: basic as any,
        conveyance: conveyance as any,
        education: 0 as any,
        eligibleConveyance: conveyance as any,
        hra: hra as any,
        bigCity: 0 as any,
        eligibleHra: hra as any,
        perDayRate: slip.perDayRate as any,
        paidLeaveDays: slip.paidLeaveDays as any,
        unpaidLeaveDays: slip.unpaidLeaveDays as any,
        lopDeduction: slip.lopDeduction as any,
        loanDeduction: slip.loanDeduction as any,
        advanceDeduction: slip.advanceDeduction as any,
        taxableGross: slip.taxableGross as any,
        taxDeduction: slip.taxDeduction as any,
        adjustmentAdditions: slip.adjustmentAdditions as any,
        adjustmentDeductions: slip.adjustmentDeductions as any,
        grossPay: totals.grossPay as any,
        totalEarnings: totals.totalEarnings as any,
        totalDeductions: totals.totalDeductions as any,
        netPay: totals.netPay as any,
        ordering: i,
      };
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        this.assertOpenLocked(run, await this.lockRun(tx, companyId, runId), 'regenerated');
        await tx.payrollRunLine.deleteMany({ where: { payrollRunId: runId } });
        await tx.payrollRunLine.createMany({ data: rows });
      }, TX_OPTIONS);
    } catch (e) {
      throw this.translateDuplicate(e);
    }
    return {
      lines: await this.linesOf(runId),
      skipped: conflicts.map((c) => ({
        employeeId: c.employeeId,
        name: c.employeeName,
        run: c.runLabel,
        reason: `Already in Regular run ${c.runLabel} for this period`,
      })),
      noPayScale: unscaled,
    };
  }

  /**
   * The company's base currency, which must exist in its own currency master:
   * `journal_entries.currency` is a foreign key onto `currencies(companyId,
   * code)`. Refusing here is better than the old silent fallback to USD, which
   * would have booked a PKR company's payroll as dollars.
   */
  private async companyCurrency(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { currency: true } });
    const code = company?.currency?.trim();
    if (!code) {
      throw new BadRequestException(
        'This company has no base currency. Set it under Administration → Company Details before posting payroll.',
      );
    }
    const master = await this.prisma.currency.findFirst({ where: { companyId, code }, select: { id: true } });
    if (!master) {
      throw new BadRequestException(
        `The company currency ${code} is not in this company's currency master. Add it under Financials → Currencies before posting payroll.`,
      );
    }
    return code;
  }

  /**
   * Splits each line's Loan Ded. and Advance Ded. across that employee's
   * outstanding installments, oldest due first. A deduction larger than what
   * is actually owed is refused rather than booked: crediting a receivable
   * with money nobody owes would leave it negative.
   */
  private planRecoveries(
    lines: { id: string; employeeId: string; loanDeduction: unknown; advanceDeduction: unknown }[],
    installments: OutstandingInstallment[],
    names: Map<string, string>,
  ): (PlannedRecovery & { lineId: string })[] {
    const byEmployee = new Map<string, OutstandingInstallment[]>();
    for (const inst of installments) {
      const list = byEmployee.get(inst.employeeId) ?? [];
      list.push(inst);
      byEmployee.set(inst.employeeId, list);
    }
    const plan: (PlannedRecovery & { lineId: string })[] = [];
    for (const line of lines) {
      for (const isAdvance of [false, true]) {
        let remaining = D(isAdvance ? line.advanceDeduction : line.loanDeduction);
        if (remaining.lte(ZERO)) continue;
        const pool = (byEmployee.get(line.employeeId) ?? []).filter((i) => i.isAdvance === isAdvance);
        const owed = pool.reduce((s, i) => s.plus(i.outstanding), ZERO);
        if (remaining.gt(owed)) {
          const who = names.get(line.employeeId) ?? line.employeeId;
          const what = isAdvance ? 'Advance Ded.' : 'Loan Ded.';
          throw new ConflictException(
            `${what} for ${who} is ${money(remaining)} but only ${money(owed)} is outstanding on their ` +
              `${isAdvance ? 'salary advances' : 'loans'} up to this period. Correct the grid (or Generate again) and retry.`,
          );
        }
        for (const inst of pool) {
          if (remaining.lte(ZERO)) break;
          const take = Prisma.Decimal.min(remaining, inst.outstanding);
          plan.push({ lineId: line.id, loanId: inst.loanId, installmentId: inst.id, employeeId: line.employeeId, amount: take });
          inst.outstanding = inst.outstanding.minus(take);
          remaining = remaining.minus(take);
        }
      }
    }
    return plan;
  }

  /**
   * Books the run to the G/L — this is the only place Payroll ever writes to
   * `journal_lines`, same rule AR/AP's `SubledgerService` follows: no second
   * route to the ledger, so the balance/period/immutability guards in
   * `JournalEntriesService` cannot be bypassed from HR.
   *
   *   Dr  Salary expense      netPay + tax + loan + advance
   *   Cr  Salaries payable    net pay               (what's still owed to employees)
   *   Cr  Tax payable         tax withheld           (only if any line has tax)
   *   Cr  Loan receivable     loan recovered         (only if any line has a loan deduction)
   *   Cr  Advance receivable  advance recovered      (only if any line has an advance deduction)
   *
   * `netPay + tax + loan + advance` is exactly `totalEarnings - lopDeduction -
   * adjustmentDeductions` by construction of `rowTotals`, so the entry balances
   * without a reconciling line.
   *
   * In the same transaction as the journal entry, every loan/advance deduction
   * is written to the recovery ledger (which marks the installments Paid), so
   * the posting and the loan balance can never disagree. The ledger's trigger
   * locks each installment and refuses to recover it twice — including against
   * a concurrent post of another run.
   */
  async post(companyId: string, runId: string, userId: string) {
    // Fast, friendly refusals from a plain read. They are repeated under the
    // lock below — this read alone decides nothing.
    const run = await this.findOne(companyId, runId) as any;
    this.assertPostable(run, run.status ?? OPEN);

    // The route only needs hr-payroll; writing to the ledger needs the company
    // to run Financials at all. Without it there is no one to read the entry.
    const financials = await this.prisma.companyModule.findFirst({
      where: { companyId, isEnabled: true, module: { slug: 'financials' } },
      select: { id: true },
    });
    if (!financials) {
      throw new ForbiddenException(
        'The Financials module is not enabled for this company, so payroll cannot be posted to the G/L. ' +
          'Enable Financials under Administration → License / Modules first.',
      );
    }
    const [currency, { to }, accounts] = await Promise.all([
      this.companyCurrency(companyId),
      // The run's include already carries its pay period's dates.
      Promise.resolve(this.boundsFromRun(run)),
      this.payrollAccounts(companyId),
    ]);
    const label = run.payMonth || run.payPeriod?.name || run.id;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock first, then read. A second Post waits here and then sees
        // "Posted"; a Save Grid waits for this commit and then sees "Posted".
        const locked = await this.lockRunRow(tx, companyId, runId);
        this.assertPostable(run, locked.status);
        // The header (document date, period, pay month) was read before the
        // lock. If someone saved it in between, post nothing rather than a
        // journal dated or labelled from the old values.
        if (new Date(locked.updatedAt).getTime() !== new Date(run.updatedAt).getTime()) {
          throw new ConflictException(
            `Payroll run ${this.label(run)} was changed while you were posting it. Refresh it and post again.`,
          );
        }

        const lines = await tx.payrollRunLine.findMany({
          where: { payrollRunId: runId },
          select: { id: true, employeeId: true, netPay: true, taxDeduction: true, loanDeduction: true, advanceDeduction: true },
        });
        if (!lines.length) {
          throw new BadRequestException(
            'This payroll run has no employee lines. Generate or add rows before posting.',
          );
        }

        const totals = lines.reduce(
          (acc, l) => ({
            netPay: acc.netPay.plus(D(l.netPay)),
            tax: acc.tax.plus(D(l.taxDeduction)),
            loan: acc.loan.plus(D(l.loanDeduction)),
            advance: acc.advance.plus(D(l.advanceDeduction)),
          }),
          { netPay: ZERO, tax: ZERO, loan: ZERO, advance: ZERO },
        );
        if (totals.netPay.lte(ZERO)) {
          throw new BadRequestException('Total net pay for this run is zero — nothing to post.');
        }

        const expenseAccount = accounts.require('salaryExpense');
        const payableAccount = accounts.require('salariesPayable');
        const taxAccount = totals.tax.gt(ZERO) ? accounts.require('taxPayable') : null;
        const loanAccount = totals.loan.gt(ZERO) ? accounts.require('loanReceivable') : null;
        const advanceAccount = totals.advance.gt(ZERO) ? accounts.require('advanceReceivable') : null;
        const installments = totals.loan.gt(ZERO) || totals.advance.gt(ZERO)
          ? await this.outstandingInstallmentsSql(tx, companyId, to, lines.map((l) => l.employeeId))
          : [];

        // Names are only needed to word a refusal; read them only then.
        const plan = await this.planRecoveriesOrExplain(tx, lines, installments);

        const expenseAmount = totals.netPay.plus(totals.tax).plus(totals.loan).plus(totals.advance);
        const journalLines: JournalLineDto[] = [
          { accountId: expenseAccount, debit: money(expenseAmount), description: `Salary expense — ${label}` },
          { accountId: payableAccount, credit: money(totals.netPay), description: `Salaries payable — ${label}` },
        ];
        if (taxAccount) {
          journalLines.push({ accountId: taxAccount, credit: money(totals.tax), description: `Tax withheld — ${label}` });
        }
        if (loanAccount) {
          journalLines.push({ accountId: loanAccount, credit: money(totals.loan), description: `Loan recovered — ${label}` });
        }
        if (advanceAccount) {
          journalLines.push({ accountId: advanceAccount, credit: money(totals.advance), description: `Advance recovered — ${label}` });
        }

        const entry = await this.journals.postFromSource(tx, companyId, userId, {
          date: run.documentDate ?? new Date(),
          source: 'payroll_run',
          sourceId: run.id,
          description: `Payroll run — ${label}`,
          currency,
          area: 'general',
          lines: journalLines,
        });

        if (plan.length) {
          // One statement for every recovery, not one round trip per employee.
          await tx.loanRecovery.createMany({
            data: plan.map((p) => ({
              companyId,
              loanId: p.loanId,
              installmentId: p.installmentId,
              amount: p.amount,
              source: 'payroll',
              payrollRunId: run.id,
              payrollRunLineId: p.lineId,
              createdById: userId,
            })),
          });
        }

        const updated = await tx.payrollRun.update({
          where: { id: runId },
          data: { status: 'Posted', journalEntryId: entry.id, jeNo: entry.number },
        });
        // The response shape the window expects, from what is already in
        // hand — re-reading the includes here would add round trips while
        // the run is still locked.
        return {
          ...updated,
          payPeriod: run.payPeriod ?? null,
          employeeCategory: run.employeeCategory ?? null,
          journalEntry: { id: entry.id, number: entry.number, status: entry.status, currency: entry.currency },
          _count: { lines: lines.length },
        };
      }, PAYROLL_TX);
    } catch (e) {
      throw translateRecoveryError(e);
    }
  }

  private boundsFromRun(run: any) {
    const p = run.payPeriod;
    return {
      from: new Date(p?.fromDate ?? run.fromDate ?? run.documentDate),
      to: new Date(p?.toDate ?? run.toDate ?? run.documentDate),
    };
  }

  /**
   * Every PAYROLL determination in one query. `require` gives the same
   * "No G/L account is mapped for PAYROLL/…" refusal as resolving one at a
   * time did — only for the keys this run actually needs.
   */
  private async payrollAccounts(companyId: string) {
    const rows = await this.prisma.accountDetermination.findMany({
      where: { companyId, area: 'PAYROLL' as never },
      select: { key: true, accountId: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.accountId]));
    return {
      require: (which: keyof typeof PAYROLL_DETERMINATION) => {
        const d = PAYROLL_DETERMINATION[which];
        const id = byKey.get(d.key);
        if (!id) {
          throw new BadRequestException(
            `No G/L account is mapped for ${d.area}/${d.key}. ` +
              'Set it under Administration → Setup → Financials → G/L Account Determination.',
          );
        }
        return id;
      },
    };
  }

  /**
   * outstandingInstallments in a single statement (Prisma splits the
   * loan/loan-type/recovery includes into four sequential queries). Runs on
   * the posting transaction, so it sees that transaction's own writes.
   */
  private async outstandingInstallmentsSql(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    upTo: Date,
    employeeIds?: string[],
  ): Promise<OutstandingInstallment[]> {
    if (employeeIds && !employeeIds.length) return [];
    const byEmployee = employeeIds ? Prisma.sql`AND l."employeeId" IN (${Prisma.join(employeeIds)})` : Prisma.empty;
    const rows = await tx.$queryRaw<{ id: string; loanId: string; employeeId: string; loanType: string | null; dueDate: Date | null; outstanding: Prisma.Decimal }[]>`
      SELECT i."id", i."loanId", l."employeeId", lt."loanType", i."dueDate",
             i."amount" - COALESCE((SELECT SUM(r."amount") FROM "loan_recoveries" r
                                     WHERE r."installmentId" = i."id" AND r."reversedAt" IS NULL), 0) AS outstanding
      FROM "employee_loan_installments" i
      JOIN "employee_loans" l ON l."id" = i."loanId"
      LEFT JOIN "loan_types" lt ON lt."id" = l."loanTypeId"
      WHERE l."companyId" = ${companyId}
        ${byEmployee}
        AND l."isActive" AND l."approved"
        AND (l."status" IS NULL OR l."status" NOT IN ('Cancelled', 'Recovered'))
        AND i."dueDate" <= ${upTo}
        AND i."status" IS DISTINCT FROM 'Paid'
      ORDER BY i."dueDate" ASC, i."ordering" ASC`;
    return rows
      .map((r) => ({
        id: r.id,
        loanId: r.loanId,
        employeeId: r.employeeId,
        isAdvance: (r.loanType ?? '').toLowerCase() === 'advance',
        dueDate: r.dueDate,
        outstanding: D(r.outstanding),
      }))
      .filter((r) => r.outstanding.gt(ZERO));
  }

  /** planRecoveries, looking employee names up only when it has to refuse. */
  private async planRecoveriesOrExplain(
    tx: Prisma.TransactionClient,
    lines: { id: string; employeeId: string; loanDeduction: unknown; advanceDeduction: unknown }[],
    installments: OutstandingInstallment[],
  ) {
    try {
      return this.planRecoveries(lines, installments.map((i) => ({ ...i })), new Map());
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;
      const emps = await tx.employee.findMany({
        where: { id: { in: lines.map((l) => l.employeeId) } },
        select: { id: true, name: true, employeeNumber: true },
      });
      const names = new Map(emps.map((x) => [x.id, x.employeeNumber ? `${x.employeeNumber} ${x.name}` : x.name]));
      return this.planRecoveries(lines, installments, names);
    }
  }

  private assertPostable(run: any, status: string) {
    if (status === 'Cancelled') {
      throw new ConflictException(`Payroll run ${this.label(run)} is cancelled and cannot be posted.`);
    }
    if (status !== OPEN) {
      throw new ConflictException(`Payroll run ${this.label(run)} is already posted.`);
    }
  }

  private assertCancellable(run: any, status: string) {
    if (status === 'Partially Paid' || status === 'Paid') {
      throw new ConflictException(
        `Payroll run ${this.label(run)} has salary payments. Reverse those payments before cancelling the posting.`,
      );
    }
    if (status !== 'Posted') {
      throw new ConflictException(
        `Only a posted payroll run can be cancelled; ${this.label(run)} is ${status.toLowerCase()}.`,
      );
    }
  }

  /**
   * Reverses the run's journal entry and flips it to Cancelled — mirrors
   * `ARInvoicesService.void`. The original posting is never edited, only
   * offset. Exactly this run's recovery rows are reversed in the same
   * transaction, which puts the installments back to what they were.
   */
  async cancel(companyId: string, runId: string, userId: string, dto: CancelPayrollRunDto = {}) {
    const run = await this.findOne(companyId, runId) as any;
    this.assertCancellable(run, run.status ?? OPEN);
    if (!run.journalEntryId) {
      throw new ConflictException(`Payroll run ${this.label(run)} has no linked journal entry to reverse.`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Same pattern as Post: a second Cancel waits here, then sees "Cancelled".
      // (journal_entries.reversalOfId is unique as well, so the ledger itself
      // cannot hold two reversals of one entry.)
      this.assertCancellable(run, await this.lockRun(tx, companyId, runId));
      const reversal = await this.journals.reverseFromSource(tx, companyId, userId, run.journalEntryId, {
        reason: dto.reason || `Cancellation of payroll run ${this.label(run)}`,
      });

      await tx.loanRecovery.updateMany({
        where: { companyId, payrollRunId: runId, source: 'payroll', reversedAt: null },
        data: { reversedAt: new Date(), reversedById: userId },
      });

      const updated = await tx.payrollRun.update({
        where: { id: runId },
        data: { status: 'Cancelled', cancellationJeNo: reversal.number },
      });
      return {
        ...updated,
        payPeriod: run.payPeriod ?? null,
        employeeCategory: run.employeeCategory ?? null,
        journalEntry: run.journalEntry ? { ...run.journalEntry, status: 'REVERSED' } : null,
        _count: run._count,
      };
    }, PAYROLL_TX);
  }
}

/**
 * The recovery ledger's trigger refuses an over-recovery with a message
 * tagged LOAN_OVER_RECOVERY. It surfaces from Prisma as a raw database error;
 * this is where it becomes a 409 a user can act on.
 */
export function translateRecoveryError(e: unknown): unknown {
  const text = e instanceof Error ? e.message : String(e);
  if (text.includes('LOAN_OVER_RECOVERY')) {
    return new ConflictException(
      'A loan or advance installment in this run has already been recovered (by another payroll run or a payment). ' +
        'Generate the run again to pick up the current balances, then post.',
    );
  }
  return e;
}

// ─── PAYROLL MONTHLY ADJUSTMENTS ───────────────────────────────────────────────
@Injectable()
export class PayrollAdjustmentsService extends TenantCrudService {
  protected readonly modelName = 'payrollAdjustment';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Payroll adjustment',
    orderBy: { createdAt: 'desc' },
    filterableFields: ['status', 'payPeriodId', 'employeeCategoryId'],
    include: {
      payPeriod: { select: { id: true, code: true, name: true } },
      employeeCategory: { select: { id: true, code: true, name: true } },
      _count: { select: { lines: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.documentDate) out.documentDate = new Date(out.documentDate as string);
    return out;
  }

  /** Pay period and category are bare UUIDs from the client: both must be this company's. */
  private async validateRefs(companyId: string, dto: any) {
    const [period, category] = await Promise.all([
      dto.payPeriodId ? this.prisma.payPeriod.findFirst({ where: { id: dto.payPeriodId, companyId }, select: { id: true } }) : true,
      dto.employeeCategoryId ? this.prisma.employeeCategory.findFirst({ where: { id: dto.employeeCategoryId, companyId }, select: { id: true } }) : true,
    ]);
    if (!period) throw new BadRequestException('The selected Pay Period does not exist in this company.');
    if (!category) throw new BadRequestException('The selected Employee Category does not exist in this company.');
  }

  async create(companyId: string, dto: any) {
    await this.validateRefs(companyId, dto);
    return super.create(companyId, dto);
  }

  async update(companyId: string, id: string, dto: any) {
    await this.validateRefs(companyId, dto);
    return super.update(companyId, id, dto);
  }

  async getLines(companyId: string, adjustmentId: string) {
    await this.findOne(companyId, adjustmentId);
    return this.prisma.payrollAdjustmentLine.findMany({
      where: { adjustmentId },
      orderBy: { ordering: 'asc' },
      include: { employee: { select: { id: true, name: true, employeeNumber: true } } },
    });
  }

  async replaceLines(companyId: string, adjustmentId: string, dto: ReplacePayrollAdjustmentLinesDto) {
    const doc = await this.findOne(companyId, adjustmentId) as any;
    // Every row must be one of this company's employees — and, on a
    // category document, one of that category's — or Generate would apply
    // the line to someone the document was never meant for.
    const ids = [...new Set(dto.rows.map((r) => r.employeeId))];
    if (ids.length !== dto.rows.length) {
      throw new BadRequestException('The same employee appears twice in this document. Remove the duplicate row.');
    }
    const inScope = await this.prisma.employee.findMany({
      where: { companyId, id: { in: ids }, deletedAt: null, ...(doc.employeeCategoryId ? { employeeCategoryId: doc.employeeCategoryId } : {}) },
      select: { id: true },
    });
    if (inScope.length !== ids.length) {
      throw new BadRequestException(
        doc.employeeCategoryId
          ? `One or more employees in this grid are not in the ${doc.employeeCategory?.name ?? 'selected'} category (or not in this company).`
          : 'One or more employees in this grid do not exist in this company.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.payrollAdjustmentLine.deleteMany({ where: { adjustmentId } }),
      this.prisma.payrollAdjustmentLine.createMany({
        data: dto.rows.map((row, i) => ({
          adjustmentId,
          employeeId: row.employeeId,
          idNo: row.idNo,
          arrears: row.arrears as any,
          generalDeduction: row.generalDeduction as any,
          carAllowance: row.carAllowance as any,
          carInsLaptopDed: row.carInsLaptopDed as any,
          taDa: row.taDa as any,
          dowryAllowance: row.dowryAllowance as any,
          taxableAddition: row.taxableAddition as any,
          fuel: row.fuel as any,
          messDeduction: row.messDeduction as any,
          generalDeduction2: row.generalDeduction2 as any,
          carInsLaptopDed2: row.carInsLaptopDed2 as any,
          loanDeduction: row.loanDeduction as any,
          deduction11: row.deduction11 as any,
          deduction12: row.deduction12 as any,
          deduction13: row.deduction13 as any,
          deduction14: row.deduction14 as any,
          deduction15: row.deduction15 as any,
          amount: row.amount as any,
          remarks: row.remarks,
          ordering: i,
        })),
      }),
    ]);
    return this.getLines(companyId, adjustmentId);
  }
}

// ─── LOAN APPLICATION (EmployeeLoan) ───────────────────────────────────────────
@Injectable()
export class EmployeeLoansService extends TenantCrudService {
  protected readonly modelName = 'employeeLoan';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Employee loan',
    orderBy: { documentDate: 'desc' },
    searchFields: ['code'],
    filterableFields: ['isActive', 'status', 'employeeId', 'loanTypeId', 'approved'],
    uniqueBy: ['code'],
    include: {
      employee: { select: { id: true, name: true, employeeNumber: true } },
      loanType: { select: { id: true, code: true, description: true } },
      installments: { orderBy: { ordering: 'asc' } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.documentDate) out.documentDate = new Date(out.documentDate as string);
    if (out.effectiveDate) out.effectiveDate = new Date(out.effectiveDate as string);
    return out;
  }

  async create(companyId: string, dto: any) {
    const created = await super.create(companyId, dto);
    if (dto.noOfInstallments && dto.effectiveDate) {
      await this.generateInstallments(companyId, created.id);
    }
    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, id: string, dto: any) {
    const reschedules =
      dto.noOfInstallments !== undefined ||
      dto.effectiveDate !== undefined ||
      dto.loanAmount !== undefined ||
      dto.amountPerMonth !== undefined;
    // Regenerating deletes and rebuilds every installment. Once payroll has
    // recovered any of them, that would erase what was already collected, so
    // the schedule is frozen from the first recovery on (the FK from
    // loan_recoveries refuses the delete anyway; this says why).
    if (reschedules) await this.assertScheduleUntouched(companyId, id, 'change the amount, installments or effective date of');
    await super.update(companyId, id, dto);
    if (reschedules) {
      const fresh = await this.prisma.employeeLoan.findFirst({ where: { id, companyId } });
      if (fresh?.noOfInstallments && fresh.effectiveDate) {
        await this.generateInstallments(companyId, id);
      }
    }
    return this.findOne(companyId, id);
  }

  async getInstallments(companyId: string, loanId: string) {
    await this.findOne(companyId, loanId);
    return this.prisma.employeeLoanInstallment.findMany({ where: { loanId }, orderBy: { ordering: 'asc' } });
  }

  private async assertScheduleUntouched(companyId: string, loanId: string, action: string) {
    const recovered = await this.prisma.loanRecovery.count({ where: { companyId, loanId } });
    if (recovered) {
      throw new ConflictException(
        `Payroll has already recovered installments of this loan, so you can no longer ${action} it. ` +
          'Cancel the payroll posting that recovered them first.',
      );
    }
  }

  /**
   * Manual override for the schedule's dates and amounts. Status is not
   * accepted: whether an installment is paid comes from the recovery ledger,
   * so a hand-typed "Paid" can never hide money that was not collected.
   */
  async replaceInstallments(companyId: string, loanId: string, dto: ReplaceLoanInstallmentsDto) {
    await this.findOne(companyId, loanId);
    await this.assertScheduleUntouched(companyId, loanId, 'edit the installment schedule of');
    await this.prisma.$transaction([
      this.prisma.employeeLoanInstallment.deleteMany({ where: { loanId } }),
      this.prisma.employeeLoanInstallment.createMany({
        data: dto.rows.map((row, i) => ({
          loanId,
          ordering: i,
          month: row.month,
          year: row.year,
          dueDate: row.dueDate ? new Date(row.dueDate) : null,
          amount: row.amount as any,
          status: 'Pending',
        })),
      }),
    ]);
    return this.getInstallments(companyId, loanId);
  }

  /**
   * loanAmount / noOfInstallments (or the explicit amountPerMonth), one row
   * per month from effectiveDate. Works entirely in UTC (effectiveDate is a
   * UTC midnight timestamp; mixing in local-timezone Date getters shifted the
   * day backward in negative-UTC-offset timezones) and clamps the day to the
   * target month's length so e.g. a Jan-31 start doesn't skip April into May.
   */
  private async generateInstallments(companyId: string, loanId: string) {
    const loan = await this.prisma.employeeLoan.findFirst({ where: { id: loanId, companyId } });
    if (!loan || !loan.noOfInstallments || !loan.effectiveDate) return;
    const perMonth = loan.amountPerMonth != null
      ? Number(loan.amountPerMonth)
      : Number(loan.loanAmount) / loan.noOfInstallments;

    const start = new Date(loan.effectiveDate);
    const startYear = start.getUTCFullYear();
    const startMonth = start.getUTCMonth();
    const startDay = start.getUTCDate();

    const rows = Array.from({ length: loan.noOfInstallments }, (_, i) => {
      const targetMonth = startMonth + i;
      const daysInTargetMonth = new Date(Date.UTC(startYear, targetMonth + 1, 0)).getUTCDate();
      const due = new Date(Date.UTC(startYear, targetMonth, Math.min(startDay, daysInTargetMonth)));
      return {
        loanId,
        ordering: i,
        month: due.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
        year: due.getUTCFullYear(),
        dueDate: due,
        amount: perMonth as any,
        status: 'Pending',
      };
    });

    await this.prisma.$transaction([
      this.prisma.employeeLoanInstallment.deleteMany({ where: { loanId } }),
      this.prisma.employeeLoanInstallment.createMany({ data: rows }),
    ]);
  }
}
