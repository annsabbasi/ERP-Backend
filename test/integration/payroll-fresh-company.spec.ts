import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * A company onboarded through the real endpoint (POST /companies/onboard —
 * template, then DemoDataSeederService, which ends with
 * erp_apply_payroll_defaults) can run payroll and A/P with tax straight away.
 *
 * "Zero setup" is precise here: nothing is written to the database directly.
 * The only setup is what a user must do in the app anyway, done through the
 * same HTTP endpoints the windows call — give a grade a pay scale and hire one
 * employee (a company is not onboarded with staff). Pay periods, payroll G/L
 * accounts, every determination, the fiscal year, numbering and the currency
 * all come from onboarding.
 *
 * Also records a fact for the owner: which modules a generic-template company
 * gets. hr-payroll is not among them; the requests below are made by a
 * platform super admin, whom the module guard lets through.
 */
const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'Fresh#Company2026';
let app: INestApplication;
let token = '';
let companyId = '';

const api = async (method: 'get' | 'post' | 'put', path: string, body?: unknown) => {
  let req = request(app.getHttpServer())[method](`/api/v1${path}`).set('authorization', `Bearer ${token}`);
  if (companyId) req = req.set('x-company-id', companyId);
  const res = await (body === undefined ? req.send() : req.send(body as object));
  const payload = res.body && res.body.success === true && 'data' in res.body ? res.body.data : res.body;
  return { status: res.status, body: payload };
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();

  const email = `fresh.super.${stamp}@example.com`;
  await prisma.user.create({
    data: { name: 'Fresh Super', email, passwordHash: await bcrypt.hash(PASSWORD, 10), isSuperAdmin: true, roleType: 'SUPER_ADMIN', passwordChangedAt: new Date() },
  });
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  token = login.body?.data?.accessToken;
}, 120_000);

