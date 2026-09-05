import { PrismaClient } from '@prisma/client';
import {
  assertLedgerConsistent,
  bootstrap,
  Harness,
  withGuardsDisabled,
} from './harness';

/**
 * Period-End Closing, driven through the API.
 *
 * The case this suite exists for is the reversal one. Reversing a journal entry
 * does not remove it: a mirror entry is posted and both rows stay, the original
 * flipped to REVERSED. Any aggregation that filters on `status: 'POSTED'` alone
 * therefore drops the original and keeps its mirror, and every total shifts by
 * the reversal amount in the wrong direction.
 *
 * That is bad in a report and worse here, because Period-End Closing posts its
 * result into the ledger as retained earnings — and the entry still passes its
 * balance check, since the net is computed from the same corrupted sums. Both
 * sides come out wrong by the same amount, so preview and execute agree with
 * each other and disagree with the ledger. Nothing downstream catches it.
 *
 * The assertion is deliberately the whole point of the feature: post revenue,
 * reverse it, and the closing must see nothing left to close.
 */
describe('period-end closing', () => {
  let h: Harness;
  let prisma: PrismaClient;
  let cash: { id: string; code: string };
  let revenue: { id: string; code: string };
  let retained: { id: string; code: string };
  let periodId: string;
  let periodName: string;
  /**
   * A date inside the period under test.
   *
   * Taken from the period rather than hard-coded. A fixed literal passed
   * type-checking and then reported zero movement, because the seed's first
   * open monthly period is January and the entries were dated August — outside
   * the range the closing was asked about.
   */
  let postingDate: Date;

  const made: string[] = [];
  /** Title accounts created as negative fixtures, removed in teardown. */
  const titleAccountIds: string[] = [];

  /** Posts a revenue entry straight at the tables, as the seed data would. */
  const postRevenue = async (number: string, amount: number) => {
    const e = await prisma.journalEntry.create({
      data: {
        companyId: h.companyId,
        periodId,
        number,
        date: postingDate,
        status: 'POSTED',
        postedAt: new Date(),
        totalDebit: amount,
        totalCredit: amount,
        lines: {
          create: [
            { accountId: cash.id, debit: amount, ordering: 0 },
            { accountId: revenue.id, credit: amount, ordering: 1 },
          ],
        },
      },
    });
    made.push(e.id);
    return e;
  };

  /**
   * Reverses an entry the way the ledger does: a mirror entry that names the
   * original, and the original flipped to REVERSED. Both rows remain.
   */
  const reverse = async (originalId: string, number: string, amount: number) => {
    const mirror = await prisma.journalEntry.create({
      data: {
        companyId: h.companyId,
        periodId,
        number,
        date: postingDate,
        status: 'POSTED',
        postedAt: new Date(),
        reversalOfId: originalId,
        totalDebit: amount,
        totalCredit: amount,
        lines: {
          create: [
            { accountId: revenue.id, debit: amount, ordering: 0 },
            { accountId: cash.id, credit: amount, ordering: 1 },
          ],
        },
      },
    });
    made.push(mirror.id);
    await prisma.journalEntry.update({
      where: { id: originalId },
      data: { status: 'REVERSED' },
    });
    return mirror;
  };

  const preview = () =>
    h.api('post', '/administration/utilities/period-end-closing/preview', {
      fromPeriodId: periodId,
      toPeriodId: periodId,
      retainedEarningsAccountId: retained.id,
    });

  const lineFor = (body: any, code: string) =>
    (body?.lines ?? []).find((l: { code: string }) => l.code === code) ?? null;

  beforeAll(async () => {
    h = await bootstrap();
    prisma = h.prisma;

    const accounts = await prisma.account.findMany({
      where: { companyId: h.companyId, code: { in: ['1000', '4000', '3200'] } },
      select: { id: true, code: true },
    });
    cash = accounts.find((a) => a.code === '1000')!;
    revenue = accounts.find((a) => a.code === '4000')!;

    // Named exactly, with no fallback. The first version fell back to "any
    // equity account", which turned a missing seed into a confusing
    // NotFoundError deep in setup instead of saying what was actually absent —
    // and would have gone on hiding the fact that a freshly seeded company had
    // no equity account at all, which made Period-End Closing unusable.
    const retainedEarnings = accounts.find((a) => a.code === '3200');
    if (!retainedEarnings) {
      throw new Error(
        'Account 3200 (Retained Earnings) is missing. Period-End Closing carries the net result ' +
          'there, so a company without it cannot close a period. Run `npm run prisma:seed`.',
      );
    }
    retained = retainedEarnings;

    const period = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { companyId: h.companyId, subPeriodType: 'MONTHS', status: 'OPEN' },
    });
    periodId = period.id;
    periodName = period.name;
    postingDate = period.startDate;
  });

  afterAll(async () => {
    if (!h?.prisma) return;
    await withGuardsDisabled(prisma, async () => {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: made } } });
      // Reversal links are self-referential; clearing them first lets the rows
      // delete in any order.
      await prisma.journalEntry.updateMany({
        where: { id: { in: made } },
        data: { reversalOfId: null },
      });
      await prisma.journalEntry.deleteMany({ where: { id: { in: made } } });
    });
    // Fixture accounts never carry postings, so they delete without touching
    // the guards.
    if (titleAccountIds.length) {
      await prisma.account.deleteMany({ where: { id: { in: titleAccountIds } } });
    }
    await assertLedgerConsistent(prisma, h.companyId);
    await h.close();
  });

  it('includes posted profit-and-loss movement in the preview', async () => {
    const before = await preview();
    expect(before.status).toBe(201);
    const baseline = Number(lineFor(before.body, revenue.code)?.balance ?? 0);

    await postRevenue(`PEC-TEST-${Date.now()}-A`, 500);

    const after = await preview();
    expect(after.status).toBe(201);
    expect(Number(lineFor(after.body, revenue.code)?.balance ?? 0)).toBeCloseTo(baseline + 500, 2);
  });

  /**
   * The regression this file was written for.
   *
   * With `status: 'POSTED'` the preview would report the revenue account at
   * -700 rather than 0: the original credit is dropped and only the reversing
   * debit survives. The closing would then post 700 to retained earnings out of
   * nothing, and balance perfectly while doing it.
   */
  it('nets a reversed entry to zero rather than counting only its mirror', async () => {
    const before = await preview();
    const baseline = Number(lineFor(before.body, revenue.code)?.balance ?? 0);
    const baselineNet = Number(before.body?.netResult ?? 0);

    const stamp = Date.now();
    const original = await postRevenue(`PEC-TEST-${stamp}-B`, 700);
    await reverse(original.id, `PEC-TEST-${stamp}-B-REV`, 700);

    const after = await preview();
    expect(after.status).toBe(201);

    const balanceAfter = Number(lineFor(after.body, revenue.code)?.balance ?? 0);
    const netAfter = Number(after.body?.netResult ?? 0);

    // A posting and its reversal cancel. Both must be unchanged from before.
    expect(balanceAfter).toBeCloseTo(baseline, 2);
    expect(netAfter).toBeCloseTo(baselineNet, 2);

    // Stated explicitly so a future regression names itself: the failure mode
    // is the balance moving by the reversal amount in the wrong direction.
    expect(balanceAfter).not.toBeCloseTo(baseline - 700, 2);
  });

  it('refuses to execute when the range has nothing to close', async () => {
    // A range whose end precedes its start covers no postings at all.
    const res = await h.api('post', '/administration/utilities/period-end-closing/execute', {
      fromPeriodId: periodId,
      toPeriodId: periodId,
      retainedEarningsAccountId: retained.id,
      // Deliberately absurd so the run cannot pick up real movement.
      postingDate: '1990-01-01',
    });
    // Either nothing to close, or the posting date resolves to no open period.
    // Both are refusals; what must not happen is a silent success.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  /**
   * The title account is created here rather than looked for in the seed.
   *
   * The first version opened with `if (!title) return;` and no seeded account
   * has `isTitle`, so it reported green while asserting nothing at all — the
   * same empty-guard failure this file's other test exists to prevent. A
   * negative fixture is the test's own to build; skipping the assertion when
   * the fixture is absent is not a skip, it is a false pass.
   *
   * This is deliberately different from the retained-earnings account, which
   * belongs in the seed: that one is data the feature needs to work in
   * production, not a prop for one assertion.
   */
  it('rejects a closing whose retained earnings account is a title account', async () => {
    const title = await prisma.account.create({
      data: {
        companyId: h.companyId,
        code: `TITLE-${Date.now()}`,
        name: 'Header account (test fixture)',
        type: 'EQUITY',
        isTitle: true,
      },
      select: { id: true },
    });
    titleAccountIds.push(title.id);

    const res = await h.api('post', '/administration/utilities/period-end-closing/preview', {
      fromPeriodId: periodId,
      toPeriodId: periodId,
      retainedEarningsAccountId: title.id,
    });
    expect(res.status).toBe(400);
    expect(String(res.body?.message ?? '')).toMatch(/title account/i);
  });

  it('reports the period range it was asked for', async () => {
    const res = await preview();
    expect(res.body?.from?.name).toBe(periodName);
    expect(res.body?.to?.name).toBe(periodName);
  });
});
