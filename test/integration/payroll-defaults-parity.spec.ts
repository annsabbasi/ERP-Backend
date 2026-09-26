import { PrismaClient } from '@prisma/client';
import { DemoDataSeederService } from '../../src/modules/tenancy/demo-data-seeder.service';

/**
 * R4 / R10 parity: a company onboarded through the real seeder and a bare
 * company given the backfill SQL must end up with identical Financials and
 * payroll masters.
 *
 *   A — created, then DemoDataSeederService.seed() (the onboarding path, which
 *       ends by calling erp_apply_payroll_defaults).
 *   B — created bare, then erp_bootstrap_financials() (the SQL the migrations
 *       use for companies that never got a Financials foundation).
 *
 * If either side drifts — an account added to the seeder but not the SQL, a
 * different parent, subtype, currency or mapping — this fails and names it.
 * Runs against a disposable database only (see harness.ts).
 */
const prisma = new PrismaClient();
const stamp = Date.now();
let aId = '';
let bId = '';

async function makeCompany(tag: string) {
  const c = await prisma.company.create({
    data: { name: `Parity ${tag} ${stamp}`, slug: `parity-${tag.toLowerCase()}-${stamp}`, currency: 'PKR', fiscalYearStart: 1 },
  });
  return c.id;
}

/** Everything that must match, keyed by stable business values (codes), never ids. */
async function snapshot(companyId: string) {
  const accounts = await prisma.account.findMany({
    where: { companyId },
    select: { code: true, name: true, type: true, subtype: true, isTitle: true, isControl: true, level: true, currency: true, parentId: true },
    orderBy: { code: 'asc' },
  });
  const codeById = new Map(
    (await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.id, a.code]),
  );
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  return {
    currencies: (await prisma.currency.findMany({ where: { companyId }, select: { code: true }, orderBy: { code: 'asc' } })).map((c) => c.code),
    accounts: accounts.map(({ parentId, ...a }) => ({ ...a, parent: parentId ? codeById.get(parentId) : null })),
    determinations: (
      await prisma.accountDetermination.findMany({ where: { companyId }, select: { area: true, key: true, accountId: true } })
    )
      .map((d) => `${d.area}/${d.key} → ${codeById.get(d.accountId)}`)
      .sort(),
    controlAccounts: {
      ar: codeById.get(company.defaultArAccountId ?? ''),
      ap: codeById.get(company.defaultApAccountId ?? ''),
      cash: codeById.get(company.defaultCashAccountId ?? ''),
      taxPayable: codeById.get(company.defaultTaxPayableAccountId ?? ''),
      revenue: codeById.get(company.defaultRevenueAccountId ?? ''),
      expense: codeById.get(company.defaultExpenseAccountId ?? ''),
    },
    fiscalPeriods: (
      await prisma.fiscalPeriod.findMany({ where: { companyId }, orderBy: { name: 'asc' } })
    ).map((p) => `${p.name} ${p.subPeriodType} ${p.status} ${p.startDate.toISOString().slice(0, 10)}..${p.endDate.toISOString().slice(0, 10)} ${p.displayName}`),
    numbering: (
      await prisma.numberingSeries.findMany({ where: { companyId }, orderBy: { documentType: 'asc' } })
    ).map((n) => `${n.documentType} ${n.prefix} ${n.digits} ${n.isDefault}`),
    payPeriods: (
      await prisma.payPeriod.findMany({ where: { companyId }, orderBy: { code: 'asc' } })
    ).map((p) => `${p.code} ${p.name} ${p.workingDays} ${p.fromDate.toISOString().slice(0, 10)}..${p.toDate.toISOString().slice(0, 10)}`),
    leaveTypes: (await prisma.leaveType.findMany({ where: { companyId }, orderBy: { code: 'asc' } })).map((t) => `${t.code} paid=${t.paid}`),
    loanTypes: (await prisma.loanType.findMany({ where: { companyId }, orderBy: { code: 'asc' } })).map(
      (t) => `${t.code} ${t.loanType} rate=${Number(t.rateOfInterest)} max=${t.maxInstallments} pct=${t.maxNetPayPercent ?? '-'}`,
    ),
    categories: (await prisma.employeeCategory.findMany({ where: { companyId }, orderBy: { code: 'asc' } })).map((c) => c.code),
    branches: (await prisma.branch.findMany({ where: { companyId } })).map((b) => b.name),
  };
}

beforeAll(async () => {
  aId = await makeCompany('A');
  bId = await makeCompany('B');
  const admin = await prisma.user.create({
    data: { name: 'Parity Admin', email: `parity.admin.${stamp}@example.com`, passwordHash: 'x', companyId: aId },
  });
  await new DemoDataSeederService(prisma as any).seed(aId, admin.id);
  await prisma.$queryRawUnsafe(`SELECT erp_bootstrap_financials($1)`, bId);
});

afterAll(async () => {
  // approval_template_stages → approval_stages is RESTRICT, so a seeded
  // company cannot be deleted in one statement (pre-existing; not payroll's).
  await prisma.approvalTemplate.deleteMany({ where: { companyId: { in: [aId, bId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [aId, bId] } } });
  await prisma.$disconnect();
});

describe('payroll defaults — onboarding seeder vs backfill SQL', () => {
  let a: Awaited<ReturnType<typeof snapshot>>;
  let b: Awaited<ReturnType<typeof snapshot>>;
  beforeAll(async () => {
    a = await snapshot(aId);
    b = await snapshot(bId);
  });

  it.each([
    'currencies', 'accounts', 'determinations', 'controlAccounts', 'fiscalPeriods',
    'numbering', 'payPeriods', 'leaveTypes', 'loanTypes', 'branches',
  ] as const)('%s match', (key) => {
    expect(b[key]).toEqual(a[key]);
  });

  it('the result can actually post payroll: every PAYROLL key is mapped to a postable account', () => {
    for (const key of ['salary_expense', 'salaries_payable', 'tax_payable', 'loan_receivable', 'advance_receivable']) {
      expect(a.determinations.some((d) => d.startsWith(`PAYROLL/${key} → `))).toBe(true);
    }
    const payrollCodes = a.determinations.filter((d) => d.startsWith('PAYROLL/')).map((d) => d.split(' → ')[1]);
    for (const code of payrollCodes) {
      expect(a.accounts.find((x) => x.code === code)?.isTitle).toBe(false);
    }
  });

  it('withholding tax is not the sales-tax account', () => {
    const tax = a.determinations.find((d) => d.startsWith('PAYROLL/tax_payable'))!.split(' → ')[1];
    expect(tax).not.toBe(a.controlAccounts.taxPayable);
  });

  it('accounts are in the company currency (PKR), not the USD column default', () => {
    expect(new Set(a.accounts.map((x) => x.currency))).toEqual(new Set(['PKR']));
  });

  it('seeds one unpaid leave type and a 0% single-installment Advance type', () => {
    expect(a.leaveTypes).toContain('UNPAID paid=false');
    expect(a.loanTypes).toContain('ADV Advance rate=0 max=1 pct=50');
  });
});
