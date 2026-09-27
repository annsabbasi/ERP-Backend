import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * Payroll Phase 2, Increment A, over HTTP against a real Postgres:
 *
 *   - each Monthly Adjustment deduction type is its own JE credit line
 *     (PDF §18–19), Dr expense = total earnings − LOP, and a cancel nets to zero;
 *   - the reversal-date rule (PDF §33): original date while its period is
 *     open, else the first open date after it, else 409;
 *   - employee payment details (QA R-d): own permissions, IBAN validation,
 *     masked answers, a trigger-written masked history, the change stamp;
 *   - banking setup: seeded outgoing methods, tenant checks on house bank
 *     accounts and payment methods.
 *
 * Fixture company as in payroll-process.spec.ts (erp_bootstrap_financials +
 * erp_seed_payroll_demo_data). Disposable databases only.
 */

const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'Phase2a#Test2026';
const VALID_PK_IBAN = 'PK36SCBL0000001123456702';
let app: INestApplication;
let server: any;
let companyId = '';
let otherCompanyId = '';
let superToken = '';
let hrToken = '';
let bankOfficerToken = '';
let bankOfficerId = '';
let periodJan = '';

type Res = { status: number; body: any };
async function call(token: string, method: 'get' | 'post' | 'put' | 'delete', path: string, body?: unknown): Promise<Res> {
  let req = request(server)[method](`/api/v1${path}`).set('authorization', `Bearer ${token}`).set('x-company-id', companyId);
  const res = await (body === undefined ? req.send() : req.send(body as object));
  const payload = res.body && res.body.success === true && 'data' in res.body ? res.body.data : res.body;
  return { status: res.status, body: payload };
}
const su = (m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => call(superToken, m, p, b);
const RUNS = '/hr/transactions/payroll-runs';

async function login(email: string, companySlug?: string) {
  const res = await request(server).post('/api/v1/auth/login').send({ email, password: PASSWORD, ...(companySlug ? { companySlug } : {}) });
  if (res.status >= 300) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body?.data?.accessToken ?? res.body?.accessToken;
}

async function userWith(name: string, keys: string[], slug: string) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const email = `p2a.${name}.${stamp}@example.com`;
  const user = await prisma.user.create({ data: { name, email, passwordHash, companyId, roleType: 'EMPLOYEE', passwordChangedAt: new Date() } });
  const role = await prisma.role.create({ data: { name: `P2A ${name}`, companyId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
  expect(perms).toHaveLength(keys.length);
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const mod = await prisma.systemModule.findUniqueOrThrow({ where: { slug: 'hr-payroll' } });
  await prisma.userModule.create({ data: { userId: user.id, moduleId: mod.id } });
  return { id: user.id, token: await login(email, slug) };
}

const emp = (num: string) => prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: num } });
const mappedCode = async (key: string) =>
  (await prisma.accountDetermination.findFirstOrThrow({ where: { companyId, area: 'PAYROLL', key }, include: { account: true } })).account.code;

async function entryLines(entryId: string) {
  const lines = await prisma.journalLine.findMany({ where: { entryId }, include: { account: { select: { code: true } } } });
  return lines.map((l) => ({ code: l.account.code, debit: Number(l.debit), credit: Number(l.credit), description: l.description }));
}

async function newPostedRun() {
  const created = await su('post', RUNS, { payPeriodId: periodJan, documentDate: '2026-01-31', payMonth: 'January 2026' });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  expect((await su('post', `${RUNS}/${id}/generate`)).status).toBe(201);
  const posted = await su('post', `${RUNS}/${id}/post`);
  expect(posted.status).toBe(201);
  return id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  server = app.getHttpServer();

  const company = await prisma.company.create({
    data: { name: `Phase 2a E2E ${stamp}`, slug: `p2a-e2e-${stamp}`, currency: 'PKR', fiscalYearStart: 1 },
  });
  companyId = company.id;
  await prisma.$queryRawUnsafe(`SELECT erp_bootstrap_financials($1, 2026)`, companyId);
  await prisma.$queryRawUnsafe(`SELECT erp_seed_payroll_demo_data($1, 2026)`, companyId);
  periodJan = (await prisma.payPeriod.findFirstOrThrow({ where: { companyId, code: 'PP-2026-01' } })).id;
  for (const slug of ['hr-payroll', 'financials']) {
    const m = await prisma.systemModule.findUniqueOrThrow({ where: { slug } });
    await prisma.companyModule.create({ data: { companyId, moduleId: m.id } });
  }
  const other = await prisma.company.create({ data: { name: `Phase 2a other ${stamp}`, slug: `p2a-other-${stamp}`, currency: 'PKR' } });
  otherCompanyId = other.id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.user.create({
    data: { name: 'P2A Super', email: `p2a.super.${stamp}@example.com`, passwordHash, isSuperAdmin: true, roleType: 'SUPER_ADMIN', passwordChangedAt: new Date() },
  });
  superToken = await login(`p2a.super.${stamp}@example.com`);
  hrToken = (await userWith('hr', ['hr.payroll.view', 'hr.payroll.update', 'hr.view'], company.slug)).token;
  const officer = await userWith('bank', ['hr.employee_bank.view', 'hr.employee_bank.update', 'hr.view'], company.slug);
  bankOfficerToken = officer.token;
  bankOfficerId = officer.id;
}, 180_000);

