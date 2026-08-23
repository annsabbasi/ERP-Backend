import { PrismaClient } from '@prisma/client';
import { assertDisposableDatabase } from './harness';

/**
 * F14 — the reporting views are not managed by Prisma.
 *
 * The views preview feature is off, so `prisma migrate diff` cannot see them.
 * They are hand-written in migrations, which means nothing detects it when a
 * column they select is renamed or retyped: the migration succeeds, the view is
 * silently dropped or left stale, and the first sign of trouble is a report
 * returning nothing. This is the check that turns that into a failed build.
 */

const EXPECTED_VIEWS = [
  'v_customer_summary',
  'v_gl_account_balances',
  'v_order_to_cash',
  'v_procure_to_pay',
];

describe('reporting views', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    assertDisposableDatabase();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('all exist', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
    );
    const present = rows.map((r) => r.table_name);
    for (const view of EXPECTED_VIEWS) expect(present).toContain(view);
  });

  // A view whose underlying column was renamed still appears in
  // information_schema; it fails when selected from. Existence alone proves
  // nothing, so each one is actually queried.
  it.each(EXPECTED_VIEWS)('%s is queryable', async (view) => {
    await expect(prisma.$queryRawUnsafe(`SELECT * FROM ${view} LIMIT 1`)).resolves.toBeDefined();
  });

  it('v_gl_account_balances counts posted and reversed entries, and nothing else', async () => {
    // The reversal invariant: a reversed entry stays in the aggregation. Drop
    // it and the original disappears while its reversal remains, so the report
    // still balances — equally wrong on both sides — while being untrue.
    const [view] = await prisma.$queryRawUnsafe<Array<{ dr: string; cr: string }>>(
      `SELECT COALESCE(SUM(total_debit),0) dr, COALESCE(SUM(total_credit),0) cr
         FROM v_gl_account_balances`,
    );
    const [direct] = await prisma.$queryRawUnsafe<Array<{ dr: string; cr: string }>>(
      `SELECT COALESCE(SUM(l.debit),0) dr, COALESCE(SUM(l.credit),0) cr
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l."entryId"
        WHERE e.status IN ('POSTED','REVERSED')`,
    );
    expect(Number(view.dr)).toBe(Number(direct.dr));
    expect(Number(view.cr)).toBe(Number(direct.cr));
  });

  it('every account appears, including those with no postings', async () => {
    // The status filter lives in a subquery precisely so the LEFT JOIN still
    // yields a row for an account that has never been posted to. Moving it back
    // into the join would quietly drop those accounts from the trial balance.
    const [{ accounts }] = await prisma.$queryRawUnsafe<Array<{ accounts: bigint }>>(
      `SELECT COUNT(*)::bigint accounts FROM accounts`,
    );
    const [{ rows }] = await prisma.$queryRawUnsafe<Array<{ rows: bigint }>>(
      `SELECT COUNT(*)::bigint rows FROM v_gl_account_balances`,
    );
    expect(Number(rows)).toBe(Number(accounts));
  });
});
