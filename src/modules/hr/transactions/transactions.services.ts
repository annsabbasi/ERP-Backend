import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
    const totalDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs) + 1);

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        ...(sheet.branchId ? { branchId: sheet.branchId } : {}),
      },
      select: { id: true, employeeNumber: true },
      orderBy: { employeeNumber: 'asc' },
    });

    const presentCounts = await this.prisma.attendanceEntry.groupBy({
      by: ['employeeId'],
      where: { companyId, date: { gte: from, lte: to }, status: { not: 'MISSED' } },
      _count: { _all: true },
    });
    const presentByEmployee = new Map(presentCounts.map((p) => [p.employeeId, p._count._all]));

    const rows = employees.map((emp, i) => {
      const present = presentByEmployee.get(emp.id) ?? 0;
      const lop = Math.max(totalDays - present, 0);
      return {
        sheetId,
        employeeId: emp.id,
        idNo: emp.employeeNumber ?? null,
        totalDays: totalDays as any,
        workingDays: totalDays as any,
        presentDays: present as any,
        lopDays: lop as any,
        payableLeaves: 0 as any,
        otHours: 0 as any,
        shortTimeHours: 0 as any,
        normalOtHours: 0 as any,
        sunday: 0 as any,
        misBioMaterDays: 0 as any,
        compOffDays: 0 as any,
        annualLeave: 0 as any,
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

  async replaceLines(companyId: string, runId: string, dto: ReplacePayrollRunLinesDto) {
    await this.findOne(companyId, runId);
    await this.prisma.$transaction([
      this.prisma.payrollRunLine.deleteMany({ where: { payrollRunId: runId } }),
      this.prisma.payrollRunLine.createMany({
        data: dto.rows.map((row, i) => ({
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
          ordering: i,
        })),
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

    const employees = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      include: { grade: { include: { payScale: { orderBy: { stage: 'asc' }, take: 1 } } } },
      orderBy: { employeeNumber: 'asc' },
    });

    const attendanceByEmployee = new Map<string, any>();
    if (run.payPeriodId) {
      const sheet = await this.prisma.monthlyAttendanceSheet.findFirst({
        where: { companyId, payPeriodId: run.payPeriodId },
        orderBy: { updatedAt: 'desc' },
        include: { lines: true },
      });
      if (sheet) for (const l of sheet.lines) attendanceByEmployee.set(l.employeeId, l);
    }
    const payPeriod = run.payPeriodId
      ? await this.prisma.payPeriod.findFirst({ where: { id: run.payPeriodId, companyId } })
      : null;

    const rows = employees.map((emp, i) => {
      const stage = emp.grade?.payScale?.[0];
      const att = attendanceByEmployee.get(emp.id);
      const totalDaysWorking = att?.workingDays ?? payPeriod?.workingDays ?? null;
      const lopDays = att?.lopDays ?? 0;
      const totalDaysWorked = att?.presentDays ?? null;
      const payLeaves = att?.payableLeaves ?? 0;
      const paidDays = totalDaysWorked != null ? Number(totalDaysWorked) + Number(payLeaves) : null;
      return {
        payrollRunId: runId,
        employeeId: emp.id,
        employeeType: run.employeeType ?? null,
        totalDaysWorking: totalDaysWorking as any,
        lopDays: lopDays as any,
        totalDaysWorked: totalDaysWorked as any,
        paidDays: paidDays as any,
        payLeaves: payLeaves as any,
        basic: (stage?.basicPay ?? null) as any,
        entertainment: 0 as any,
        eligibleBasic: (stage?.basicPay ?? null) as any,
        conveyance: (stage?.conveyanceAllowance ?? null) as any,
        education: 0 as any,
        eligibleConveyance: (stage?.conveyanceAllowance ?? null) as any,
        hra: (stage?.hra ?? null) as any,
        bigCity: 0 as any,
        eligibleHra: (stage?.hra ?? null) as any,
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
