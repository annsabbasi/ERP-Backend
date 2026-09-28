import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * Step 2 over HTTP and SQL, on a company built the way the migrations build
 * one (erp_bootstrap_financials + erp_seed_payroll_demo_data, which creates an
 * approved loan DEMO-LN-001 of 60,000 and an advance DEMO-ADV-001 of 20,000):
 *
 *   QA D45 — the pay scale's utility / medical / ad-hoc allowances are paid:
 *            Generate puts them on the line, and the paid gross is the gross
 *            the per-day LOP rate and the taxable gross are computed from.
 *   QA D11 — erp_open_loan_balances posts one balanced opening-balance entry,
 *            is idempotent, and after the first payroll recovery each
 *            receivable equals the loans still outstanding.
 */
const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'Step2#Data2026';
let app: INestApplication;
let server: any;
let token = '';
let companyId = '';
let periodJan = '';
let runId = '';

async function api(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  body?: unknown,
) {
  const req = request(server)
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`)
    .set('x-company-id', companyId);
  const res = await (body === undefined
    ? req.send()
    : req.send(body as object));
  const payload =
    res.body && res.body.success === true && 'data' in res.body
      ? res.body.data
      : res.body;
  return { status: res.status, body: payload };
}
const RUNS = '/hr/transactions/payroll-runs';

async function balanceOfKey(area: string, key: string) {
  const rows = await prisma.$queryRawUnsafe<{ b: string }[]>(
    `SELECT v.natural_balance::text b FROM account_determinations d JOIN accounts a ON a.id = d."accountId"
     JOIN v_gl_account_balances v ON v."companyId" = a."companyId" AND v.code = a.code
     WHERE d."companyId" = $1 AND d.area = $2::"AccountDeterminationArea" AND d.key = $3`,
    companyId,
    area,
    key,
  );
  return rows[0] ? Number(rows[0].b) : 0;
}
async function outstanding(loanType: 'Advance' | 'Personal') {
  const rows = await prisma.$queryRawUnsafe<{ o: string }[]>(
    `SELECT COALESCE(sum(COALESCE(el."sanctionedAmount", el."loanAmount")
       - COALESCE((SELECT sum(r.amount) FROM loan_recoveries r WHERE r."loanId" = el.id AND r."reversedAt" IS NULL), 0)), 0)::text o
     FROM employee_loans el JOIN loan_types lt ON lt.id = el."loanTypeId"
     WHERE el."companyId" = $1 AND el."disbursedBeforeSystem" AND lt."loanType" = $2`,
    companyId,
    loanType,
  );
  return Number(rows[0].o);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  server = app.getHttpServer();

  const company = await prisma.company.create({
    data: {
      name: `Step 2 ${stamp}`,
      slug: `step2-${stamp}`,
      currency: 'PKR',
      fiscalYearStart: 1,
    },
  });
  companyId = company.id;
  await prisma.$queryRawUnsafe(
    `SELECT erp_bootstrap_financials($1, 2026)`,
    companyId,
  );
  await prisma.$queryRawUnsafe(
    `SELECT erp_seed_payroll_demo_data($1, 2026)`,
    companyId,
  );
  periodJan = (
    await prisma.payPeriod.findFirstOrThrow({
      where: { companyId, code: 'PP-2026-01' },
    })
  ).id;
  for (const slug of ['hr-payroll', 'financials']) {
    const m = await prisma.systemModule.findUniqueOrThrow({ where: { slug } });
    await prisma.companyModule.create({ data: { companyId, moduleId: m.id } });
  }
  const email = `step2.super.${stamp}@example.com`;
  await prisma.user.create({
    data: {
      name: 'Step2 Super',
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      isSuperAdmin: true,
      roleType: 'SUPER_ADMIN',
      passwordChangedAt: new Date(),
    },
  });
  token = (
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
  ).body?.data?.accessToken;
}, 180_000);

afterAll(async () => {
  const off = [
    'journal_lines DISABLE TRIGGER journal_line_guard',
    'journal_lines DISABLE TRIGGER journal_line_balance_guard',
    'journal_entries DISABLE TRIGGER journal_entry_guard',
    'payroll_runs DISABLE TRIGGER payroll_runs_lock',
    'payroll_run_lines DISABLE TRIGGER payroll_run_lines_lock',
  ];
  try {
    for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t}`);
    await prisma.employeeLoan.updateMany({
      where: { companyId },
      data: { disbursementJournalEntryId: null },
    });
    await prisma.payrollRun.updateMany({
      where: { companyId },
      data: { journalEntryId: null },
    });
    await prisma.journalEntry.updateMany({
      where: { companyId },
      data: { reversalOfId: null },
    });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.approvalTemplate.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  } finally {
    for (const t of off)
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${t.replace('DISABLE', 'ENABLE')}`,
      );
    await prisma.user.deleteMany({
      where: { email: { contains: `.${stamp}@example.com` } },
    });
    await prisma.$disconnect();
    await app.close();
  }
});

describe('QA D45 — the pay scale allowances are paid', () => {
  it('Generate puts utility, medical and ad-hoc on the line; LOP and tax are computed on the gross that is paid', async () => {
    await prisma.gradePayScaleStage.updateMany({
      where: { grade: { companyId } },
      data: {
        utilityAllowance: 20000,
        medicalAllowance: 3000,
        adhoc2017: 1000,
        adhoc2018: 500,
      },
    });
    const run = await api('post', RUNS, {
      payPeriodId: periodJan,
      documentDate: '2026-01-31',
      payMonth: 'January 2026',
    });
    runId = run.body.id;
    const gen = await api('post', `${RUNS}/${runId}/generate`);
    expect(gen.status).toBe(201);
    for (const l of gen.body.lines) {
      expect(Number(l.utilityAllowance)).toBe(20000);
      expect(Number(l.medicalAllowance)).toBe(3000);
      expect(Number(l.adhoc2017)).toBe(1000);
      expect(Number(l.adhoc2018)).toBe(500);
      const paidGross =
        Number(l.basic) + Number(l.hra) + Number(l.conveyance) + 24500;
      expect(Number(l.grossPay)).toBeCloseTo(paidGross, 2);
      // The per-day rate is the paid gross over the working days …
      expect(Number(l.perDayRate) * Number(l.totalDaysWorking)).toBeCloseTo(
        paidGross,
        0,
      );
      // … and the taxable gross is that gross less LOP, plus additions.
      expect(Number(l.taxableGross)).toBeCloseTo(
        paidGross -
          Number(l.lopDeduction ?? 0) +
          Number(l.adjustmentAdditions ?? 0),
        2,
      );
      expect(Number(l.netPay)).toBeCloseTo(
        Number(l.totalEarnings) - Number(l.totalDeductions),
        2,
      );
    }
    // DEMO-004 has 2 days unpaid leave: the LOP uses the full paid gross.
    const d4 = gen.body.lines.find(
      (l: any) => l.employee.employeeNumber === 'DEMO-004',
    );
    expect(Number(d4.lopDeduction)).toBeCloseTo(
      (Number(d4.grossPay) / Number(d4.totalDaysWorking)) * 2,
      1,
    );
  });

  it('Save Grid keeps the allowances (they are row fields, not recomputed away)', async () => {
    const lines = (await api('get', `${RUNS}/${runId}/lines`)).body;
    const keep = [
      'employeeId',
      'totalDaysWorking',
      'lopDays',
      'totalDaysWorked',
      'paidDays',
      'payLeaves',
      'basic',
      'hra',
      'conveyance',
      'utilityAllowance',
      'medicalAllowance',
      'adhoc2017',
      'adhoc2018',
      'perDayRate',
      'paidLeaveDays',
      'unpaidLeaveDays',
      'lopDeduction',
      'loanDeduction',
      'advanceDeduction',
      'taxableGross',
      'taxDeduction',
      'adjustmentAdditions',
      'adjustmentDeductions',
    ];
    const rows = lines.map((l: any) =>
      Object.fromEntries(
        keep
          .filter((k) => l[k] != null)
          .map((k) => [k, k === 'employeeId' ? l[k] : Number(l[k])]),
      ),
    );
    const saved = await api('put', `${RUNS}/${runId}/lines`, { rows });
    expect(saved.status).toBe(200);
    for (const [i, l] of saved.body.entries()) {
      expect(Number(l.grossPay)).toBeCloseTo(
        Number(lines.find((x: any) => x.employeeId === l.employeeId).grossPay),
        2,
      );
      expect(Number(l.utilityAllowance)).toBe(20000);
      void i;
    }
  });
});

describe('QA D11 — opening balances for loans disbursed before the system', () => {
  it('posts one balanced entry: each receivable = the loans outstanding, Opening Balance Equity = the total', async () => {
    // Before cutover, 5,000 of the loan was already recovered (a payment, as
    // a pre-system deduction would have been): the opening balance is what is
    // still owed, not the principal.
    const loan = await prisma.employeeLoan.findFirstOrThrow({
      where: { companyId, code: 'DEMO-LN-001' },
      include: { installments: { orderBy: { ordering: 'asc' } } },
    });
    await prisma.loanRecovery.create({
      data: {
        companyId,
        loanId: loan.id,
        installmentId: loan.installments[0].id,
        amount: 5000,
        source: 'payment',
      },
    });
    const lines = await prisma.$queryRawUnsafe<{ line: string }[]>(
      `SELECT erp_open_loan_balances($1, '2026-01-15') line`,
      companyId,
    );
    const text = lines.map((l) => l.line).join('\n');
    expect(text).toMatch(
      /loan DEMO-LN-001 .*opening balance 55000\.00 \(principal 60000\.00, recovered 5000\.00\)/,
    );
    expect(text).toMatch(
      /posted .*: Dr receivables 75000\.00 \/ Cr Opening Balance Equity 75000\.00 \(2 loan line/,
    );
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId, source: 'opening_balance' },
      include: { lines: true },
    });
    expect(Number(je.totalDebit)).toBe(75000);
    expect(Number(je.totalCredit)).toBe(75000);
    expect(je.lines.reduce((a, l) => a + Number(l.debit), 0)).toBe(75000);
    expect(je.lines.reduce((a, l) => a + Number(l.credit), 0)).toBe(75000);
    expect(je.status).toBe('POSTED');
    expect(await balanceOfKey('PAYROLL', 'loan_receivable')).toBe(55000);
    expect(await balanceOfKey('PAYROLL', 'advance_receivable')).toBe(20000);
    expect(await balanceOfKey('GENERAL', 'opening_balance')).toBe(75000);
    const loans = await prisma.employeeLoan.findMany({ where: { companyId } });
    expect(
      loans.every(
        (l) =>
          l.disbursedBeforeSystem && l.disbursementJournalEntryId === je.id,
      ),
    ).toBe(true);
  });

  it('is idempotent: a second call posts nothing', async () => {
    const lines = await prisma.$queryRawUnsafe<{ line: string }[]>(
      `SELECT erp_open_loan_balances($1, '2026-01-15') line`,
      companyId,
    );
    expect(lines.map((l) => l.line)).toEqual(['no undisbursed approved loans']);
    expect(
      await prisma.journalEntry.count({
        where: { companyId, source: 'opening_balance' },
      }),
    ).toBe(1);
  });

  it('after the first payroll recovery, each receivable equals the loans still outstanding', async () => {
    // The run was generated before the pre-cutover recovery existed; posting
    // it as it stands is refused (the installment is already recovered).
    // Generate again, as a user would, then post.
    expect((await api('post', `${RUNS}/${runId}/post`)).status).toBe(409);
    expect((await api('post', `${RUNS}/${runId}/generate`)).status).toBe(201);
    const posted = await api('post', `${RUNS}/${runId}/post`);
    expect(posted.status).toBe(201);
    const loanBal = await balanceOfKey('PAYROLL', 'loan_receivable');
    const advBal = await balanceOfKey('PAYROLL', 'advance_receivable');
    expect(loanBal).toBe(await outstanding('Personal'));
    expect(advBal).toBe(await outstanding('Advance'));
    // January's 5,000 installment was already recovered before cutover, so the
    // January run recovers nothing more of the loan; the advance (20,000, one
    // installment) is recovered in full.
    expect(loanBal).toBe(55000);
    expect(advBal).toBe(0);
    expect(loanBal).toBeGreaterThanOrEqual(0);
  });
});
