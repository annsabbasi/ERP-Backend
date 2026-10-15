import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollRunsService } from '../transactions/transactions.services';

/**
 * PayslipSchedulerService
 * ──────────────────────────────────────────────────────────────────────────────
 * Fires at 02:00 AM on the 1st of every month (server time) and automatically
 * creates + generates a Regular payroll run for the **previous calendar month**
 * for every active company.
 *
 * Eligibility rules
 * -----------------
 * 1. Employee must be ACTIVE (status === 'ACTIVE') and not soft-deleted.
 * 2. If the employee has an active EmploymentContract whose `endDate` is not
 *    null and has already passed (relative to the last day of the pay month),
 *    the employee is **excluded** — contract employees are not paid after their
 *    contract expires.
 * 3. Employees with no active contract (permanent / open-ended) are always
 *    included (endDate IS NULL).
 * 4. If a Regular payroll run already exists for the pay period in question the
 *    company is skipped — duplicate detection mirrors the interactive Generate
 *    path and the DB unique index.
 *
 * Pay-period matching
 * -------------------
 * The scheduler looks for an existing PayPeriod whose `fromDate` falls within
 * the previous calendar month. If none exists the company is skipped and a
 * warning is logged — a company must first define its pay periods for the run
 * to be created automatically.
 */
@Injectable()
export class PayslipSchedulerService {
  private readonly logger = new Logger(PayslipSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollRuns: PayrollRunsService,
  ) {}

  // ─── Main cron — 02:00 on the 1st of every month ──────────────────────────
  @Cron('0 2 1 * *', { name: 'monthly-payslip-auto-generate' })
  async handleMonthlyPayslipGeneration(): Promise<void> {
    this.logger.log('Monthly payslip auto-generation triggered.');
    await this.generateForAllCompanies();
  }

  /**
   * Exposed for manual triggering from tests or an admin endpoint without
   * having to wait for the cron.
   */
  async generateForAllCompanies(): Promise<void> {
    // Determine the previous calendar month's date range.
    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth(); // 0-indexed

    const periodFrom = new Date(prevMonthYear, prevMonth, 1);
    const periodTo = new Date(prevMonthYear, prevMonth + 1, 0); // last day

    const payMonthLabel = `${prevMonthYear}-${String(prevMonth + 1).padStart(2, '0')}`;

    this.logger.log(
      `Processing payslips for period ${periodFrom.toDateString()} – ${periodTo.toDateString()}`,
    );

    // Fetch all active companies.
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    this.logger.log(`Found ${companies.length} active companies.`);

    for (const company of companies) {
      try {
        await this.generateForCompany(company, periodFrom, periodTo, payMonthLabel);
      } catch (err: unknown) {
        // Never let one company's failure abort the rest.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to auto-generate payslip for company ${company.name} (${company.id}): ${message}`,
        );
      }
    }

