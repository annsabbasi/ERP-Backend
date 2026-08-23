import { PrismaClient } from '@prisma/client';
import {
  assertLedgerConsistent,
  balance,
  bootstrap,
  Harness,
  withGuardsDisabled,
} from './harness';

/**
 * The posting invariants (V1–V5), driven the way an attacker or a bug would
 * drive them: raw SQL straight at the tables, going around the service layer.
 * Anything that only holds because the application remembers to check it is
 * not an invariant.
 */
describe('ledger invariants', () => {
  let h: Harness;
  let prisma: PrismaClient;
  let cash: { id: string }, revenue: { id: string }, periodId: string;
  const made: string[] = [];

  const makeEntry = async (number: string, status: 'DRAFT' | 'POSTED', amount = 1000) => {
    const e = await prisma.journalEntry.create({
      data: {
        companyId: h.companyId,
        periodId,
        number,
        date: new Date('2026-08-24'),
        status,
        ...(status === 'POSTED' ? { postedAt: new Date() } : {}),
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

  beforeAll(async () => {
    h = await bootstrap();
    prisma = h.prisma;
    const accounts = await prisma.account.findMany({
      where: { companyId: h.companyId, code: { in: ['1000', '4000'] } },
      orderBy: { code: 'asc' },
    });
    [cash, revenue] = accounts;
    const period = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { companyId: h.companyId, subPeriodType: 'MONTHS', status: 'OPEN' },
    });
    periodId = period.id;
  });

  afterAll(async () => {
    await withGuardsDisabled(prisma, async () => {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: made } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: made } } });
    });
    await assertLedgerConsistent(prisma, h.companyId);
    await h.close();
  });

  describe('V1 — drafts stay out of the ledger', () => {
    it('a draft does not move a balance, and posting it does', async () => {
      const before = await balance(prisma, h.companyId, '1000');
      const draft = await makeEntry('INV-V1', 'DRAFT');
      expect(await balance(prisma, h.companyId, '1000')).toBe(before);

      await prisma.journalEntry.update({
        where: { id: draft.id },
        data: { status: 'POSTED', postedAt: new Date() },
      });
      expect(await balance(prisma, h.companyId, '1000')).toBe(before + 1000);
    });
  });

  describe('V2 — a posted entry keeps agreeing with its lines', () => {
    it('refuses a line inserted into a posted entry', async () => {
      const e = await makeEntry('INV-V2', 'POSTED');
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO journal_lines ("id","companyId","entryId","accountId","debit","credit","ordering")
           VALUES (gen_random_uuid(), $1, $2, $3, 777, 0, 9)`,
          h.companyId,
          e.id,
          cash.id,
        ),
      ).rejects.toThrow();
      expect(await prisma.journalLine.count({ where: { entryId: e.id } })).toBe(2);
    });

    it('still allows a legitimate posting, header and lines written together', async () => {
      await expect(makeEntry('INV-V2-OK', 'POSTED')).resolves.toBeDefined();
    });
  });

  describe('V3 — posted and reversed entries are immutable', () => {
    it('refuses to rewrite a reversed total or send it back to draft', async () => {
      const e = await makeEntry('INV-V3', 'POSTED');
      await prisma.$executeRawUnsafe(
        `UPDATE journal_entries SET status='REVERSED' WHERE id = $1`, e.id);

      await expect(
        prisma.$executeRawUnsafe(`UPDATE journal_entries SET "totalDebit"=9 WHERE id = $1`, e.id),
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(`UPDATE journal_entries SET status='DRAFT' WHERE id = $1`, e.id),
      ).rejects.toThrow();
    });

    it('permits the one legal transition, POSTED to REVERSED', async () => {
      const e = await makeEntry('INV-V3-OK', 'POSTED');
      await expect(
        prisma.$executeRawUnsafe(`UPDATE journal_entries SET status='REVERSED' WHERE id = $1`, e.id),
      ).resolves.toBeDefined();
    });
  });

  describe('V4 — lines cannot be moved between entries', () => {
    it('refuses to move a line off a posted entry', async () => {
      const posted = await makeEntry('INV-V4', 'POSTED');
      const destination = await makeEntry('INV-V4-DEST', 'DRAFT');
      const victim = await prisma.journalLine.findFirstOrThrow({ where: { entryId: posted.id } });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE journal_lines SET "entryId" = $1 WHERE id = $2`, destination.id, victim.id),
      ).rejects.toThrow();
    });
  });

  describe('V5 — foreign keys are tenant-scoped', () => {
    it('refuses a line pointing at another company account or entry', async () => {
      const other = await prisma.company.create({
        data: { name: 'FK Probe Co', slug: `fk-probe-${Date.now()}` } });
      try {
        await prisma.currency.create({ data: { companyId: other.id, code: 'USD', name: 'US Dollar' } });
        const foreign = await prisma.account.create({
          data: { companyId: other.id, code: '9999', name: 'Foreign', type: 'ASSET' } });
        const mine = await makeEntry('INV-V5', 'DRAFT');
        const insert = (companyId: string, accountId: string) =>
          prisma.$executeRawUnsafe(
            `INSERT INTO journal_lines ("id","companyId","entryId","accountId","debit","credit","ordering")
             VALUES (gen_random_uuid(), $1, $2, $3, 5, 0, 9)`,
            companyId, mine.id, accountId);

        await expect(insert(h.companyId, foreign.id)).rejects.toThrow();
        await expect(insert(other.id, foreign.id)).rejects.toThrow();
      } finally {
        await prisma.company.delete({ where: { id: other.id } });
      }
    });

    it('leaves optional parents optional', async () => {
      const e = await makeEntry('INV-V5-OPT', 'DRAFT');
      // MATCH SIMPLE: a NULL in any column skips the check, so a line with no
      // cost center is unaffected by the composite key.
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO journal_lines
             ("id","companyId","entryId","accountId","debit","credit","ordering","costCenterId")
           VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 9, NULL)`,
          h.companyId, e.id, cash.id),
      ).resolves.toBeDefined();
    });

    it('every line carries the company of its entry', async () => {
      const [{ mismatched }] = await prisma.$queryRawUnsafe<Array<{ mismatched: bigint }>>(
        `SELECT COUNT(*)::bigint mismatched FROM journal_lines l
           JOIN journal_entries e ON e.id = l."entryId"
          WHERE l."companyId" <> e."companyId"`);
      expect(Number(mismatched)).toBe(0);
    });
  });
});
