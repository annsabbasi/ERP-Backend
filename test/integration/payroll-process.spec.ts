import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * Payroll Process end to end, over HTTP, against a real Postgres (QA §37 / F):
 *
 *   Add → Generate (non-zero pay, tax, loan, advance, LOP) → Save Grid → Post
 *   (balanced JE in the company currency, installments Paid) → Cancel
 *   (reversal JE, installments restored) — plus the negative cases: locks,
 *   DTO-forbidden fields, duplicate employee, closed period without logout,
 *   missing mapping, HR user without posting rights, and two concurrent posts
 *   racing for the same installment.
 *
 * The fixture company is built the way the migrations build a real one:
 * erp_bootstrap_financials (Financials foundation + payroll defaults) and
 * erp_seed_payroll_demo_data. Disposable databases only (harness.ts).
 */

const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'Payroll#Test2026';
let app: INestApplication;
let server: any;
let companyId = '';
let superToken = '';
let hrToken = '';
let periodJan = '';

type Res = { status: number; body: any };
async function call(token: string, method: 'get' | 'post' | 'put' | 'delete', path: string, body?: unknown, company = true): Promise<Res> {
  let req = request(server)[method](`/api/v1${path}`).set('authorization', `Bearer ${token}`);
  if (company) req = req.set('x-company-id', companyId);
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

async function balanceOf(code: string) {
  const rows = await prisma.$queryRawUnsafe<{ natural_balance: string }[]>(
    `SELECT natural_balance FROM v_gl_account_balances WHERE "companyId" = $1 AND code = $2`, companyId, code,
  );
  return rows[0] ? Number(rows[0].natural_balance) : 0;
}

async function payrollCodes() {
  const rows = await prisma.accountDetermination.findMany({
    where: { companyId, area: 'PAYROLL' },
    include: { account: { select: { code: true } } },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.account.code])) as Record<string, string>;
}

async function installmentStatus(loanCode: string, month: number) {
  const loan = await prisma.employeeLoan.findFirstOrThrow({ where: { companyId, code: loanCode }, include: { installments: { orderBy: { ordering: 'asc' } } } });
  return { loanStatus: loan.status, installment: loan.installments[month]?.status };
}

