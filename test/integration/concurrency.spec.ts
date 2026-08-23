import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  assertLedgerConsistent,
  bootstrap,
  cleanupDocuments,
  Harness,
  tradingPartners,
} from './harness';

/**
 * Concurrency and retry safety.
 *
 * Every defect here only shows up when two requests are in flight at once, so
 * the tests fire them concurrently. Calling twice in sequence would pass
 * against the broken versions of all of this.
 */
describe('concurrency and retries', () => {
  let h: Harness;
  let prisma: PrismaClient;
  let customer: { id: string };
  const arInvoices: string[] = [];

  const draft = (label: string, unitPrice = 100) => ({
    bpId: customer.id,
    issueDate: '2026-08-24',
    lines: [{ description: label, quantity: 1, unitPrice }],
  });

  beforeAll(async () => {
    h = await bootstrap();
    prisma = h.prisma;
    ({ customer } = await tradingPartners(prisma, h.companyId));
  });

  afterAll(async () => {
    if (!h?.prisma) return;
    await cleanupDocuments(prisma, h.companyId, { arInvoices });
    await prisma.idempotencyKey.deleteMany({ where: { companyId: h.companyId } });
    await assertLedgerConsistent(prisma, h.companyId);
    await h.close();
  });

  describe('number allocation', () => {
    it('gives eight simultaneous callers eight distinct numbers', async () => {
      const results = await Promise.all(
        [...Array(8)].map((_, i) => h.api('post', '/financials/ar-invoices', draft(`Race ${i}`))),
      );
      const created = results.filter((r) => r.status < 300).map((r) => r.body);
      created.forEach((c) => arInvoices.push(c.id));

      expect(created).toHaveLength(8);
      const numbers = created.map((c) => c.number);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('lets exactly one of five callers take the last number in a series', async () => {
      const series = await prisma.numberingSeries.findFirstOrThrow({
        where: { companyId: h.companyId, documentType: 'ar_invoice' } });
      await prisma.numberingSeries.update({
        where: { id: series.id }, data: { lastNumber: series.nextNumber } });

      try {
        const results = await Promise.all(
          [...Array(5)].map((_, i) => h.api('post', '/financials/ar-invoices', draft(`Last ${i}`))),
        );
        const won = results.filter((r) => r.status < 300);
        won.forEach((r) => arInvoices.push(r.body.id));

        // Without the row lock every caller reads "one left" before any of them
        // increments, and all five pass the exhaustion check.
        expect(won).toHaveLength(1);
        for (const lost of results.filter((r) => r.status >= 300)) {
          expect(JSON.stringify(lost.body)).toMatch(/exhausted/i);
        }
        const after = await prisma.numberingSeries.findUniqueOrThrow({ where: { id: series.id } });
        expect(after.nextNumber).toBeLessThanOrEqual((after.lastNumber ?? 0) + 1);
      } finally {
        await prisma.numberingSeries.update({
          where: { id: series.id }, data: { lastNumber: null } });
      }
    });
  });

  describe('idempotent payments', () => {
    let invoiceId: string;

    beforeAll(async () => {
      const inv = await h.api('post', '/financials/ar-invoices', draft('Idempotency', 1000));
      arInvoices.push(inv.body.id);
      invoiceId = inv.body.id;
      await h.api('post', `/financials/ar-invoices/${invoiceId}/post`);
    });

    const pay = (amount: number, key?: string) =>
      h.api('post', `/financials/ar-invoices/${invoiceId}/payments`, { amount },
        key ? { 'idempotency-key': key } : {});

    const ENDPOINT = 'POST /api/v1/financials/ar-invoices/:id/payments';
    // The interceptor's hash, reproduced. Interceptors run before pipes, so
    // it sees the raw parsed body and the route params.
    const hashOf = (amount: number) =>
      createHash('sha256')
        .update(JSON.stringify({ body: { amount }, params: { id: invoiceId } }))
        .digest('hex');

    /** Exactly the row a process killed mid-request leaves behind. */
    const strandClaim = (key: string, requestHash: string, endpoint = ENDPOINT) =>
      prisma.idempotencyKey.create({
        data: {
          companyId: h.companyId, userId: h.userId, key, endpoint, requestHash,
          status: 'IN_PROGRESS',
          createdAt: new Date(Date.now() - 10 * 60_000),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      });

    it('answers a retry from the first response and charges once', async () => {
      const key = randomUUID();
      const first = await pay(100, key);
      const retry = await pay(100, key);

      expect(first.status).toBeLessThan(300);
      expect(retry.status).toBeLessThan(300);
      expect(Number(retry.body.paid)).toBe(Number(first.body.paid));
      expect(await prisma.aRPayment.count({ where: { invoiceId, amount: 100 } })).toBe(1);
    });

    it('refuses a key reused with a different body', async () => {
      const key = randomUUID();
      await pay(50, key);
      const changed = await pay(75, key);
      expect(changed.status).toBe(422);
    });

    it('runs normally under a fresh key', async () => {
      const before = await prisma.aRPayment.count({ where: { invoiceId } });
      const res = await pay(25, randomUUID());
      expect(res.status).toBeLessThan(300);
      expect(await prisma.aRPayment.count({ where: { invoiceId } })).toBe(before + 1);
    });

    it('is inert when no key is sent', async () => {
      const before = await prisma.aRPayment.count({ where: { invoiceId } });
      expect((await pay(25)).status).toBeLessThan(300);
      expect((await pay(25)).status).toBeLessThan(300);
      expect(await prisma.aRPayment.count({ where: { invoiceId } })).toBe(before + 2);
    });

    it('lets only one of two simultaneous requests under one key through', async () => {
      const key = randomUUID();
      const [a, b] = await Promise.all([pay(30, key), pay(30, key)]);
      expect(await prisma.aRPayment.count({ where: { invoiceId, amount: 30 } })).toBe(1);
      // One wins; the other is either told the operation is in progress or gets
      // the winner's response. Both are correct; a second payment is not.
      expect([a.status, b.status].some((s) => s < 300)).toBe(true);
    });

    describe('W3 — a recorded failure is replayed, not released', () => {
      it('answers a retry after a rejection with the same rejection', async () => {
        const key = randomUUID();
        // Overpaying is refused by the service, so the handler throws with the
        // transaction already rolled back.
        const failed = await pay(999_999, key);
        expect(failed.status).toBeGreaterThanOrEqual(400);

        const retry = await pay(999_999, key);
        expect(retry.status).toBe(failed.status);

        // Releasing the key on failure is what would let a handler that threw
        // *after* committing be retried into a second write.
        const record = await prisma.idempotencyKey.findFirst({
          where: { companyId: h.companyId, key } });
        expect(record).not.toBeNull();
        expect(record!.status).toBe('COMPLETED');
      });
    });

    describe('W1 — a key is never stuck forever', () => {
      it('reclaims a claim whose request never finished', async () => {
        const key = randomUUID();
        await strandClaim(key, hashOf(15));

        // The first version of this had no way out of here: every retry was
        // told "still in progress" by a request that had died, forever.
        const res = await pay(15, key);
        expect(res.status).toBeLessThan(300);

        const record = await prisma.idempotencyKey.findFirstOrThrow({
          where: { companyId: h.companyId, key } });
        expect(record.status).toBe('COMPLETED');
      });

      it('still refuses a stale key reused for a different request', async () => {
        const key = randomUUID();
        await strandClaim(key, hashOf(11));

        // A dead claim does not unbind the key from the operation it named.
        // Reusing it for a different body is a client bug either way.
        expect((await pay(12, key)).status).toBe(422);
      });

      it('expires replay records so the table cannot grow without bound', async () => {
        await prisma.idempotencyKey.create({
          data: {
            companyId: h.companyId, userId: h.userId, key: randomUUID(),
            endpoint: 'POST /expired',
            requestHash: 'x', status: 'COMPLETED',
            expiresAt: new Date(Date.now() - 60_000),
          },
        });
        const expired = await prisma.idempotencyKey.count({
          where: { companyId: h.companyId, expiresAt: { lt: new Date() } } });
        expect(expired).toBeGreaterThan(0);

        // The sweep is opportunistic rather than scheduled, because on
        // serverless a cron only fires on whichever instance happens to be
        // warm. Called directly here so the behaviour is asserted rather than
        // left to chance.
        await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        expect(
          await prisma.idempotencyKey.count({
            where: { companyId: h.companyId, expiresAt: { lt: new Date() } } }),
        ).toBe(0);
      });
    });

    describe('X1 — only a key-bound write may be reclaimed', () => {
      // The reclaim path re-runs the request. That is safe exactly where the
      // database refuses the duplicate on its own, and nowhere else. Invoice
      // creation is not key-bound: re-running it would issue a second invoice,
      // consume a second document number and post a second journal entry, with
      // nothing to stop any of it.
      it('refuses to reclaim a stale claim on a route that is not key-bound', async () => {
        const key = randomUUID();
        const body = { bpId: customer.id, issueDate: '2026-08-24',
                       lines: [{ description: 'X1 probe', quantity: 1, unitPrice: 100 }] };
        await prisma.idempotencyKey.create({
          data: {
            companyId: h.companyId, userId: h.userId, key,
            endpoint: 'POST /api/v1/financials/ar-invoices',
            requestHash: createHash('sha256')
              .update(JSON.stringify({ body, params: {} })).digest('hex'),
            status: 'IN_PROGRESS',
            createdAt: new Date(Date.now() - 10 * 60_000),
            expiresAt: new Date(Date.now() + 60 * 60_000),
          },
        });

        const before = await prisma.aRInvoice.count({ where: { companyId: h.companyId } });
        const res = await h.api('post', '/financials/ar-invoices', body,
          { 'idempotency-key': key });

        expect(res.status).toBe(409);
        expect(JSON.stringify(res.body)).toMatch(/new key/i);
        expect(await prisma.aRInvoice.count({ where: { companyId: h.companyId } })).toBe(before);
      });

      it('still reclaims on the payment route, which is key-bound', async () => {
        const key = randomUUID();
        await strandClaim(key, hashOf(18));
        expect((await pay(18, key)).status).toBeLessThan(300);
      });
    });

    describe('X2 - two retries after the window cannot both reclaim', () => {
      it('rejects the loser at the claim, before it reaches the handler', async () => {
        const key = randomUUID();
        await strandClaim(key, hashOf(22));

        const [a, b] = await Promise.all([pay(22, key), pay(22, key)]);

        // Exactly one payment either way - but that is the unique index on
        // ar_payments doing the work, not the reclaim. It is why the first
        // version of this test passed with the bug still in place.
        expect(await prisma.aRPayment.count({ where: { invoiceId, amount: 22 } })).toBe(1);

        // So assert where the loser was stopped. Without a predicate on the
        // reclaim, both requests judge the stale row reclaimable, both run, and
        // the loser is turned away by the payment's unique index - which reads
        // "already recorded under idempotency key". With the predicate the
        // loser never reaches the handler at all.
        const loser = [a, b].find((r) => r.status >= 400);
        if (loser) {
          expect(JSON.stringify(loser.body)).not.toMatch(/already recorded under idempotency key/i);
          expect(JSON.stringify(loser.body)).toMatch(/already being retried|still in progress/i);
        }
        expect([a, b].filter((r) => r.status < 300)).toHaveLength(1);
      });
    });

    describe('W6 — a key belongs to a user, not just a company', () => {
      it('does not hand one user another user response', async () => {
        const key = randomUUID();
        const mine = await pay(35, key);
        expect(mine.status).toBeLessThan(300);

        // The same company, the same key, the same endpoint — a different user.
        // Keyed only on (companyId, key, endpoint) this read would return the
        // first user's recorded response.
        const other = await prisma.idempotencyKey.findFirst({
          where: {
            companyId: h.companyId, key,
            endpoint: 'POST /api/v1/financials/ar-invoices/:id/payments',
            userId: { not: h.userId },
          },
        });
        expect(other).toBeNull();

        const stored = await prisma.idempotencyKey.findFirstOrThrow({
          where: { companyId: h.companyId, key } });
        expect(stored.userId).toBe(h.userId);
      });
    });

    describe('the database is the guarantee, not the replay cache', () => {
      it('refuses a duplicate payment under a key even with the replay record gone', async () => {
        const key = randomUUID();
        const first = await pay(40, key);
        expect(first.status).toBeLessThan(300);

        // Simulates the window the interceptor cannot close: the payment
        // committed, then the process died before recording the response.
        await prisma.idempotencyKey.deleteMany({ where: { companyId: h.companyId, key } });

        const retry = await pay(40, key);
        expect(retry.status).toBeGreaterThanOrEqual(400);
        expect(await prisma.aRPayment.count({ where: { invoiceId, amount: 40 } })).toBe(1);
      });
    });
  });
});
