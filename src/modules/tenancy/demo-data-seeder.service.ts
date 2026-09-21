import { Injectable, Logger } from '@nestjs/common';
import {
  AccountSubtype,
  AccountType,
  AlertFrequency,
  AlertPriority,
  Prisma,
  SubPeriodType,
  UserRoleType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Best-effort convenience data for a freshly onboarded company.
 *
 * Every Administration screen has at least one dropdown backed by a
 * company-scoped table (users, departments, currencies, accounts, posting
 * periods, numbering series, territories, approval stages/templates, a
 * license, an alert). A template-applied company otherwise starts every one
 * of those tables empty, which is correct for a real tenant but leaves every
 * dropdown in Administration empty until someone fills each catalog in by
 * hand — exactly the friction that made the module hard to test.
 *
 * This runs once, right after onboarding, and never through the onboarding
 * transaction itself: it is convenience data, not core business data, so a
 * failure here must never roll back or fail the company that was just
 * created. Each group is seeded independently and swallows its own errors.
 *
 * All writes go through Prisma directly rather than the feature modules'
 * services (AccountsService, NumberingService, etc.) to avoid wiring this
 * module into half the app's module graph for a one-shot convenience step;
 * the shapes below mirror exactly what those services write.
 */
@Injectable()
export class DemoDataSeederService {
  private readonly logger = new Logger(DemoDataSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The steps below split into independent chains — a user-scoped chain, an
   * accounts chain, and four standalone groups — that touch entirely disjoint
   * tables/rows. Running them concurrently (rather than one long sequential
   * chain) is what keeps this step from dominating the onboarding request's
   * wall-clock time: sequentially, ~25 round trips at the cross-region
   * pooler's few-hundred-ms-each latency added 25-35s on top of the core
   * transaction, which is long enough to outrun a client's request timeout —
   * exactly what let a company get created successfully on the server while
   * the caller saw a failure and retried, hitting "slug already taken" on a
   * name that had, in fact, already been created.
   */
  async seed(companyId: string, adminUserId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { slug: true, fiscalYearStart: true },
    });
    if (!company) return;

    const roles = await this.prisma.role.findMany({ where: { companyId } });
    const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

    await Promise.all([
      this.seedUserChain(companyId, adminUserId, company.slug, roleIdByName),
      this.seedAccountsChain(companyId),
      this.step('posting periods', () =>
        this.seedPostingPeriods(companyId, company.fiscalYearStart ?? 1),
      ),
      this.step('numbering series', () => this.seedNumberingSeries(companyId)),
      this.step('territories', () => this.seedTerritories(companyId)),
      this.step('license', () => this.seedLicense(companyId, adminUserId)),
      this.step('alert definition', () => this.seedAlert(companyId, adminUserId)),
    ]);
  }

  private async seedUserChain(
    companyId: string,
    adminUserId: string,
    slug: string,
    roleIdByName: Map<string, string>,
  ) {
    const depts = await this.step('departments', () => this.seedDepartments(companyId));
    const userIds = await this.step('users', () =>
      this.seedUsers(companyId, slug, depts ?? {}, roleIdByName),
    );
    const managerUserId = userIds?.managerUserId;
    const employeeUserId = userIds?.employeeUserId;

    const stages = await this.step('approval stages', () =>
      this.seedApprovalStages(companyId, adminUserId, managerUserId),
    );
    const template = stages
      ? await this.step('approval template', () =>
          this.seedApprovalTemplate(companyId, stages, employeeUserId),
        )
      : null;
    if (managerUserId) {
      await this.step('substitute authorizer', () =>
        this.seedSubstituteAuthorizer(companyId, adminUserId, managerUserId, template?.id),
      );
    }
  }

  private async seedAccountsChain(companyId: string) {
    await this.step('currencies', () => this.seedCurrencies(companyId));
    const accounts = await this.step('accounts', () => this.seedAccounts(companyId));
    if (accounts) {
      await this.step('default control accounts', () =>
        this.seedControlAccounts(companyId, accounts),
      );
    }
  }

  /** Runs one seeding group; logs and swallows its failure rather than propagating it. */
  private async step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`Demo data step "${label}" failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async seedDepartments(companyId: string) {
    const specs = [
      { name: 'Finance', description: 'Accounting and treasury' },
      { name: 'Sales', description: 'Sales and business development' },
      { name: 'Operations', description: 'Day-to-day operations' },
    ];
    await this.prisma.department.createMany({
      data: specs.map((s) => ({ companyId, ...s })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.department.findMany({
      where: { companyId, name: { in: specs.map((s) => s.name) } },
      select: { id: true, name: true },
    });
    const ids: Record<string, string> = Object.fromEntries(rows.map((r) => [r.name, r.id]));
    return ids;
  }

  private async seedUsers(
    companyId: string,
    slug: string,
    depts: Record<string, string>,
    roleIdByName: Map<string, string>,
  ) {
    const passwordHash = await bcrypt.hash('Passw0rd!23', 12);
    const manager = await this.prisma.user.create({
      data: {
        name: 'Demo Manager',
        email: `demo.manager+${slug}@example.com`,
        passwordHash,
        companyId,
        roleType: UserRoleType.DEPARTMENT_HEAD,
        departmentId: depts.Finance,
        passwordChangedAt: new Date(),
      },
    });
    const employee = await this.prisma.user.create({
      data: {
        name: 'Demo Employee',
        email: `demo.employee+${slug}@example.com`,
        passwordHash,
        companyId,
        roleType: UserRoleType.EMPLOYEE,
        departmentId: depts.Sales,
        passwordChangedAt: new Date(),
      },
    });

    const links: { userId: string; roleId: string }[] = [];
    const managerRoleId = roleIdByName.get('Manager');
    const employeeRoleId = roleIdByName.get('Employee');
    if (managerRoleId) links.push({ userId: manager.id, roleId: managerRoleId });
    if (employeeRoleId) links.push({ userId: employee.id, roleId: employeeRoleId });
    if (links.length) {
      await this.prisma.userRole.createMany({ data: links, skipDuplicates: true });
    }

    return { managerUserId: manager.id, employeeUserId: employee.id };
  }

  private async seedCurrencies(companyId: string) {
    const specs = [
      { code: 'USD', name: 'US Dollar', decimals: 2 },
      { code: 'EUR', name: 'Euro', decimals: 2 },
      { code: 'GBP', name: 'British Pound', decimals: 2 },
      { code: 'PKR', name: 'Pakistani Rupee', hundredthName: 'Paisa', decimals: 2 },
    ];
    await this.prisma.currency.createMany({
      data: specs.map((s) => ({ companyId, ...s })),
      skipDuplicates: true,
    });
  }

  /**
   * A minimal chart of accounts. `Account.currency` defaults to "USD" and is
   * a foreign key onto `Currency(companyId, code)` — this must run after
   * `seedCurrencies`, or every insert here fails its FK check.
   */
  private async seedAccounts(companyId: string) {
    const titles: { code: string; name: string; type: AccountType }[] = [
      { code: '1000', name: 'Assets', type: AccountType.ASSET },
      { code: '2000', name: 'Liabilities', type: AccountType.LIABILITY },
      { code: '3000', name: 'Equity', type: AccountType.EQUITY },
      { code: '4000', name: 'Income', type: AccountType.INCOME },
      { code: '5000', name: 'Expenses', type: AccountType.EXPENSE },
    ];
    // Batched into createMany + a lookup rather than 15 sequential creates:
    // each individual round trip to the cross-region Supabase pooler runs
    // several hundred milliseconds, and this step used to be the largest
    // single contributor to onboarding latency.
    await this.prisma.account.createMany({
      data: titles.map((t) => ({ companyId, code: t.code, name: t.name, type: t.type, isTitle: true })),
      skipDuplicates: true,
    });
    const titleRows = await this.prisma.account.findMany({
      where: { companyId, code: { in: titles.map((t) => t.code) } },
      select: { id: true, code: true },
    });
    const ids: Record<string, string> = Object.fromEntries(titleRows.map((r) => [r.code, r.id]));

    const leaves: {
      code: string; name: string; type: AccountType; subtype: AccountSubtype;
      isControl?: boolean; parent: string;
    }[] = [
      { code: '1010', name: 'Cash on Hand', type: AccountType.ASSET, subtype: AccountSubtype.CASH, parent: '1000' },
      { code: '1020', name: 'Bank Account', type: AccountType.ASSET, subtype: AccountSubtype.BANK, parent: '1000' },
      { code: '1200', name: 'Accounts Receivable', type: AccountType.ASSET, subtype: AccountSubtype.ACCOUNTS_RECEIVABLE, isControl: true, parent: '1000' },
      { code: '2100', name: 'Accounts Payable', type: AccountType.LIABILITY, subtype: AccountSubtype.ACCOUNTS_PAYABLE, isControl: true, parent: '2000' },
      { code: '2200', name: 'Tax Payable', type: AccountType.LIABILITY, subtype: AccountSubtype.TAX_PAYABLE, parent: '2000' },
      { code: '3100', name: 'Share Capital', type: AccountType.EQUITY, subtype: AccountSubtype.SHARE_CAPITAL, parent: '3000' },
      { code: '3900', name: 'Retained Earnings', type: AccountType.EQUITY, subtype: AccountSubtype.RETAINED_EARNINGS, parent: '3000' },
      { code: '4100', name: 'Sales Revenue', type: AccountType.INCOME, subtype: AccountSubtype.REVENUE, parent: '4000' },
      { code: '5100', name: 'Cost of Goods Sold', type: AccountType.EXPENSE, subtype: AccountSubtype.COST_OF_GOODS_SOLD, parent: '5000' },
      { code: '5200', name: 'Operating Expenses', type: AccountType.EXPENSE, subtype: AccountSubtype.OPERATING_EXPENSE, parent: '5000' },
    ];
    await this.prisma.account.createMany({
      data: leaves.map((l) => ({
        companyId,
        code: l.code,
        name: l.name,
        type: l.type,
        subtype: l.subtype,
        isControl: l.isControl ?? false,
        parentId: ids[l.parent],
      })),
      skipDuplicates: true,
    });
    const leafRows = await this.prisma.account.findMany({
      where: { companyId, code: { in: leaves.map((l) => l.code) } },
      select: { id: true, code: true },
    });
    for (const r of leafRows) ids[r.code] = r.id;
    return ids;
  }

  private async seedControlAccounts(companyId: string, acct: Record<string, string>) {
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        defaultArAccountId: acct['1200'],
        defaultApAccountId: acct['2100'],
        defaultCashAccountId: acct['1010'],
        defaultTaxPayableAccountId: acct['2200'],
        defaultRevenueAccountId: acct['4100'],
        defaultExpenseAccountId: acct['5200'],
      },
    });
  }

  /** Mirrors FiscalPeriodsService.generate: one parent year + 12 monthly children, batched. */
  private async seedPostingPeriods(companyId: string, fiscalYearStart: number) {
    const fiscalYear = new Date().getUTCFullYear();
    const startMonth = fiscalYearStart - 1;
    const yearStart = new Date(Date.UTC(fiscalYear, startMonth, 1));
    const yearEnd = new Date(Date.UTC(fiscalYear + 1, startMonth, 1));
    yearEnd.setUTCDate(yearEnd.getUTCDate() - 1);

    const existing = await this.prisma.fiscalPeriod.findFirst({
      where: { companyId, name: String(fiscalYear) },
    });
    if (existing) return;

    const spans = Array.from({ length: 12 }, (_, i) => {
      const start = new Date(Date.UTC(fiscalYear, startMonth + i, 1));
      const end = new Date(Date.UTC(fiscalYear, startMonth + i + 1, 1));
      end.setUTCDate(end.getUTCDate() - 1);
      const seq = String(i + 1).padStart(2, '0');
      return {
        name: `${fiscalYear}-${seq}`,
        label: start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ` ${start.getUTCFullYear()}`,
        start,
        end,
      };
    });

    await this.prisma.$transaction(
      async (tx) => {
        const parent = await tx.fiscalPeriod.create({
          data: {
            companyId,
            name: String(fiscalYear),
            displayName: `Fiscal Year ${fiscalYear}`,
            fiscalYear,
            subPeriodType: SubPeriodType.YEAR,
            startDate: yearStart,
            endDate: yearEnd,
            activeFrom: yearStart,
            activeTo: yearEnd,
          },
        });
        await tx.fiscalPeriod.createMany({
          data: spans.map((s) => ({
            companyId,
            parentId: parent.id,
            name: s.name,
            displayName: s.label,
            fiscalYear,
            subPeriodType: SubPeriodType.MONTHS,
            startDate: s.start,
            endDate: s.end,
            activeFrom: s.start,
            activeTo: s.end,
            dueDateFrom: s.start,
            dueDateTo: s.end,
          })),
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  private async seedNumberingSeries(companyId: string) {
    const specs = [
      { documentType: 'journal_entry', prefix: 'JE-' },
      { documentType: 'ar_invoice', prefix: 'INV-' },
      { documentType: 'ap_bill', prefix: 'BILL-' },
      { documentType: 'sales_order', prefix: 'SO-' },
      { documentType: 'purchase_order', prefix: 'PO-' },
      { documentType: 'delivery', prefix: 'DL-' },
      { documentType: 'incoming_payment', prefix: 'RCPT-' },
      { documentType: 'outgoing_payment', prefix: 'PAY-' },
    ];
    await this.prisma.numberingSeries.createMany({
      data: specs.map((s) => ({
        companyId,
        documentType: s.documentType,
        name: 'Primary',
        prefix: s.prefix,
        firstNumber: 1,
        nextNumber: 1,
        digits: 5,
        isDefault: true,
      })),
      skipDuplicates: true,
    });
  }

  private async seedTerritories(companyId: string) {
    const north = await this.prisma.territory.create({ data: { companyId, name: 'North Zone' } });
    await this.prisma.territory.createMany({
      data: [
        { companyId, name: 'South Zone' },
        { companyId, name: 'Karachi', parentId: north.id },
      ],
    });
  }

  private async seedApprovalStages(companyId: string, adminUserId: string, managerUserId?: string) {
    const stage1 = await this.prisma.approvalStage.create({
      data: {
        companyId,
        name: 'Manager Review',
        description: 'First-line review by the department manager',
        requiredApprovals: 1,
        approvers: {
          create: (managerUserId ? [managerUserId] : [adminUserId]).map((userId) => ({ userId })),
        },
      },
    });
    const stage2 = await this.prisma.approvalStage.create({
      data: {
        companyId,
        name: 'Finance Approval',
        description: 'Final sign-off by finance',
        requiredApprovals: 1,
        approvers: { create: [{ userId: adminUserId }] },
      },
    });
    return [stage1, stage2];
  }

  private async seedApprovalTemplate(
    companyId: string,
    stages: { id: string }[],
    employeeUserId?: string,
  ) {
    return this.prisma.approvalTemplate.create({
      data: {
        companyId,
        name: 'High-Value Purchase Orders',
        description: 'Routes purchase orders and AP bills through manager then finance',
        documentTypes: ['purchase_order', 'ap_bill'],
        terms: { always: true } as Prisma.InputJsonValue,
        originators: employeeUserId ? { create: [{ userId: employeeUserId }] } : undefined,
        stages: {
          create: stages.map((s, i) => ({ stageId: s.id, ordering: i })),
        },
      },
    });
  }

  private async seedSubstituteAuthorizer(
    companyId: string,
    adminUserId: string,
    managerUserId: string,
    templateId?: string,
  ) {
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + 90 * 86_400_000);
    await this.prisma.substituteAuthorizer.create({
      data: {
        companyId,
        templateId,
        originalUserId: adminUserId,
        substituteUserId: managerUserId,
        validFrom,
        validTo,
        isActive: true,
      },
    });
  }

  private async seedLicense(companyId: string, adminUserId: string) {
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + 365 * 86_400_000);
    const license = await this.prisma.companyLicense.create({
      data: {
        companyId,
        licenseKey: `DEMO-${companyId.slice(0, 8).toUpperCase()}`,
        licenseServer: '192.168.1.50',
        port: 40000,
        validFrom,
        validTo,
        importedFileName: 'demo-license.txt',
        components: {
          create: [
            { code: 'PROFESSIONAL', name: 'Professional User', totalCount: 10 },
            { code: 'LIMITED', name: 'Limited User', totalCount: 20 },
          ],
        },
      },
      include: { components: true },
    });
    const seat = license.components[0];
    if (seat) {
      await this.prisma.licenseAssignment.create({
        data: { companyId, licenseId: license.id, componentId: seat.id, userId: adminUserId },
      });
    }
  }

  private async seedAlert(companyId: string, adminUserId: string) {
    await this.prisma.alertDefinition.create({
      data: {
        companyId,
        name: 'Low Stock Alert',
        description: 'Warns when inventory falls below reorder point',
        priority: AlertPriority.NORMAL,
        frequency: AlertFrequency.DAILY,
        eventKey: 'inventory.low_stock',
        subscriptions: { create: [{ userId: adminUserId }] },
      },
    });
  }
}