async function newRun(extra: Record<string, unknown> = {}) {
  const res = await su('post', RUNS, { payPeriodId: periodJan, documentDate: '2026-01-31', payMonth: 'January 2026', ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  // Same pipeline as main.ts — in particular forbidNonWhitelisted, which is
  // what turns a PUT carrying `status` into a 400.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  server = app.getHttpServer();

  const company = await prisma.company.create({
    data: { name: `Payroll E2E ${stamp}`, slug: `payroll-e2e-${stamp}`, currency: 'PKR', fiscalYearStart: 1 },
  });
  companyId = company.id;
  await prisma.$queryRawUnsafe(`SELECT erp_bootstrap_financials($1, 2026)`, companyId);
  await prisma.$queryRawUnsafe(`SELECT erp_seed_payroll_demo_data($1, 2026)`, companyId);
  periodJan = (await prisma.payPeriod.findFirstOrThrow({ where: { companyId, code: 'PP-2026-01' } })).id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.user.create({
    data: { name: 'E2E Super', email: `e2e.super.${stamp}@example.com`, passwordHash, isSuperAdmin: true, roleType: 'SUPER_ADMIN', passwordChangedAt: new Date() },
  });
  superToken = await login(`e2e.super.${stamp}@example.com`);

  // An HR payroll officer: may view/create/update payroll, has the module,
  // and has no finance.journal.post. (Fixture rows written directly; in the
  // product the module comes through ModuleGrantsService.request().)
  const hrUser = await prisma.user.create({
    data: { name: 'E2E HR', email: `e2e.hr.${stamp}@example.com`, passwordHash, companyId, roleType: 'EMPLOYEE', passwordChangedAt: new Date() },
  });
  const role = await prisma.role.create({ data: { name: 'E2E Payroll Officer', companyId } });
  const perms = await prisma.permission.findMany({ where: { key: { in: ['hr.payroll.view', 'hr.payroll.create', 'hr.payroll.update', 'hr.payroll.delete'] } } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.userRole.create({ data: { userId: hrUser.id, roleId: role.id } });
  const mod = await prisma.systemModule.findUniqueOrThrow({ where: { slug: 'hr-payroll' } });
  await prisma.companyModule.create({ data: { companyId, moduleId: mod.id } });
  const fin = await prisma.systemModule.findUniqueOrThrow({ where: { slug: 'financials' } });
  await prisma.companyModule.create({ data: { companyId, moduleId: fin.id } });
  await prisma.userModule.create({ data: { userId: hrUser.id, moduleId: mod.id } });
  hrToken = await login(`e2e.hr.${stamp}@example.com`, company.slug);
}, 180_000);

afterAll(async () => {
  // Ledger rows are immutable by trigger; teardown steps around them once.
  // …and so are posted payroll runs and their lines (20260926050000).
  const off = ['journal_lines DISABLE TRIGGER journal_line_guard', 'journal_lines DISABLE TRIGGER journal_line_balance_guard', 'journal_entries DISABLE TRIGGER journal_entry_guard',
    'payroll_runs DISABLE TRIGGER payroll_runs_lock', 'payroll_run_lines DISABLE TRIGGER payroll_run_lines_lock'];
  try {
    for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t}`);
    await prisma.payrollRun.updateMany({ where: { companyId }, data: { journalEntryId: null } });
    await prisma.journalEntry.updateMany({ where: { companyId }, data: { reversalOfId: null } });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.approvalTemplate.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  } finally {
    for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t.replace('DISABLE', 'ENABLE')}`);
    await prisma.user.deleteMany({ where: { email: { contains: `.${stamp}@example.com` } } });
    await prisma.$disconnect();
    await app.close();
  }
});

describe('Payroll Process — full flow', () => {
  let runId = '';
  let lines: any[] = [];
  const before: Record<string, number> = {};
  let codes: Record<string, string> = {};

  it('Add: creates a run with category, run type, pay month and remarks, and reads them back', async () => {
    const cat = await prisma.employeeCategory.findFirstOrThrow({ where: { companyId, code: 'PERM' } });
    const created = await su('post', RUNS, {
      payPeriodId: periodJan, employeeCategoryId: cat.id, runType: 'Regular',
      payMonth: 'January 2026', documentDate: '2026-01-31', remarks: 'E2E run',
    });
    expect(created.status).toBe(201);
    runId = created.body.id;
    const read = await su('get', `${RUNS}/${runId}`);
    expect(read.body).toMatchObject({
      status: 'Open', runType: 'Regular', payMonth: 'January 2026', remarks: 'E2E run',
      employeeCategoryId: cat.id, payPeriodId: periodJan,
    });
    expect(read.body.employeeCategory.code).toBe('PERM');
    expect(read.body.payPeriod.workingDays).toBe(22);
  });

  it('Edit: a PUT carrying status / jeNo / cancellationJeNo / journalEntryId is refused with 400', async () => {
    for (const field of ['status', 'jeNo', 'cancellationJeNo', 'journalEntryId', 'employeeType']) {
      const res = await su('put', `${RUNS}/${runId}`, { [field]: field === 'status' ? 'Posted' : 'X' });
      expect(res.status).toBe(400);
    }
    expect((await su('get', `${RUNS}/${runId}`)).body.status).toBe('Open');
  });

  it('Generate: only the run\'s category, with non-zero pay, tax, loan, advance and LOP', async () => {
    // Widen to All so the loan (DEMO-002, PERM), advance (DEMO-003, PERM) and
    // contract staff are all in; then check the category filter separately.
    const permOnly = await su('post', `${RUNS}/${runId}/generate`);
    expect(permOnly.status).toBe(201);
    const permCount = permOnly.body.lines.length;
    expect(permCount).toBe(5);

    expect((await su('put', `${RUNS}/${runId}`, { employeeCategoryId: null })).status).toBe(200);
    const all = await su('post', `${RUNS}/${runId}/generate`);
    lines = all.body.lines;
    expect(lines).toHaveLength(8);
    const by = (num: string) => lines.find((l) => l.employee.employeeNumber === num);

    expect(Number(by('DEMO-001').grossPay)).toBe(140000 + 28000 + 12000);
    expect(Number(by('DEMO-001').taxDeduction)).toBeGreaterThan(0);
    expect(Number(by('DEMO-002').loanDeduction)).toBe(5000);
    expect(Number(by('DEMO-003').advanceDeduction)).toBe(20000);
    expect(Number(by('DEMO-003').loanDeduction)).toBe(0);
    expect(Number(by('DEMO-004').unpaidLeaveDays)).toBe(2);
    expect(Number(by('DEMO-004').lopDeduction)).toBeGreaterThan(0);
    // No attendance rows exist: nobody else is charged absence.
    for (const l of lines.filter((x) => x.employee.employeeNumber !== 'DEMO-004')) expect(Number(l.lopDays)).toBe(0);
    for (const l of lines) {
      const expectedNet = Number(l.totalEarnings) - Number(l.totalDeductions);
      expect(Number(l.netPay)).toBeCloseTo(expectedNet, 2);
    }
  });

  it('Save Grid: saving the generated rows unchanged keeps every total', async () => {
    const rows = lines.map((l) => {
      const { id, payrollRunId, employee, grossPay, totalEarnings, totalDeductions, netPay, ordering, employeeType,
        companyId: _c, payPeriodId: _p, runType: _t, runActive: _a, ...rest } = l;
      return rest;
    });
    const saved = await su('put', `${RUNS}/${runId}/lines`, { rows });
    expect(saved.status).toBe(200);
    const net = (xs: any[]) => xs.reduce((s, x) => s + Number(x.netPay), 0);
    expect(net(saved.body)).toBeCloseTo(net(lines), 2);
  });

  it('HR user (no finance rights): can view and generate, gets a clear 403 on Post', async () => {
    expect((await call(hrToken, 'get', RUNS, undefined, false)).status).toBe(200);
    expect((await call(hrToken, 'post', `${RUNS}/${runId}/generate`, undefined, false)).status).toBe(201);
    const post = await call(hrToken, 'post', `${RUNS}/${runId}/post`, undefined, false);
    expect(post.status).toBe(403);
    expect(JSON.stringify(post.body)).toMatch(/finance\.journal\.post/);
  });

  it('Post: balanced JE in PKR; loan and advance installments become Paid; the advance is Recovered', async () => {
    codes = await payrollCodes();
    for (const k of Object.keys(codes)) before[k] = await balanceOf(codes[k]);

    const t0 = Date.now();
    const posted = await su('post', `${RUNS}/${runId}/post`);
    const ms = Date.now() - t0;
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('Posted');
    expect(posted.body.jeNo).toMatch(/^JE-/);
    console.log(`[timing] Post, 8 employees, local Postgres: ${ms} ms`);

    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.body.journalEntryId }, include: { lines: { include: { account: true } } } });
    expect(je.currency).toBe('PKR');
    expect(je.source).toBe('payroll_run');
    expect(Number(je.totalDebit)).toBeCloseTo(Number(je.totalCredit), 2);
    const credit = (code: string) => je.lines.filter((l) => l.account.code === code).reduce((s, l) => s + Number(l.credit), 0);
    expect(credit(codes.loan_receivable)).toBe(5000);
    expect(credit(codes.advance_receivable)).toBe(20000);
    expect(credit(codes.tax_payable)).toBeGreaterThan(0);
    expect(je.lines.find((l) => l.account.code === codes.advance_receivable)?.description).toBe('Advance recovered — January 2026');

    expect(await installmentStatus('DEMO-LN-001', 0)).toEqual({ loanStatus: 'Open', installment: 'Paid' });
    expect(await installmentStatus('DEMO-LN-001', 1)).toEqual({ loanStatus: 'Open', installment: 'Pending' });
    expect(await installmentStatus('DEMO-ADV-001', 0)).toEqual({ loanStatus: 'Recovered', installment: 'Paid' });

    expect(await balanceOf(codes.loan_receivable) - before.loan_receivable).toBe(-5000);
    expect(await balanceOf(codes.advance_receivable) - before.advance_receivable).toBe(-20000);
  });

  it('Lock: a posted run cannot be posted again, edited, deleted, regenerated or have its lines replaced', async () => {
    expect((await su('post', `${RUNS}/${runId}/post`)).status).toBe(409);
    expect((await su('put', `${RUNS}/${runId}`, { remarks: 'changed' })).status).toBe(409);
    expect((await su('delete', `${RUNS}/${runId}`)).status).toBe(409);
    expect((await su('post', `${RUNS}/${runId}/generate`)).status).toBe(409);
    expect((await su('put', `${RUNS}/${runId}/lines`, { rows: [] })).status).toBe(409);
  });

  it('Lock: the payroll JE cannot be reversed from the Journal Entry window — only Cancel Posting undoes it', async () => {
    const run = await su('get', `${RUNS}/${runId}`);
    const res = await su('post', `/financials/journal-entries/${run.body.journalEntryId}/reverse`, {});
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Cancel Posting in HR Payroll/);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: run.body.journalEntryId } })).status).toBe('POSTED');
  });

  it('Lock: the posted run\'s pay period cannot change its dates/working days or be deleted', async () => {
    const res = await su('put', `/hr/payroll-masters/pay-periods/${periodJan}`, { workingDays: 20 });
    expect([409, 404]).toContain(res.status);
    if (res.status === 404) throw new Error('pay-period route path differs — adjust the test');
    expect((await su('delete', `/hr/payroll-masters/pay-periods/${periodJan}`)).status).toBe(409);
    expect((await su('put', `/hr/payroll-masters/pay-periods/${periodJan}`, { remarks: 'note' })).status).toBe(200);
  });

  it('Duplicate: a second Regular run in the same period skips everyone already paid, and refuses them on Save', async () => {
    const second = await newRun();
    const gen = await su('post', `${RUNS}/${second}/generate`);
    expect(gen.body.lines).toHaveLength(0);
    expect(gen.body.skipped).toHaveLength(8);
    const emp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-001' } });
    const save = await su('put', `${RUNS}/${second}/lines`, { rows: [{ employeeId: emp.id, basic: 1000 }] });
    expect(save.status).toBe(409);
    expect(save.body.message).toMatch(/DEMO-001 Ayesha Khan/);
    expect((await su('delete', `${RUNS}/${second}`)).status).toBe(200);
  });

  it('Cancel: reversal JE, installments and the advance back to unpaid, balances back to before', async () => {
    const cancelled = await su('post', `${RUNS}/${runId}/cancel`, { reason: 'E2E cancel' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('Cancelled');
    expect(cancelled.body.cancellationJeNo).toMatch(/^JE-/);

    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { companyId, number: cancelled.body.cancellationJeNo } });
    expect(reversal.source).toBe('reversal');
    expect(await installmentStatus('DEMO-LN-001', 0)).toEqual({ loanStatus: 'Open', installment: 'Pending' });
    expect(await installmentStatus('DEMO-ADV-001', 0)).toEqual({ loanStatus: 'Open', installment: 'Pending' });
    for (const k of Object.keys(codes)) expect(await balanceOf(codes[k])).toBeCloseTo(before[k], 2);

    const recoveries = await prisma.loanRecovery.findMany({ where: { payrollRunId: runId } });
    expect(recoveries.length).toBe(2);
    expect(recoveries.every((r) => r.reversedAt)).toBe(true);
  });

  it('Cancelled is terminal, and it freed the employees: a new run picks all 8 up again', async () => {
    expect((await su('post', `${RUNS}/${runId}/post`)).status).toBe(409);
    expect((await su('put', `${RUNS}/${runId}`, { remarks: 'x' })).status).toBe(409);
    const again = await newRun();
    const gen = await su('post', `${RUNS}/${again}/generate`);
    expect(gen.body.lines).toHaveLength(8);
    expect(Number(gen.body.lines.find((l: any) => l.employee.employeeNumber === 'DEMO-003').advanceDeduction)).toBe(20000);
    expect((await su('delete', `${RUNS}/${again}`)).status).toBe(200);
  });
});