afterAll(async () => {
  const off = ['journal_lines DISABLE TRIGGER journal_line_guard', 'journal_lines DISABLE TRIGGER journal_line_balance_guard',
    'journal_entries DISABLE TRIGGER journal_entry_guard', 'journal_entries DISABLE TRIGGER journal_entry_post_guard', 'payroll_runs DISABLE TRIGGER payroll_runs_lock',
    'payroll_run_lines DISABLE TRIGGER payroll_run_lines_lock'];
  try {
    if (companyId) {
      for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t}`);
      await prisma.payrollRun.updateMany({ where: { companyId }, data: { journalEntryId: null } });
      await prisma.journalEntry.updateMany({ where: { companyId }, data: { reversalOfId: null } });
      await prisma.journalEntry.deleteMany({ where: { companyId } });
      await prisma.approvalTemplate.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    }
  } finally {
    for (const t of off) await prisma.$executeRawUnsafe(`ALTER TABLE ${t.replace('DISABLE', 'ENABLE')}`);
    await prisma.user.deleteMany({ where: { email: { contains: `.${stamp}@example.com` } } });
    await prisma.$disconnect();
    await app.close();
  }
});

describe('a freshly onboarded company', () => {
  it('onboards through POST /companies/onboard', async () => {
    const res = await api('post', '/companies/onboard', {
      name: `Fresh Co ${stamp}`, slug: `fresh-co-${stamp}`, currency: 'PKR', fiscalYearStart: 1,
      planKey: 'starter', adminName: 'Fresh Admin', adminEmail: `fresh.admin.${stamp}@example.com`, adminPassword: PASSWORD,
    });
    expect(res.status).toBeLessThan(300);
    const company = await prisma.company.findUniqueOrThrow({ where: { slug: `fresh-co-${stamp}` } });
    companyId = company.id;
    expect(company.currency).toBe('PKR'); // not the generic template's USD
  });

  it('records which modules the generic template enables (for the owner)', async () => {
    const enabled = (await prisma.companyModule.findMany({ where: { companyId, isEnabled: true }, include: { module: true } }))
      .map((m) => m.module.slug).sort();
    console.log(`[fact] generic-template company modules: ${enabled.join(', ')}`);
    expect(enabled).toContain('financials');
    expect(enabled).not.toContain('hr-payroll'); // the owner decides whether it should be
  });

  it('came with every payroll + A/P determination, pay periods and a Salary Advance loan type', async () => {
    const keys = (await prisma.accountDetermination.findMany({ where: { companyId } })).map((d) => `${d.area}/${d.key}`).sort();
    for (const k of ['PAYROLL/salary_expense', 'PAYROLL/salaries_payable', 'PAYROLL/tax_payable', 'PAYROLL/loan_receivable',
      'PAYROLL/advance_receivable', 'PURCHASING/tax_receivable', 'PURCHASING/domestic_ap', 'PURCHASING/expense', 'GENERAL/cash']) {
      expect(keys).toContain(k);
    }
    expect(await prisma.payPeriod.count({ where: { companyId } })).toBe(12);
    expect((await prisma.loanType.findMany({ where: { companyId } })).map((t) => t.code).sort()).toEqual(['ADV', 'PL']);
  });

  it('Add → Generate → Post works with only in-app setup (a pay scale and one employee)', async () => {
    const grade = await api('post', '/hr/payroll-masters/grades', { code: 'FG1', description: 'Fresh grade' });
    expect(grade.status).toBe(201);
    expect((await api('put', `/hr/payroll-masters/grades/${grade.body.id}/pay-scale`, {
      rows: [{ stage: 1, basicPay: 60000, hra: 12000, conveyanceAllowance: 5000 }],
    })).status).toBe(200);
    const emp = await api('post', '/employees', { name: 'First Hire', employeeNumber: 'F-001', gradeId: grade.body.id });
    expect(emp.status).toBe(201);
    // …and one employee whose grade has no pay scale: reported, not paid 0.
    const bare = await api('post', '/hr/payroll-masters/grades', { code: 'FG2', description: 'No scale yet' });
    await api('post', '/employees', { name: 'Second Hire', employeeNumber: 'F-002', gradeId: bare.body.id });

    const period = await prisma.payPeriod.findFirstOrThrow({ where: { companyId, code: 'PP-2026-01' } });
    const run = await api('post', '/hr/transactions/payroll-runs', { payPeriodId: period.id, documentDate: '2026-01-31', payMonth: 'January 2026' });
    expect(run.status).toBe(201);

    const gen = await api('post', `/hr/transactions/payroll-runs/${run.body.id}/generate`);
    expect(gen.body.lines).toHaveLength(1);
    expect(Number(gen.body.lines[0].netPay)).toBe(77000);
    expect(gen.body.noPayScale).toEqual([expect.objectContaining({ name: 'F-002 Second Hire', reason: 'No pay scale for grade FG2' })]);

    const posted = await api('post', `/hr/transactions/payroll-runs/${run.body.id}/post`);
    expect(posted.status).toBe(201);
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.body.journalEntryId } });
    expect(je.currency).toBe('PKR');
    expect(Number(je.totalDebit)).toBe(77000);
  });

  it('an A/P invoice with tax posts (Input Tax Recoverable was missing from the new-company chart)', async () => {
    const vendor = await prisma.businessPartner.create({ data: { companyId, cardCode: 'V-FRESH', cardName: 'Fresh Vendor', cardType: 'VENDOR' } });
    const bill = await api('post', '/financials/ap-bills', {
      bpId: vendor.id, number: `FRESH-${stamp}`, issueDate: '2026-01-20',
      lines: [{ description: 'Stationery', quantity: 1, unitPrice: 1000, taxPercent: 17 }],
    });
    expect(bill.status).toBeLessThan(300);
    const approved = await api('post', `/financials/ap-bills/${bill.body.id}/post`);
    expect(approved.status).toBeLessThan(300);
    expect(approved.body.status).toBe('APPROVED');
    const taxAcct = await prisma.accountDetermination.findFirstOrThrow({ where: { companyId, area: 'PURCHASING', key: 'tax_receivable' }, include: { account: true } });
    expect(taxAcct.account.name).toBe('Input Tax Recoverable');
  });
});
