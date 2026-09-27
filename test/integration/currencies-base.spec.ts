import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * E8 over HTTP: the base currency can be read and set from the currency
 * master (the Currencies window), is refused once anything is posted, and
 * cannot be deleted; payroll's currency errors name the window's real path.
 */
const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'Currencies#Base2026';
let app: INestApplication;
let server: any;
let token = '';
let companyId = '';

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
const CUR = '/financials/currencies';

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
  // A company whose base currency is not in its master: the state the 7
  // bootstrap-less live companies are in.
  const company = await prisma.company.create({
    data: {
      name: `Currencies ${stamp}`,
      slug: `cur-${stamp}`,
      currency: 'PKR',
    },
  });
  companyId = company.id;
  for (const slug of ['financials', 'hr-payroll']) {
    const m = await prisma.systemModule.findUniqueOrThrow({ where: { slug } });
    await prisma.companyModule.create({ data: { companyId, moduleId: m.id } });
  }
  const email = `cur.super.${stamp}@example.com`;
  await prisma.user.create({
    data: {
      name: 'Cur Super',
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
}, 120_000);

afterAll(async () => {
  // Posted entries are immutable by trigger; teardown steps around it once.
  const off = 'journal_entries DISABLE TRIGGER journal_entry_guard';
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${off}`);
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${off.replace('DISABLE', 'ENABLE')}`,
    );
    await prisma.user.deleteMany({
      where: { email: { contains: `.${stamp}@example.com` } },
    });
    await prisma.$disconnect();
    await app.close();
  }
});

describe('base currency (E8)', () => {
  let pkr = '';
  let usd = '';

  it('reports a base currency missing from the master', async () => {
    const res = await api('get', `${CUR}/base`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code: 'PKR',
      inMaster: false,
      postedEntries: 0,
      canChange: true,
    });
  });

  it('payroll names the Currencies window when the base currency is not in the master', async () => {
    const run = await api('post', '/hr/transactions/payroll-runs', {
      runType: 'Off-cycle',
      documentDate: '2026-01-31',
      payMonth: 'January 2026',
    });
    expect(run.status).toBe(201);
    const post = await api(
      'post',
      `/hr/transactions/payroll-runs/${run.body.id}/post`,
    );
    expect(post.status).toBe(400);
    expect(post.body.message).toMatch(
      /Administration → Setup → Financials → Currencies/,
    );
  });

  it('adding the currency to the master fixes it; another can become the base while nothing is posted', async () => {
    pkr = (
      await api('post', CUR, {
        code: 'PKR',
        name: 'Pakistani Rupee',
        hundredthName: 'Paisa',
      })
    ).body.id;
    usd = (await api('post', CUR, { code: 'USD', name: 'US Dollar' })).body.id;
    expect((await api('get', `${CUR}/base`)).body).toMatchObject({
      code: 'PKR',
      inMaster: true,
    });
    const made = await api('post', `${CUR}/${usd}/make-base`);
    expect(made.status).toBe(201);
    expect(made.body.code).toBe('USD');
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: companyId } }))
        .currency,
    ).toBe('USD');
  });

  it('the base currency cannot be deleted', async () => {
    const res = await api('delete', `${CUR}/${usd}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/USD is the company's base currency/);
  });

  it('once anything is posted, the base currency can no longer change', async () => {
    const period = await prisma.fiscalPeriod.create({
      data: {
        companyId,
        name: `P${stamp}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO journal_entries (id, "companyId", "periodId", number, date, "docDate", currency, status, "totalDebit", "totalCredit", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'T-1', now(), now(), 'USD', 'POSTED', 0, 0, now(), now())`,
      companyId,
      period.id,
    );
    const res = await api('post', `${CUR}/${pkr}/make-base`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already has 1 posted journal entry/);
    expect((await api('get', `${CUR}/base`)).body).toMatchObject({
      code: 'USD',
      canChange: false,
    });
  });
});