describe('Payroll Process — failure modes are clear messages, never a 500', () => {
  it('a Regular run without a pay period', async () => {
    const res = await su('post', RUNS, { runType: 'Regular', documentDate: '2026-01-31' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/needs a Pay Period/);
  });

  it('a pay period or category from another company', async () => {
    const other = await prisma.payPeriod.findFirst({ where: { companyId: { not: companyId } } });
    if (other) expect((await su('post', RUNS, { payPeriodId: other.id })).status).toBe(400);
  });

  it('missing PAYROLL mapping', async () => {
    const run = await newRun();
    await su('post', `${RUNS}/${run}/generate`);
    const mapping = await prisma.accountDetermination.findFirstOrThrow({ where: { companyId, area: 'PAYROLL', key: 'salary_expense' } });
    await prisma.accountDetermination.delete({ where: { id: mapping.id } });
    try {
      const res = await su('post', `${RUNS}/${run}/post`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/No G\/L account is mapped for PAYROLL\/salary_expense/);
    } finally {
      await prisma.accountDetermination.create({ data: { companyId, area: 'PAYROLL', key: 'salary_expense', accountId: mapping.accountId } });
      await su('delete', `${RUNS}/${run}`);
    }
  });

  it('closed posting period: 409 with the period named, and the session stays alive', async () => {
    const run = await newRun();
    await su('post', `${RUNS}/${run}/generate`);
    const jan = await prisma.fiscalPeriod.findFirstOrThrow({ where: { companyId, name: '2026-01' } });
    await prisma.fiscalPeriod.update({ where: { id: jan.id }, data: { status: 'CLOSED', generalStatus: 'CLOSED' } });
    try {
      const res = await su('post', `${RUNS}/${run}/post`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/closed/i);
      expect((await su('get', RUNS)).status).toBe(200); // not logged out
    } finally {
      await prisma.fiscalPeriod.update({ where: { id: jan.id }, data: { status: 'OPEN', generalStatus: 'OPEN' } });
      await su('delete', `${RUNS}/${run}`);
    }
  });

  it('Financials module not enabled for the company: clear 403, nothing posted', async () => {
    const run = await newRun();
    await su('post', `${RUNS}/${run}/generate`);
    const fin = await prisma.systemModule.findUniqueOrThrow({ where: { slug: 'financials' } });
    await prisma.companyModule.updateMany({ where: { companyId, moduleId: fin.id }, data: { isEnabled: false } });
    try {
      const res = await su('post', `${RUNS}/${run}/post`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Financials module is not enabled/);
      expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).status).toBe('Open');
    } finally {
      await prisma.companyModule.updateMany({ where: { companyId, moduleId: fin.id }, data: { isEnabled: true } });
      await su('delete', `${RUNS}/${run}`);
    }
  });

  it('company without a base currency', async () => {
    const run = await newRun();
    await su('post', `${RUNS}/${run}/generate`);
    await prisma.company.update({ where: { id: companyId }, data: { currency: null } });
    try {
      const res = await su('post', `${RUNS}/${run}/post`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no base currency/);
    } finally {
      await prisma.company.update({ where: { id: companyId }, data: { currency: 'PKR' } });
      await su('delete', `${RUNS}/${run}`);
    }
  });

  it('a Loan Ded. larger than what is owed', async () => {
    const run = await newRun({ runType: 'Supplementary' });
    const emp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-002' } });
    await su('put', `${RUNS}/${run}/lines`, { rows: [{ employeeId: emp.id, basic: 50000, loanDeduction: 30000 }] });
    const res = await su('post', `${RUNS}/${run}/post`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Loan Ded\. for DEMO-002 Bilal Ahmed is 30000 but only 5000 is outstanding/);
    await su('delete', `${RUNS}/${run}`);
  });
});

