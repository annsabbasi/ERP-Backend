import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Shared setup for the integration suite.
 *
 * These tests write to a real Postgres and tear their data down again, which
 * is the only way to exercise triggers, deferred constraints, row locks and
 * genuine concurrency — none of that exists in a mock. That also makes them
 * dangerous pointed at the wrong database, so they refuse to start against one
 * that has not been declared disposable.
 */

const DISPOSABLE_HOSTS = ['localhost', '127.0.0.1', 'postgres', 'db'];

export function assertDisposableDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL could not be parsed.');
  }

  if (DISPOSABLE_HOSTS.includes(host)) return;
  if (process.env.ALLOW_DESTRUCTIVE_TESTS === 'yes-i-mean-it') return;

  throw new Error(
    `Refusing to run the integration suite against "${host}".\n` +
      `These tests create and delete ledger rows and briefly disable triggers, so they must ` +
      `only run against a disposable database — one of ${DISPOSABLE_HOSTS.join(', ')}.\n` +
      `If you genuinely mean to run them elsewhere, set ALLOW_DESTRUCTIVE_TESTS=yes-i-mean-it.`,
  );
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  companyId: string;
  userId: string;
  token: string;
  api: (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export async function bootstrap(): Promise<Harness> {
  assertDisposableDatabase();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const prisma = new PrismaClient();
  const server = app.getHttpServer();

  // Before login, so the token carries it.
  await ensureHarnessAccess(prisma);

  const login = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: 'manager@demo.com', password: 'password123', companySlug: 'demo' });
  if (login.status >= 300) {
    throw new Error(
      `Could not log in as the demo company admin (${login.status}). Run \`npm run prisma:seed\` first.`,
    );
  }
  const token = login.body?.data?.accessToken ?? login.body?.accessToken;
  // The subject claim, which is what the interceptor scopes an idempotency key
  // by. Read from the token rather than looked up, so the tests assert on the
  // same value the running code uses.
  const userId = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
  ).sub as string;
  const company = await prisma.company.findFirstOrThrow({ where: { slug: 'demo' } });

  const api: Harness['api'] = async (method, path, body, headers = {}) => {
    let req = request(server)[method](`/api/v1${path}`).set('authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    const res = await (body === undefined ? req.send() : req.send(body as object));
    // Successful responses are wrapped by the global interceptor.
    const payload =
      res.body && res.body.success === true && 'data' in res.body ? res.body.data : res.body;
    return { status: res.status, body: payload };
  };

  return {
    app,
    prisma,
    companyId: company.id,
    userId,
    token,
    api,
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/**
 * The suites act as the demo company's manager. Whether that user happens to
 * hold the Financials module or the Utilities permissions depends on whatever
 * database the suite is pointed at — a copy of live, for instance, has
 * Financials disabled for Demo — and a refusal there showed up as four
 * "environmental" failures that could just as well have hidden a real one.
 * So the suite sets up the access it needs itself: the modules it exercises
 * enabled for the company, and a fixture role holding every catalog
 * permission. Disposable databases only (assertDisposableDatabase above).
 */
async function ensureHarnessAccess(prisma: PrismaClient) {
  const company = await prisma.company.findUnique({ where: { slug: 'demo' } });
  const user = company
    ? await prisma.user.findFirst({ where: { email: 'manager@demo.com', companyId: company.id } })
    : null;
  if (!company || !user) return; // the login below reports the missing seed

  const modules = await prisma.systemModule.findMany({
    where: { slug: { in: ['administration', 'financials', 'banking', 'hr', 'hr-payroll', 'crm', 'purchasing', 'inventory'] } },
  });
  for (const m of modules) {
    const existing = await prisma.companyModule.findFirst({ where: { companyId: company.id, moduleId: m.id } });
    if (existing) {
      if (!existing.isEnabled) await prisma.companyModule.update({ where: { id: existing.id }, data: { isEnabled: true } });
    } else {
      await prisma.companyModule.create({ data: { companyId: company.id, moduleId: m.id } });
    }
  }

  const name = 'Integration fixture (all permissions)';
  const role =
    (await prisma.role.findFirst({ where: { companyId: company.id, name } })) ??
    (await prisma.role.create({ data: { companyId: company.id, name, description: 'Created by test/integration/harness.ts' } }));
  const perms = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  await prisma.userRole.createMany({ data: [{ userId: user.id, roleId: role.id }], skipDuplicates: true });
}

/** The natural balance of one account, straight out of the reporting view. */
export async function balance(prisma: PrismaClient, companyId: string, code: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ natural_balance: string }>>(
    `SELECT natural_balance FROM v_gl_account_balances WHERE "companyId" = $1 AND code = $2`,
    companyId,
    code,
  );
  return rows[0] ? Number(rows[0].natural_balance) : 0;
}

/**
 * Runs work with the ledger guards suspended, for teardown only.
 *
 * Test data cannot be removed through the API — that is the whole point of the
 * immutability rules. Deleting it directly means stepping around the triggers,
 * and doing that in one place, always re-enabling them, keeps a failed test
 * from leaving the guards off.
 */
export async function withGuardsDisabled(prisma: PrismaClient, fn: () => Promise<void>) {
  const off = [
    `ALTER TABLE journal_lines DISABLE TRIGGER journal_line_guard`,
    `ALTER TABLE journal_lines DISABLE TRIGGER journal_line_balance_guard`,
    `ALTER TABLE journal_entries DISABLE TRIGGER journal_entry_guard`,
  ];
  const on = [
    `ALTER TABLE journal_entries ENABLE TRIGGER journal_entry_guard`,
    `ALTER TABLE journal_lines ENABLE TRIGGER journal_line_balance_guard`,
    `ALTER TABLE journal_lines ENABLE TRIGGER journal_line_guard`,
  ];
  for (const sql of off) await prisma.$executeRawUnsafe(sql);
  try {
    await fn();
  } finally {
    for (const sql of on) await prisma.$executeRawUnsafe(sql);
  }
}

/**
 * Removes the documents a test created, along with everything they posted.
 *
 * Scoped by the ids the test actually made. An earlier version of this deleted
 * journal entries by `source`, which caught the reversals of unrelated entries
 * and left those originals stranded as REVERSED with nothing offsetting them —
 * a balanced-looking ledger that was quietly wrong.
 */
export async function cleanupDocuments(
  prisma: PrismaClient,
  companyId: string,
  ids: { arInvoices?: string[]; apBills?: string[] },
) {
  const arIds = (ids.arInvoices ?? []).filter(Boolean);
  const apIds = (ids.apBills ?? []).filter(Boolean);
  if (!arIds.length && !apIds.length) return;

  const [arPayments, apPayments] = await Promise.all([
    prisma.aRPayment.findMany({ where: { invoiceId: { in: arIds } }, select: { id: true } }),
    prisma.aPPayment.findMany({ where: { billId: { in: apIds } }, select: { id: true } }),
  ]);
  const sourceIds = [
    ...arIds, ...apIds,
    ...arPayments.map((p) => p.id),
    ...apPayments.map((p) => p.id),
  ];

  const direct = await prisma.journalEntry.findMany({
    where: { companyId, sourceId: { in: sourceIds } },
    select: { id: true },
  });
  // Reversals name the entry they reverse, so voided documents pull their
  // mirror entries in too.
  const reversals = await prisma.journalEntry.findMany({
    where: { companyId, reversalOfId: { in: direct.map((e) => e.id) } },
    select: { id: true },
  });
  const entryIds = [...direct, ...reversals].map((e) => e.id);

  await withGuardsDisabled(prisma, async () => {
    if (arIds.length) {
      await prisma.aRInvoice.updateMany({ where: { id: { in: arIds } }, data: { journalEntryId: null } });
      await prisma.aRPayment.updateMany({ where: { invoiceId: { in: arIds } }, data: { journalEntryId: null } });
    }
    if (apIds.length) {
      await prisma.aPBill.updateMany({ where: { id: { in: apIds } }, data: { journalEntryId: null } });
      await prisma.aPPayment.updateMany({ where: { billId: { in: apIds } }, data: { journalEntryId: null } });
    }
    if (entryIds.length) {
      await prisma.journalEntry.updateMany({
        where: { id: { in: entryIds } }, data: { reversalOfId: null } });
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    if (arIds.length) {
      await prisma.aRPayment.deleteMany({ where: { invoiceId: { in: arIds } } });
      await prisma.aRInvoice.deleteMany({ where: { id: { in: arIds } } });
    }
    if (apIds.length) {
      await prisma.aPPayment.deleteMany({ where: { billId: { in: apIds } } });
      await prisma.aPBill.deleteMany({ where: { id: { in: apIds } } });
    }
  });
}

/**
 * Nothing a test leaves behind may make the ledger inconsistent. Asserted after
 * every suite, because a teardown bug is as damaging as a production one and
 * far easier to miss.
 */
export async function assertLedgerConsistent(prisma: PrismaClient, companyId: string) {
  const [totals] = await prisma.$queryRawUnsafe<Array<{ dr: string; cr: string }>>(
    `SELECT COALESCE(SUM(total_debit),0) dr, COALESCE(SUM(total_credit),0) cr
       FROM v_gl_account_balances WHERE "companyId" = $1`,
    companyId,
  );
  expect(Number(totals.dr)).toBe(Number(totals.cr));

  const stranded = await prisma.journalEntry.count({
    where: { companyId, status: 'REVERSED', reversal: null },
  });
  expect(stranded).toBe(0);
}

/** A customer and a vendor to trade with, reused across runs. */
export async function tradingPartners(prisma: PrismaClient, companyId: string) {
  const ensure = async (cardType: 'CUSTOMER' | 'VENDOR', cardName: string, cardCode: string) =>
    (await prisma.businessPartner.findFirst({ where: { companyId, cardCode } })) ??
    (await prisma.businessPartner.create({ data: { companyId, cardCode, cardName, cardType } }));

  return {
    customer: await ensure('CUSTOMER', 'Integration Test Customer', 'CTEST01'),
    vendor: await ensure('VENDOR', 'Integration Test Vendor', 'VTEST01'),
  };
}
