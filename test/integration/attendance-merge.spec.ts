import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * QA D30 / E5a, over HTTP: Generate reads attendance from every branch's
 * Approved sheet for the pay period.
 *
 * The defect: Generate took the single most recently updated sheet
 * (findFirst), so in a company with a sheet per branch every other branch's
 * absences were silently dropped and those employees were paid in full.
 */
const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'Attendance#Merge2026';
let app: INestApplication;
let server: any;
let companyId = '';
let token = '';
let periodJan = '';
let branchA = '';
let branchB = '';
const emp: Record<string, string> = {};

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
const SHEETS = '/hr/transactions/attendance-sheets';
const RUNS = '/hr/transactions/payroll-runs';

async function sheet(
  branchId: string,
  status: 'Open' | 'Approved',
  rows: { employeeId: string; presentDays: number }[],
) {
  const created = await api('post', SHEETS, {
    branchId,
    payPeriodId: periodJan,
    payPeriodMonth: 'January 2026',
    status,
  });
  expect(created.status).toBe(201);
  const lines = await api('put', `${SHEETS}/${created.body.id}/lines`, {
    rows: rows.map((r) => ({ ...r, workingDays: 22, totalDays: 31 })),
  });
  expect(lines.status).toBeLessThan(300);
  return created.body.id as string;
}

async function generate() {
  const run = await api('post', RUNS, {
    payPeriodId: periodJan,
    documentDate: '2026-01-31',
    payMonth: 'January 2026',
  });
  expect(run.status).toBe(201);
  const res = await api('post', `${RUNS}/${run.body.id}/generate`);
  return { runId: run.body.id as string, ...res };
}
const lopOf = (lines: any[], id: string) =>
  Number(lines.find((l) => l.employeeId === id)?.lopDays ?? NaN);

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
      name: `Attendance merge ${stamp}`,
      slug: `att-merge-${stamp}`,
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
  branchA = (
    await prisma.branch.create({
      data: { companyId, name: 'Lahore', code: 'LHE' },
    })
  ).id;
  branchB = (
    await prisma.branch.create({
      data: { companyId, name: 'Karachi', code: 'KHI' },
    })
  ).id;
  for (const n of ['DEMO-001', 'DEMO-005', 'DEMO-006']) {
    emp[n] = (
      await prisma.employee.findFirstOrThrow({
        where: { companyId, employeeNumber: n },
      })
    ).id;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const email = `att.super.${stamp}@example.com`;
  await prisma.user.create({
    data: {
      name: 'Att Super',
      email,
      passwordHash,
      isSuperAdmin: true,
      roleType: 'SUPER_ADMIN',
      passwordChangedAt: new Date(),
    },
  });
  const login = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  token = login.body?.data?.accessToken;
}, 180_000);

afterAll(async () => {
  try {
    await prisma.approvalTemplate.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  } finally {
    await prisma.user.deleteMany({
      where: { email: { contains: `.${stamp}@example.com` } },
    });
    await prisma.$disconnect();
    await app.close();
  }
});

describe('attendance → payroll: every branch, Approved only (QA D30)', () => {
  let sheetA = '';
  let sheetB = '';

  it("reads both branches' Approved sheets, not just the latest one", async () => {
    sheetA = await sheet(branchA, 'Approved', [
      { employeeId: emp['DEMO-001'], presentDays: 20 },
    ]);
    sheetB = await sheet(branchB, 'Approved', [
      { employeeId: emp['DEMO-005'], presentDays: 18 },
    ]);
    const res = await generate();
    expect(res.status).toBe(201);
    expect(lopOf(res.body.lines, emp['DEMO-001'])).toBe(2);
    expect(lopOf(res.body.lines, emp['DEMO-005'])).toBe(4);
    expect(res.body.warnings).toEqual([]);
    await api('delete', `${RUNS}/${res.runId}`);
  });

  it('an Open sheet is not used, and Generate says so', async () => {
    const open = await sheet(branchB, 'Open', [
      { employeeId: emp['DEMO-006'], presentDays: 10 },
    ]);
    const res = await generate();
    expect(lopOf(res.body.lines, emp['DEMO-006'])).toBe(0);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatch(
      /Karachi sheet .* is Open and was not used/,
    );
    await api('delete', `${RUNS}/${res.runId}`);
    await api('delete', `${SHEETS}/${open}`);
  });

  it('an employee on two Approved sheets is refused with 409 naming both', async () => {
    await api('put', `${SHEETS}/${sheetB}/lines`, {
      rows: [
        {
          employeeId: emp['DEMO-005'],
          presentDays: 18,
          workingDays: 22,
          totalDays: 31,
        },
        {
          employeeId: emp['DEMO-001'],
          presentDays: 22,
          workingDays: 22,
          totalDays: 31,
        },
      ],
    });
    const res = await generate();
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(
      /DEMO-001 .* is on two approved attendance sheets/,
    );
    expect(res.body.message).toMatch(/Lahore sheet/);
    expect(res.body.message).toMatch(/Karachi sheet/);
    await api('delete', `${RUNS}/${res.runId}`);
    expect(sheetA).toBeTruthy();
  });

  it('a sheet status other than Open / Approved is refused, by the DTO and by the database', async () => {
    const res = await api('put', `${SHEETS}/${sheetA}`, { status: 'Closed' });
    expect(res.status).toBe(400);
    // The DTO's own refusal — not the database CHECK further down, which
    // would also answer 400 (with "An attendance sheet is Open or Approved.").
    expect(JSON.stringify(res.body.message)).toMatch(
      /status must be one of the following values: Open, Approved/,
    );
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE monthly_attendance_sheets SET status = 'Closed' WHERE id = $1`,
        sheetA,
      ),
    ).rejects.toThrow(/monthly_attendance_sheets_status_check/);
  });
});