describe('Payroll Process — concurrency', () => {
  it('two runs posted at the same time for the same installment: exactly one wins', async () => {
    const emp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-002' } });
    const a = await newRun({ runType: 'Supplementary' });
    const b = await newRun({ runType: 'Off-cycle', payPeriodId: periodJan });
    // Both deduct the whole of DEMO-002's January installment (5,000).
    for (const r of [a, b]) {
      expect((await su('put', `${RUNS}/${r}/lines`, { rows: [{ employeeId: emp.id, basic: 50000, loanDeduction: 5000 }] })).status).toBe(200);
    }
    const [ra, rb] = await Promise.all([su('post', `${RUNS}/${a}/post`), su('post', `${RUNS}/${b}/post`)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.message).toMatch(/already been recovered|only 0 is outstanding/);

    const active = await prisma.loanRecovery.findMany({ where: { companyId, reversedAt: null, loan: { code: 'DEMO-LN-001' } } });
    expect(active.reduce((s, r) => s + Number(r.amount), 0)).toBe(5000);
    expect((await installmentStatus('DEMO-LN-001', 0)).installment).toBe('Paid');
    // The loser left nothing behind: still Open, no journal entry.
    const loserId = ra.status === 409 ? a : b;
    const loserRun = await prisma.payrollRun.findUniqueOrThrow({ where: { id: loserId } });
    expect(loserRun.status).toBe('Open');
    expect(loserRun.journalEntryId).toBeNull();

    const winnerId = loserId === a ? b : a;
    expect((await su('post', `${RUNS}/${winnerId}/cancel`, {})).status).toBe(201);
    expect((await installmentStatus('DEMO-LN-001', 0)).installment).toBe('Pending');
  });
});

describe('Payroll Process — the run lock (QA Round 3, Q1–Q3)', () => {
  /** A run with one line and no loan/advance, so the installment lock never fires. */
  async function plainRun(basic = 50000) {
    const emp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-001' } });
    const run = await newRun({ runType: 'Bonus' });
    expect((await su('put', `${RUNS}/${run}/lines`, { rows: [{ employeeId: emp.id, basic }] })).status).toBe(200);
    return { run, emp };
  }

  it('Q1: two Posts of the same run at once → exactly one journal entry, the loser gets a clear 409', async () => {
    const { run } = await plainRun();
    const [a, b] = await Promise.all([su('post', `${RUNS}/${run}/post`), su('post', `${RUNS}/${run}/post`)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.message).toMatch(/already posted/);
    const jes = await prisma.journalEntry.findMany({ where: { companyId, source: 'payroll_run', sourceId: run } });
    expect(jes).toHaveLength(1);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).journalEntryId).toBe(jes[0].id);
    expect((await su('post', `${RUNS}/${run}/cancel`, {})).status).toBe(201);
  });

  it('Q2: Save Grid racing Post → the posted journal always equals the stored lines (5 races)', async () => {
    for (let i = 0; i < 5; i++) {
      const { run, emp } = await plainRun(50000);
      const [post, save] = await Promise.all([
        su('post', `${RUNS}/${run}/post`),
        su('put', `${RUNS}/${run}/lines`, { rows: [{ employeeId: emp.id, basic: 77777 }] }),
      ]);
      expect(post.status).toBe(201);
      expect([200, 409]).toContain(save.status);
      if (save.status === 409) expect(save.body.message).toMatch(/posted and can no longer be changed/);
      const lines = await prisma.payrollRunLine.findMany({ where: { payrollRunId: run } });
      const je = await prisma.journalEntry.findFirstOrThrow({ where: { source: 'payroll_run', sourceId: run }, include: { lines: true } });
      const storedNet = lines.reduce((s, l) => s + Number(l.netPay), 0);
      const payable = await prisma.accountDetermination.findFirstOrThrow({ where: { companyId, area: 'PAYROLL', key: 'salaries_payable' } });
      const bookedNet = je.lines.filter((l) => l.accountId === payable.accountId).reduce((s, l) => s + Number(l.credit), 0);
      expect(bookedNet).toBeCloseTo(storedNet, 2);
      expect((await su('post', `${RUNS}/${run}/cancel`, {})).status).toBe(201);
    }
  });

  it('Q2: a direct SQL write to a posted run\'s lines is refused by the database', async () => {
    const { run } = await plainRun();
    expect((await su('post', `${RUNS}/${run}/post`)).status).toBe(201);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE payroll_run_lines SET basic = 1 WHERE "payrollRunId" = $1`, run),
    ).rejects.toThrow(/ERP_RULE: This payroll run is posted/);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE payroll_runs SET status = 'Open' WHERE id = $1`, run),
    ).rejects.toThrow(/cannot be reopened/);
    expect((await su('post', `${RUNS}/${run}/cancel`, {})).status).toBe(201);
  });

  it('Q3: two Cancels at once → exactly one reversal, recoveries reversed once', async () => {
    // A run that does recover something, so "reversed once" is observable.
    const emp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-002' } });
    const run = await newRun({ runType: 'Supplementary' });
    await su('put', `${RUNS}/${run}/lines`, { rows: [{ employeeId: emp.id, basic: 50000, loanDeduction: 5000 }] });
    expect((await su('post', `${RUNS}/${run}/post`)).status).toBe(201);
    const posted = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });

    const [a, b] = await Promise.all([su('post', `${RUNS}/${run}/cancel`, {}), su('post', `${RUNS}/${run}/cancel`, {})]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // Stopped by the run lock, not merely by the reversalOfId unique backstop.
    expect((a.status === 409 ? a : b).body.message).toMatch(/Only a posted payroll run can be cancelled/);
    expect(await prisma.journalEntry.count({ where: { reversalOfId: posted.journalEntryId } })).toBe(1);
    const recs = await prisma.loanRecovery.findMany({ where: { payrollRunId: run } });
    expect(recs).toHaveLength(1);
    expect(recs[0].reversedAt).not.toBeNull();
    expect((await installmentStatus('DEMO-LN-001', 0)).installment).toBe('Pending');
  });
});