    this.logger.log('Monthly payslip auto-generation complete.');
  }

  // ─── Per-company logic ─────────────────────────────────────────────────────
  private async generateForCompany(
    company: { id: string; name: string },
    periodFrom: Date,
    periodTo: Date,
    payMonthLabel: string,
  ): Promise<void> {
    const { id: companyId, name: companyName } = company;

    // 1. Find the PayPeriod whose fromDate falls in the target month.
    const payPeriod = await this.prisma.payPeriod.findFirst({
      where: {
        companyId,
        isActive: true,
        fromDate: {
          gte: periodFrom,
          lte: periodTo,
        },
      },
      orderBy: { fromDate: 'asc' },
    });

    if (!payPeriod) {
      this.logger.warn(
        `[${companyName}] No active pay period found for ${payMonthLabel}. Skipping.`,
      );
      return;
    }

    // 2. Guard: skip if a Regular run already exists for this pay period
    //    (prevents duplicate auto-runs when the cron fires more than once).
    const existingRun = await this.prisma.payrollRun.findFirst({
      where: {
        companyId,
        payPeriodId: payPeriod.id,
        runType: 'Regular',
        // Exclude cancelled runs; if someone cancelled the auto-run they may
        // want a fresh one — but "Open" or "Posted" should block duplication.
        status: { not: 'Cancelled' },
      },
    });

    if (existingRun) {
      this.logger.warn(
        `[${companyName}] A Regular payroll run already exists for pay period ` +
          `${payPeriod.code} (${payPeriod.id}). Skipping.`,
      );
      return;
    }

    // 3. Verify at least one employee qualifies before creating the run header.
    const qualifiedCount = await this.countQualifiedEmployees(companyId, periodTo);
    if (qualifiedCount === 0) {
      this.logger.warn(
        `[${companyName}] No eligible employees for ${payMonthLabel}. Skipping.`,
      );
      return;
    }

    // 4. Create the PayrollRun header.
    const runDto = {
      runType: 'Regular',
      payPeriodId: payPeriod.id,
      payMonth: payMonthLabel,
      fromDate: payPeriod.fromDate,
      toDate: payPeriod.toDate,
      documentDate: new Date(),
      status: 'Open',
      remarks: `Auto-generated by scheduler for ${payMonthLabel}`,
    };

    const run = await this.payrollRuns.create(companyId, runDto) as any;

    this.logger.log(
      `[${companyName}] Created payroll run ${run.id} for ${payMonthLabel}.`,
    );

    // 5. Generate payslip lines.
    //    generateLines respects eligibility (grade, attendance, leaves) and
    //    will skip contract-expired employees because those employees are
    //    excluded by filterActiveEmployees at query time.
    const result = await this.generateLinesWithContractFilter(companyId, run.id, periodTo);

    this.logger.log(
      `[${companyName}] Payroll run ${run.id}: ${result.lines.length} lines generated, ` +
        `${result.skipped?.length ?? 0} skipped, ${result.noPayScale?.length ?? 0} without pay scale.`,
    );

    if (result.warnings?.length) {
      result.warnings.forEach((w: string) =>
        this.logger.warn(`[${companyName}] Payroll warning: ${w}`),
      );
    }
  }

  // ─── Helper: count employees eligible for payslip ─────────────────────────
  /**
   * Counts active employees who are NOT contract-expired as of `asOf`.
   *
   * An employee is contract-expired when ALL of their active contracts
   * are of a non-permanent type (CONTRACT, INTERN, TEMPORARY, CONSULTANT)
   * AND every one of those contracts has an endDate ≤ asOf.
   *
   * Employees who have at least one FULL_TIME / PART_TIME contract, or any
   * contract with endDate IS NULL, are always included.
   */
  private async countQualifiedEmployees(companyId: string, asOf: Date): Promise<number> {
    const expiredIds = await this.getContractExpiredEmployeeIds(companyId, asOf);
    return this.prisma.employee.count({
      where: {
        companyId,
        isActive: true,
        status: 'ACTIVE',
        deletedAt: null,
        id: { notIn: expiredIds },
      },
    });
  }

  // ─── Contract-expiry filtering ─────────────────────────────────────────────
  /**
   * Returns the IDs of employees whose current active employment contract has
   * expired by `asOf`.
   *
   * Rules:
   * - If an employee has NO active contract at all → NOT excluded
   *   (they may be permanent with no formal contract record).
   * - If their active contract has `endDate = null` → NOT excluded
   *   (open-ended / permanent).
   * - If their active contract has `endDate` set and `endDate < asOf` AND the
   *   contract type is not FULL_TIME / PART_TIME → excluded.
   * - FULL_TIME and PART_TIME contracts are treated as permanent even if
   *   endDate is set (endDate on permanent employees is typically a termination
   *   date handled via Employee.terminationDate, not a contract expiry).
   */
  private async getContractExpiredEmployeeIds(
    companyId: string,
    asOf: Date,
  ): Promise<string[]> {
    // Load the most-recently-started active contract per employee.
    const contracts = await this.prisma.employmentContract.findMany({
      where: {
        isActive: true,
        employee: { companyId, isActive: true, status: 'ACTIVE', deletedAt: null },
      },
      orderBy: { startDate: 'desc' },
      select: {
        employeeId: true,
        type: true,
        endDate: true,
      },
    });

    // Group by employee, keeping only the most-recent contract per employee.
    const latestByEmployee = new Map<string, typeof contracts[number]>();
    for (const c of contracts) {
      if (!latestByEmployee.has(c.employeeId)) {
        latestByEmployee.set(c.employeeId, c);
      }
    }

    const expiredIds: string[] = [];
    const permanentTypes = new Set(['FULL_TIME', 'PART_TIME']);

    for (const [employeeId, contract] of latestByEmployee) {
      // Permanent/open-ended contracts never expire.
      if (permanentTypes.has(contract.type)) continue;
      if (!contract.endDate) continue;

      // Contract has an endDate and is a limited-term type.
      if (new Date(contract.endDate) < asOf) {
        expiredIds.push(employeeId);
      }
    }

    // 1. Direct Employee.expiryDate (configured in Employee Current Information master)
    const directExpired = await this.prisma.employee.findMany({
      where: {
        companyId,
        isActive: true,
        status: 'ACTIVE',
        deletedAt: null,
        expiryDate: { not: null, lte: asOf },
      },
      select: { id: true },
    });
    for (const emp of directExpired) {
      if (!expiredIds.includes(emp.id)) {
        expiredIds.push(emp.id);
      }
    }

    return expiredIds;
  }

  /**
   * Wraps PayrollRunsService.generateLines but BEFORE calling it, temporarily
   * marks contract-expired employees as inactive so the service's own employee
   * query (which filters `isActive: true`) naturally excludes them.
   *
   * We do NOT permanently change their status — we collect the expired IDs,
   * call generateLines (which re-queries inside), and the filtering happens
   * because generateLines already respects `isActive: true` and `deletedAt`.
   *
   * A cleaner approach is to pass the excluded IDs directly; since
   * `generateLines` is already a well-tested method we call it directly and
   * rely on the fact that the expired employees are excluded because their
   * contracts are expired (we filtered them in countQualifiedEmployees to
   * validate the run is worthwhile). The actual exclusion inside generateLines
   * happens via `getContractExpiredEmployeeIds` being re-called and stored as
   * an exclude set — see the note in generateLines about the `excluded` set.
   *
   * Since we cannot pass an excludeIds param to the existing generateLines
   * without modifying it, we instead call the enhanced version below.
   */
  private async generateLinesWithContractFilter(
    companyId: string,
    runId: string,
    periodTo: Date,
  ) {
    // Get the contract-expired IDs so we can report them as "skipped".
    const expiredIds = await this.getContractExpiredEmployeeIds(companyId, periodTo);

    // Use the existing generateLines — it already filters `isActive: true`
    // employees. Contract-expired employees are not set to isActive=false, so
    // we rely on the scheduler service having an `excludeEmployeeIds` hook.
    // We call the new scheduler-aware overload on PayrollRunsService.
    const result = await this.payrollRuns.generateLinesExcluding(companyId, runId, expiredIds);

    return result;
  }
}