afterAll(async () => {
  const off = ['journal_lines DISABLE TRIGGER journal_line_guard', 'journal_lines DISABLE TRIGGER journal_line_balance_guard', 'journal_entries DISABLE TRIGGER journal_entry_guard',
    'payroll_runs DISABLE TRIGGER payroll_runs_lock', 'payroll_run_lines DISABLE TRIGGER payroll_run_lines_lock'];
  try {
    for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t}`);
    for (const id of [companyId, otherCompanyId].filter(Boolean)) {
      await prisma.payrollRun.updateMany({ where: { companyId: id }, data: { journalEntryId: null } });
      await prisma.journalEntry.updateMany({ where: { companyId: id }, data: { reversalOfId: null } });
      await prisma.journalEntry.deleteMany({ where: { companyId: id } });
      await prisma.approvalTemplate.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
  } finally {
    for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t.replace('DISABLE', 'ENABLE')}`);
    await prisma.user.deleteMany({ where: { email: { contains: `.${stamp}@example.com` } } });
    await prisma.$disconnect();
    await app.close();
  }
});

describe('Deductions: one JE credit line per Monthly Adjustment type (PDF §18–19)', () => {
  let runId = '';
  let entryId = '';

  it('Generate copies each deduction type from the adjustment document onto the line', async () => {
    const [e1, e5] = [await emp('DEMO-001'), await emp('DEMO-005')];
    const doc = await su('post', '/hr/transactions/payroll-adjustments', { payPeriodId: periodJan, documentDate: '2026-01-25' });
    expect(doc.status).toBe(201);
    const rows = await su('put', `/hr/transactions/payroll-adjustments/${doc.body.id}/lines`, {
      rows: [
        { employeeId: e1.id, messDeduction: 500, carInsLaptopDed: 200, generalDeduction: 300, deduction13: 50 },
        { employeeId: e5.id, generalDeduction2: 100 },
      ],
    });
    expect(rows.status).toBeLessThan(300);

    const created = await su('post', RUNS, { payPeriodId: periodJan, documentDate: '2026-01-31', payMonth: 'January 2026' });
    runId = created.body.id;
    const gen = await su('post', `${RUNS}/${runId}/generate`);
    const l1 = gen.body.lines.find((l: any) => l.employeeId === e1.id);
    expect(Number(l1.adjustmentDeductions)).toBe(1050);
    expect(l1.adjustmentDeductionSplit).toEqual({ messDeduction: 500, carInsLaptopDed: 200, generalDeduction: 300, deduction13: 50 });
  });

  it('Save Grid: a typed-over "Other Ded." on a line with a split is ignored; a hand-entered one is kept', async () => {
    const lines = (await su('get', `${RUNS}/${runId}/lines`)).body;
    const e1 = await emp('DEMO-001');
    const e6 = await emp('DEMO-006');
    const keys = ['employeeId', 'totalDaysWorking', 'lopDays', 'totalDaysWorked', 'paidDays', 'payLeaves', 'basic', 'entertainment', 'eligibleBasic',
      'conveyance', 'education', 'eligibleConveyance', 'hra', 'bigCity', 'eligibleHra', 'perDayRate', 'paidLeaveDays', 'unpaidLeaveDays',
      'lopDeduction', 'loanDeduction', 'advanceDeduction', 'taxableGross', 'taxDeduction', 'adjustmentAdditions', 'adjustmentDeductions'];
    const rows = lines.map((l: any) => {
      const r: any = {};
      for (const k of keys) if (l[k] !== null && l[k] !== undefined) r[k] = k === 'employeeId' ? l[k] : Number(l[k]);
      if (l.employeeId === e1.id) r.adjustmentDeductions = 9999;
      if (l.employeeId === e6.id) r.adjustmentDeductions = 70;
      return r;
    });
    const saved = await su('put', `${RUNS}/${runId}/lines`, { rows });
    expect(saved.status).toBe(200);
    const s1 = saved.body.find((l: any) => l.employeeId === e1.id);
    const s6 = saved.body.find((l: any) => l.employeeId === e6.id);
    expect(Number(s1.adjustmentDeductions)).toBe(1050);
    expect(s1.adjustmentDeductionSplit).toEqual({ messDeduction: 500, carInsLaptopDed: 200, generalDeduction: 300, deduction13: 50 });
    expect(Number(s1.netPay)).toBeCloseTo(Number(s1.totalEarnings) - Number(s1.totalDeductions), 2);
    expect(Number(s6.adjustmentDeductions)).toBe(70);
    expect(s6.adjustmentDeductionSplit).toBeNull();
  });

  it('Post: Dr expense = total earnings − LOP; one credit per type; hand-entered deductions post as general', async () => {
    const lines = (await su('get', `${RUNS}/${runId}/lines`)).body;
    const posted = await su('post', `${RUNS}/${runId}/post`);
    expect(posted.status).toBe(201);
    entryId = posted.body.journalEntryId;
    const je = await entryLines(entryId);

    const sum = (f: (l: any) => number) => Math.round(lines.reduce((a: number, l: any) => a + f(l), 0) * 100) / 100;
    const expense = sum((l) => Number(l.totalEarnings) - Number(l.lopDeduction ?? 0));
    const debits = je.filter((l) => l.debit > 0);
    expect(debits).toEqual([expect.objectContaining({ code: await mappedCode('salary_expense'), debit: expense })]);

    const byDescription = (prefix: string) => je.find((l) => l.description?.startsWith(prefix));
    expect(byDescription('Mess deduction')).toMatchObject({ code: await mappedCode('mess_deduction'), credit: 500 });
    expect(byDescription('Car insurance / laptop deduction —')).toMatchObject({ code: await mappedCode('car_ins_laptop_deduction'), credit: 200 });
    expect(byDescription('General deduction —')).toMatchObject({ code: await mappedCode('general_deduction'), credit: 370 });
    expect(byDescription('General deduction 2')).toMatchObject({ code: await mappedCode('general_deduction_2'), credit: 100 });
    expect(byDescription('Deduction 13')).toMatchObject({ code: await mappedCode('deduction_13'), credit: 50 });

    const totalCredit = Math.round(je.reduce((a, l) => a + l.credit, 0) * 100) / 100;
    expect(totalCredit).toBe(expense);
    // Dr expense = Cr net + tax + loan + advance + each deduction line.
    const parts = sum((l) => Number(l.netPay) + Number(l.taxDeduction ?? 0) + Number(l.loanDeduction ?? 0) + Number(l.advanceDeduction ?? 0) + Number(l.adjustmentDeductions ?? 0));
    expect(parts).toBe(expense);
  });

  it('Cancel: the reversal mirrors every line, so each account nets to zero', async () => {
    const cancelled = await su('post', `${RUNS}/${runId}/cancel`, { reason: 'p2a' });
    expect(cancelled.status).toBe(201);
    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { reversalOfId: entryId } });
    const orig = await entryLines(entryId);
    const rev = await entryLines(reversal.id);
    const net = new Map<string, number>();
    for (const l of [...orig, ...rev]) net.set(l.code, Math.round(((net.get(l.code) ?? 0) + l.debit - l.credit) * 100) / 100);
    for (const [, v] of net) expect(v).toBe(0);
    expect(rev).toHaveLength(orig.length);
  });
});