describe('Payroll Monthly Adjustments — Employee Category (QA Round 3, §3)', () => {
  const ADJ = '/hr/transactions/payroll-adjustments';

  it('a category document refuses employees of another category, and Generate prefers it over an "All" document', async () => {
    const cont = await prisma.employeeCategory.findFirstOrThrow({ where: { companyId, code: 'CONT' } });
    const permEmp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-001' } }); // PERM
    const contEmp = await prisma.employee.findFirstOrThrow({ where: { companyId, employeeNumber: 'DEMO-006' } }); // CONT

    // A PUT carrying the old free-text field is refused, like on payroll runs.
    expect((await su('post', ADJ, { employeeType: 'CONT', payPeriodId: periodJan })).status).toBe(400);

    const contDoc = await su('post', ADJ, { employeeCategoryId: cont.id, payPeriodId: periodJan, documentDate: '2026-01-15' });
    expect(contDoc.status).toBe(201);
    expect(contDoc.body.employeeCategory.code).toBe('CONT');
    const wrong = await su('put', `${ADJ}/${contDoc.body.id}/lines`, { rows: [{ employeeId: permEmp.id, arrears: 100 }] });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/not in the Contract category/);
    expect((await su('put', `${ADJ}/${contDoc.body.id}/lines`, { rows: [{ employeeId: contEmp.id, arrears: 3000 }] })).status).toBe(200);

    // An "All employees" document for the same period gives everyone 111.
    const allDoc = await su('post', ADJ, { payPeriodId: periodJan, documentDate: '2026-01-16' });
    await su('put', `${ADJ}/${allDoc.body.id}/lines`, { rows: [{ employeeId: permEmp.id, arrears: 111 }, { employeeId: contEmp.id, arrears: 111 }] });

    const run = await newRun();
    const gen = await su('post', `${RUNS}/${run}/generate`);
    const addFor = (num: string) => Number(gen.body.lines.find((l: any) => l.employee.employeeNumber === num).adjustmentAdditions);
    expect(addFor('DEMO-006')).toBe(3000); // own category's document wins
    expect(addFor('DEMO-001')).toBe(111);  // no PERM document → the All document
    await su('delete', `${RUNS}/${run}`);
    await su('delete', `${ADJ}/${contDoc.body.id}`);
    await su('delete', `${ADJ}/${allDoc.body.id}`);
  });
});
