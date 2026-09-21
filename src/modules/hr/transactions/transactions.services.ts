import { BadRequestException, Injectable } from '@nestjs/common';
import { LeaveRequestStatus } from '@prisma/client';
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
import {
  ReplaceAttendanceSheetLinesDto,
  ReplacePayrollRunLinesDto,
  ReplacePayrollAdjustmentLinesDto,
  ReplaceLoanInstallmentsDto,
} from './transactions.dto';

const dayMs = 24 * 60 * 60 * 1000;

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
@Injectable()
export class PayrollRunsService extends TenantCrudService {
  protected readonly modelName = 'payrollRun';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Payroll run',
    orderBy: { createdAt: 'desc' },
    searchFields: ['jeNo', 'payMonth'],
    filterableFields: ['status', 'payPeriodId'],
    include: {
      payPeriod: { select: { id: true, code: true, name: true } },
      _count: { select: { lines: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.fromDate) out.fromDate = new Date(out.fromDate as string);
    if (out.toDate) out.toDate = new Date(out.toDate as string);
    if (out.documentDate) out.documentDate = new Date(out.documentDate as string);
    return out;
  }

  async getLines(companyId: string, runId: string) {
    await this.findOne(companyId, runId);
    return this.prisma.payrollRunLine.findMany({
      where: { payrollRunId: runId },
      orderBy: { ordering: 'asc' },
      include: { employee: { select: { id: true, name: true, employeeNumber: true, departmentId: true, positionId: true } } },
    });
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
    await this.findOne(companyId, runId);
    await this.prisma.$transaction([
      this.prisma.payrollRunLine.deleteMany({ where: { payrollRunId: runId } }),
      this.prisma.payrollRunLine.createMany({
        data: dto.rows.map((row, i) => {
          const totals = rowTotals(row);
          return {
            payrollRunId: runId,
            employeeId: row.employeeId,
            employeeType: row.employeeType,
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
      }),
    ]);
    return this.getLines(companyId, runId);
  }

  /**
   * Populates the grid from live data: active employees crossed with their
   * Grade's first pay-scale stage (basic/HRA/conveyance) and, when a Monthly
   * Attendance Sheet exists for the same pay period, that sheet's day counts
   * (falls back to PayPeriod.workingDays otherwise). Entertainment/education/
   * big-city/eligible-* columns have no upstream source in this system yet —
   * they start at 0 for manual entry, same as the base salary components do
   * when the employee has no grade assigned.
   */
  async generateLines(companyId: string, runId: string) {
    const run = await this.findOne(companyId, runId) as any;

    // The period bounds decide which leave, which loan installments and which
    // adjustment document belong to this run. Fall back to the run's own dates
    // when it is not tied to a PayPeriod.
    const payPeriod = run.payPeriodId
      ? await this.prisma.payPeriod.findFirst({ where: { id: run.payPeriodId, companyId } })
      : null;
    const from = new Date(payPeriod?.fromDate ?? run.fromDate ?? run.documentDate);
    const to = new Date(payPeriod?.toDate ?? run.toDate ?? run.documentDate);
    const totalDays = inclusiveDays(from, to);
    const workingDays = payPeriod?.workingDays ?? totalDays;

    // One round trip each, in parallel — these do not depend on one another,
    // and running them in sequence was most of this endpoint's latency.
    const [employees, sheet, leaves, installments, adjustment, taxFormulas] =
      await Promise.all([
        this.prisma.employee.findMany({
          where: { companyId, deletedAt: null, isActive: true },
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
        this.prisma.employeeLoanInstallment.findMany({
          where: {
            dueDate: { gte: from, lte: to },
            status: { not: 'Paid' },
            loan: { companyId, isActive: true, approved: true, status: { not: 'Cancelled' } },
          },
          include: { loan: { select: { employeeId: true } } },
        }),
        run.payPeriodId
          ? this.prisma.payrollAdjustment.findFirst({
              where: { companyId, payPeriodId: run.payPeriodId },
              orderBy: { updatedAt: 'desc' },
              include: { lines: true },
            })
          : Promise.resolve(null),
        this.prisma.taxFormula.findMany({
          where: { companyId, isActive: true },
          include: { slabs: { orderBy: { ordering: 'asc' } } },
        }),
      ]);

    const attendanceByEmployee = new Map<string, any>();
    if (sheet) for (const l of sheet.lines) attendanceByEmployee.set(l.employeeId, l);

    const adjustmentByEmployee = new Map<string, any>();
    if (adjustment) for (const l of adjustment.lines) adjustmentByEmployee.set(l.employeeId, l);

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
    for (const inst of installments) {
      const empId = inst.loan.employeeId;
      loanDueByEmployee.set(empId, (loanDueByEmployee.get(empId) ?? 0) + num(inst.amount));
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

    const rows = employees.map((emp, i) => {
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
        taxDeduction: slip.taxDeduction, adjustmentDeductions: slip.adjustmentDeductions,
      });

      return {
        payrollRunId: runId,
        employeeId: emp.id,
        employeeType: run.employeeType ?? null,
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

    await this.prisma.$transaction([
      this.prisma.payrollRunLine.deleteMany({ where: { payrollRunId: runId } }),
      this.prisma.payrollRunLine.createMany({ data: rows }),
    ]);
    return this.getLines(companyId, runId);
  }
}

// ─── PAYROLL MONTHLY ADJUSTMENTS ───────────────────────────────────────────────
@Injectable()
export class PayrollAdjustmentsService extends TenantCrudService {
  protected readonly modelName = 'payrollAdjustment';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Payroll adjustment',
    orderBy: { createdAt: 'desc' },
    filterableFields: ['status', 'payPeriodId'],
    include: {
      payPeriod: { select: { id: true, code: true, name: true } },
      _count: { select: { lines: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.documentDate) out.documentDate = new Date(out.documentDate as string);
    return out;
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
    await this.findOne(companyId, adjustmentId);
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
    await super.update(companyId, id, dto);
    if (
      dto.noOfInstallments !== undefined ||
      dto.effectiveDate !== undefined ||
      dto.loanAmount !== undefined ||
      dto.amountPerMonth !== undefined
    ) {
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

  /** Manual override for the schedule — e.g. marking an installment Paid. */
  async replaceInstallments(companyId: string, loanId: string, dto: ReplaceLoanInstallmentsDto) {
    await this.findOne(companyId, loanId);
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
          status: row.status ?? 'Pending',
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