describe('Reversal date (PDF §33)', () => {
  const setJan = async (status: 'OPEN' | 'CLOSED') => {
    const jan = await prisma.fiscalPeriod.findFirstOrThrow({ where: { companyId, name: '2026-01' } });
    await prisma.fiscalPeriod.update({ where: { id: jan.id }, data: { status, generalStatus: status } });
    return jan;
  };

  it('original period open: the reversal keeps the original date', async () => {
    const run = await newPostedRun();
    const preview = await su('get', `${RUNS}/${run}/cancel-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ shifted: false, reversalPeriod: '2026-01' });
    expect(new Date(preview.body.reversalDate).toISOString().slice(0, 10)).toBe('2026-01-31');
    expect((await su('post', `${RUNS}/${run}/cancel`, {})).status).toBe(201);
    const r = await su('get', `${RUNS}/${run}`);
    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { companyId, number: r.body.cancellationJeNo } });
    expect(reversal.date.toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  it('original period closed: the preview and the reversal both use the first day of the next open period', async () => {
    const run = await newPostedRun();
    await setJan('CLOSED');
    try {
      const preview = await su('get', `${RUNS}/${run}/cancel-preview`);
      expect(preview.body).toMatchObject({ shifted: true, originalPeriod: '2026-01', reversalPeriod: '2026-02' });
      expect(new Date(preview.body.reversalDate).toISOString().slice(0, 10)).toBe('2026-02-01');
      expect((await su('post', `${RUNS}/${run}/cancel`, {})).status).toBe(201);
      const r = await su('get', `${RUNS}/${run}`);
      const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { companyId, number: r.body.cancellationJeNo }, include: { period: true } });
      expect(reversal.date.toISOString().slice(0, 10)).toBe('2026-02-01');
      expect(reversal.period.name).toBe('2026-02');
    } finally {
      await setJan('OPEN');
    }
  });

  it('original period closed and nothing later open: 409 from preview and cancel, and the run stays Posted', async () => {
    const run = await newPostedRun();
    const jan = await setJan('CLOSED');
    const later = await prisma.fiscalPeriod.findMany({ where: { companyId, startDate: { gt: jan.endDate }, NOT: { subPeriodType: 'YEAR' } } });
    await prisma.fiscalPeriod.updateMany({ where: { id: { in: later.map((p) => p.id) } }, data: { generalStatus: 'CLOSED' } });
    try {
      const preview = await su('get', `${RUNS}/${run}/cancel-preview`);
      expect(preview.status).toBe(409);
      expect(preview.body.message).toMatch(/no later posting period is open/);
      const cancel = await su('post', `${RUNS}/${run}/cancel`, {});
      expect(cancel.status).toBe(409);
      expect((await su('get', `${RUNS}/${run}`)).body.status).toBe('Posted');
    } finally {
      await prisma.fiscalPeriod.updateMany({ where: { id: { in: later.map((p) => p.id) } }, data: { generalStatus: 'OPEN' } });
      await setJan('OPEN');
      expect((await su('post', `${RUNS}/${run}/cancel`, {})).status).toBe(201);
    }
  });
});

describe('Employee payment details (QA R-d)', () => {
  let employeeId = '';
  let bankId = '';
  let ibftId = '';
  let loanMethodId = '';
  const path = () => `/hr/employees/${employeeId}/payment-details`;
  const officer = (m: 'get' | 'put', p: string, b?: unknown) => call(bankOfficerToken, m, p, b);

  beforeAll(async () => {
    employeeId = (await emp('DEMO-002')).id;
    bankId = (await prisma.bank.create({ data: { companyId, code: 'SCB', name: 'Standard Chartered' } })).id;
    ibftId = (await prisma.paymentMethod.findFirstOrThrow({ where: { companyId, code: 'IBFT' } })).id;
    loanMethodId = (await prisma.paymentMethod.findFirstOrThrow({ where: { companyId, code: 'LOAN' } })).id;
  });

  it('a user without hr.employee_bank.* can neither read nor change them', async () => {
    expect((await call(hrToken, 'get', path())).status).toBe(403);
    expect((await call(hrToken, 'put', path(), { paymentMethodId: ibftId })).status).toBe(403);
  });

  it('refuses a mistyped IBAN, a short PK IBAN, IBFT without IBAN, LOAN as a default, and another company\'s bank', async () => {
    const otherBank = await prisma.bank.create({ data: { companyId: otherCompanyId, code: 'OTH', name: 'Other' } });
    const cases: [unknown, RegExp][] = [
      [{ paymentMethodId: ibftId, bankId, iban: 'PK36SCBL0000001123456703' }, /check digits/],
      [{ paymentMethodId: ibftId, bankId, iban: 'PK36SCBL000000112345670' }, /24 characters/],
      [{ paymentMethodId: ibftId, bankId }, /needs the employee's IBAN/],
      [{ paymentMethodId: loanMethodId }, /cannot be an employee's default method/],
      [{ paymentMethodId: ibftId, bankId: otherBank.id, iban: VALID_PK_IBAN }, /bank does not exist in this company/],
    ];
    for (const [body, msg] of cases) {
      const res = await officer('put', path(), body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(msg);
    }
    expect(await prisma.employeePaymentDetail.count({ where: { employeeId } })).toBe(0);
  });

  it('serves its own choice lists (no Financials access needed): outgoing methods without LOAN/ADV, active banks', async () => {
    const res = await officer('get', `${path()}/options`);
    expect(res.status).toBe(200);
    expect(res.body.methods.map((m: any) => m.code)).toEqual(['CASH', 'CHQ', 'IBFT', 'ONLINE']);
    expect(res.body.banks.map((b: any) => b.code)).toContain('SCB');
    expect((await call(hrToken, 'get', `${path()}/options`)).status).toBe(403);
  });

  it('saves, answers masked, reads back in full, and writes a masked history with the actor', async () => {
    const saved = await officer('put', path(), {
      paymentMethodId: ibftId, bankId, accountTitle: 'Demo Two', accountNo: '0012 3456 7890', iban: 'pk36 scbl 0000 0011 2345 6702',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ accountNo: '********7890', iban: '********************6702' });
    expect(saved.body.bankDetailsChangedAt).toBeTruthy();

    const full = await officer('get', path());
    expect(full.body).toMatchObject({ accountNo: '001234567890', iban: VALID_PK_IBAN, paymentMethod: { code: 'IBFT' }, bank: { code: 'SCB' } });

    const hist = (await officer('get', `${path()}/history`)).body;
    const byField = Object.fromEntries(hist.map((h: any) => [h.field, h]));
    expect(Object.keys(byField).sort()).toEqual(['accountNo', 'accountTitle', 'bank', 'iban', 'paymentMethod']);
    expect(byField.accountNo).toMatchObject({ oldValue: null, newValue: '********7890', changedById: bankOfficerId });
    expect(byField.iban.newValue).toBe('********************6702');
    expect(byField.paymentMethod.newValue).toBe('IBFT');
    // Nothing in the history holds a full number.
    expect(JSON.stringify(hist)).not.toContain('001234567890');
    expect(JSON.stringify(hist)).not.toContain(VALID_PK_IBAN);
  });

  it('saving the same values again changes nothing: no history row, same change stamp', async () => {
    const before = await prisma.employeePaymentDetail.findUniqueOrThrow({ where: { employeeId } });
    const n = await prisma.employeePaymentDetailChange.count({ where: { employeeId } });
    const again = await officer('put', path(), { paymentMethodId: ibftId, bankId, accountTitle: 'Demo Two', accountNo: '001234567890', iban: VALID_PK_IBAN });
    expect(again.status).toBe(200);
    expect(await prisma.employeePaymentDetailChange.count({ where: { employeeId } })).toBe(n);
    const after = await prisma.employeePaymentDetail.findUniqueOrThrow({ where: { employeeId } });
    expect(after.bankDetailsChangedAt?.getTime()).toBe(before.bankDetailsChangedAt?.getTime());
  });

  it('a new account number ending in the same four digits is still a change (compared on the value, not the mask)', async () => {
    const before = await prisma.employeePaymentDetail.findUniqueOrThrow({ where: { employeeId } });
    const n = await prisma.employeePaymentDetailChange.count({ where: { employeeId } });
    const res = await officer('put', path(), { paymentMethodId: ibftId, bankId, accountTitle: 'Demo Two', accountNo: '009934567890', iban: VALID_PK_IBAN });
    expect(res.status).toBe(200);
    const rows = await prisma.employeePaymentDetailChange.findMany({ where: { employeeId }, orderBy: { changedAt: 'desc' } });
    expect(rows).toHaveLength(n + 1);
    expect(rows[0]).toMatchObject({ field: 'accountNo', oldValue: '********7890', newValue: '********7890' });
    const after = await prisma.employeePaymentDetail.findUniqueOrThrow({ where: { employeeId } });
    expect(after.bankDetailsChangedAt!.getTime()).toBeGreaterThan(before.bankDetailsChangedAt!.getTime());
  });

  it('a changed IBAN is recorded with masked old and new values', async () => {
    const res = await officer('put', path(), { paymentMethodId: ibftId, bankId, accountTitle: 'Demo Two', accountNo: '009934567890', iban: 'GB82WEST12345698765432' });
    expect(res.status).toBe(200);
    const last = await prisma.employeePaymentDetailChange.findFirstOrThrow({ where: { employeeId }, orderBy: { changedAt: 'desc' } });
    expect(last).toMatchObject({ field: 'iban', oldValue: '********************6702', newValue: '******************5432' });
  });

  it('the history cannot be edited or deleted, even directly in the database', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE employee_payment_detail_changes SET "newValue" = 'x' WHERE "employeeId" = $1`, employeeId))
      .rejects.toThrow(/ERP_RULE: payment-detail history cannot be changed or deleted/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM employee_payment_detail_changes WHERE "employeeId" = $1`, employeeId))
      .rejects.toThrow(/ERP_RULE/);
  });

  it('the table refuses another company\'s bank even when the API is bypassed', async () => {
    const otherBank = await prisma.bank.findFirstOrThrow({ where: { companyId: otherCompanyId } });
    await expect(prisma.$executeRawUnsafe(`UPDATE employee_payment_details SET "bankId" = $1 WHERE "employeeId" = $2`, otherBank.id, employeeId))
      .rejects.toThrow(/ERP_RULE: the bank does not belong to this company/);
  });
});

describe('Banking setup', () => {
  it('every company has the six outgoing payment methods, and re-applying them adds nothing', async () => {
    const methods = await prisma.paymentMethod.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    expect(methods.map((m) => `${m.code}:${m.direction}:${m.paymentMeans}`)).toEqual([
      'ADV:OUTGOING:advance', 'CASH:OUTGOING:cash', 'CHQ:OUTGOING:check', 'IBFT:OUTGOING:ibft', 'LOAN:OUTGOING:loan', 'ONLINE:OUTGOING:online',
    ]);
    const again = await prisma.$queryRawUnsafe<{ erp_apply_payment_methods: string }[]>(`SELECT erp_apply_payment_methods($1)`, companyId);
    expect(again).toHaveLength(0);
  });

  it('a house bank account needs this company\'s bank and a postable asset G/L account', async () => {
    const bank = await prisma.bank.create({ data: { companyId, code: 'HBL', name: 'Habib Bank' } });
    const otherBank = await prisma.bank.findFirstOrThrow({ where: { companyId: otherCompanyId } });
    const asset = await prisma.account.findFirstOrThrow({ where: { companyId, type: 'ASSET', isTitle: false, isActive: true } });
    const expense = await prisma.account.findFirstOrThrow({ where: { companyId, type: 'EXPENSE', isTitle: false } });
    const base = { bankId: bank.id, accountNo: `HB-${stamp}`, currency: 'PKR' };
    const cases: [unknown, RegExp][] = [
      [base, /needs its G\/L account/],
      [{ ...base, glAccountId: expense.id }, /postable \(non-title\) asset account/],
      [{ ...base, bankId: otherBank.id, glAccountId: asset.id }, /bank does not exist in this company/],
      [{ ...base, glAccountId: asset.id, currency: 'XYZ' }, /not in this company's currency master/],
    ];
    for (const [body, msg] of cases) {
      const res = await su('post', '/financials/house-bank-accounts', body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(msg);
    }
    const ok = await su('post', '/financials/house-bank-accounts', { ...base, glAccountId: asset.id });
    expect(ok.status).toBe(201);
  });

  it('a payment method cannot point at another company\'s house bank account', async () => {
    const otherBank = await prisma.bank.findFirstOrThrow({ where: { companyId: otherCompanyId } });
    const theirs = await prisma.houseBankAccount.create({ data: { companyId: otherCompanyId, bankId: otherBank.id, accountNo: 'THEIRS', currency: 'PKR' } });
    const res = await su('post', '/financials/payment-methods', { code: 'X1', description: 'x', direction: 'OUTGOING', paymentMeans: 'online', houseBankAccountId: theirs.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/house bank account does not exist in this company/);
  });
});
