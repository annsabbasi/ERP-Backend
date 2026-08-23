import { PrismaClient } from '@prisma/client';
import {
  assertLedgerConsistent,
  balance,
  bootstrap,
  cleanupDocuments,
  Harness,
  tradingPartners,
} from './harness';

/**
 * A/R and A/P end to end, over HTTP so the guards, validation and posting path
 * are all in the loop.
 *
 * The point these assertions keep returning to: the subledgers have exactly one
 * route to the ledger. Everything they do has to be visible in the general
 * ledger and has to obey the same rules a hand-keyed journal obeys.
 */
describe('A/R and A/P', () => {
  let h: Harness;
  let prisma: PrismaClient;
  let customer: { id: string }, vendor: { id: string };
  const arInvoices: string[] = [];
  const apBills: string[] = [];

  beforeAll(async () => {
    h = await bootstrap();
    prisma = h.prisma;
    ({ customer, vendor } = await tradingPartners(prisma, h.companyId));
  });

  afterAll(async () => {
    await cleanupDocuments(prisma, h.companyId, { arInvoices, apBills });
    await assertLedgerConsistent(prisma, h.companyId);
    await h.close();
  });

  const newInvoice = async (lines: unknown[]) => {
    const res = await h.api('post', '/financials/ar-invoices', {
      bpId: customer.id, issueDate: '2026-08-24', lines });
    if (res.status < 300) arInvoices.push(res.body.id);
    return res;
  };

  it('computes totals from the lines rather than trusting the payload', async () => {
    const res = await newInvoice([
      { description: 'Consulting', quantity: 2, unitPrice: 500, taxPercent: 10 },
      { description: 'Licence', quantity: 1, unitPrice: 500 },
    ]);
    expect(res.status).toBeLessThan(300);
    expect(Number(res.body.subtotal)).toBe(1500);
    expect(Number(res.body.tax)).toBe(100);
    expect(Number(res.body.total)).toBe(1600);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.journalEntryId).toBeFalsy();
  });

  it('issues to the ledger, on both sides, carrying the partner', async () => {
    const before = {
      ar: await balance(prisma, h.companyId, '1100'),
      revenue: await balance(prisma, h.companyId, '4000'),
      tax: await balance(prisma, h.companyId, '2100'),
    };
    const inv = (await newInvoice([
      { description: 'Consulting', quantity: 2, unitPrice: 500, taxPercent: 10 },
    ])).body;
    const posted = (await h.api('post', `/financials/ar-invoices/${inv.id}/post`)).body;

    expect(posted.status).toBe('ISSUED');
    expect(posted.journalEntryId).toBeTruthy();
    expect(await balance(prisma, h.companyId, '1100')).toBe(before.ar + 1100);
    expect(await balance(prisma, h.companyId, '4000')).toBe(before.revenue + 1000);
    expect(await balance(prisma, h.companyId, '2100')).toBe(before.tax + 100);

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: posted.journalEntryId }, include: { lines: true } });
    expect(entry.status).toBe('POSTED');
    expect(entry.totalDebit.equals(entry.totalCredit)).toBe(true);
    expect(entry.source).toBe('ar_invoice');
    // Without the partner on the control-account line the subledger stops
    // reconciling to the GL, which is why postFromSource validates lines.
    expect(entry.lines.some((l) => l.bpId === customer.id)).toBe(true);
  });

  it('refuses to edit an issued invoice, and its journal stays immutable', async () => {
    const inv = (await newInvoice([{ description: 'Fixed', unitPrice: 100 }])).body;
    const posted = (await h.api('post', `/financials/ar-invoices/${inv.id}/post`)).body;

    const edit = await h.api('put', `/financials/ar-invoices/${inv.id}`, { notes: 'changed' });
    expect(edit.status).toBeGreaterThanOrEqual(400);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE journal_entries SET "totalDebit"=1 WHERE id = $1`, posted.journalEntryId),
    ).rejects.toThrow();
  });

  it('settles in parts, refuses an overpayment, and closes on the balance', async () => {
    const inv = (await newInvoice([{ description: 'Settle me', unitPrice: 1000 }])).body;
    await h.api('post', `/financials/ar-invoices/${inv.id}/post`);
    const cashBefore = await balance(prisma, h.companyId, '1000');

    const part = await h.api('post', `/financials/ar-invoices/${inv.id}/payments`, { amount: 600 });
    expect(part.body.status).toBe('PARTIALLY_PAID');
    expect(await balance(prisma, h.companyId, '1000')).toBe(cashBefore + 600);

    const over = await h.api('post', `/financials/ar-invoices/${inv.id}/payments`, { amount: 400.01 });
    expect(over.status).toBeGreaterThanOrEqual(400);

    const rest = await h.api('post', `/financials/ar-invoices/${inv.id}/payments`, { amount: 400 });
    expect(rest.body.status).toBe('PAID');
  });

  it('voids by reversing, leaving the original posting in place', async () => {
    const inv = (await newInvoice([{ description: 'To void', unitPrice: 250 }])).body;
    const posted = (await h.api('post', `/financials/ar-invoices/${inv.id}/post`)).body;
    const arBefore = await balance(prisma, h.companyId, '1100');

    const voided = await h.api('post', `/financials/ar-invoices/${inv.id}/void`, { reason: 'cancelled' });
    expect(voided.body.status).toBe('VOID');

    const original = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: posted.journalEntryId }, include: { reversal: true } });
    expect(original.status).toBe('REVERSED');
    expect(original.reversal).toBeTruthy();
    expect(await balance(prisma, h.companyId, '1100')).toBe(arBefore - 250);
  });

  it('refuses to void an invoice that has payments against it', async () => {
    const inv = (await newInvoice([{ description: 'Paid', unitPrice: 100 }])).body;
    await h.api('post', `/financials/ar-invoices/${inv.id}/post`);
    await h.api('post', `/financials/ar-invoices/${inv.id}/payments`, { amount: 100 });

    const res = await h.api('post', `/financials/ar-invoices/${inv.id}/void`, {});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to invoice a vendor', async () => {
    const res = await h.api('post', '/financials/ar-invoices', {
      bpId: vendor.id, issueDate: '2026-08-24', lines: [{ description: 'x', unitPrice: 1 }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  describe('W5 — an order can only be invoiced once it has a customer', () => {
    it('refuses an order with no customer, and one belonging to someone else', async () => {
      const orphan = await prisma.order.create({ data: { companyId: h.companyId, total: 100 } });
      const other = await prisma.businessPartner.create({
        data: { companyId: h.companyId, cardCode: `CT${Date.now()}`,
                cardName: 'Someone Else', cardType: 'CUSTOMER' } });
      const theirs = await prisma.order.create({
        data: { companyId: h.companyId, bpId: other.id, total: 100 } });
      try {
        const noCustomer = await h.api('post', '/financials/ar-invoices', {
          bpId: customer.id, issueDate: '2026-08-24', orderId: orphan.id,
          lines: [{ description: 'x', unitPrice: 1 }] });
        expect(noCustomer.status).toBeGreaterThanOrEqual(400);
        expect(JSON.stringify(noCustomer.body)).toMatch(/no customer/i);

        const wrongCustomer = await h.api('post', '/financials/ar-invoices', {
          bpId: customer.id, issueDate: '2026-08-24', orderId: theirs.id,
          lines: [{ description: 'x', unitPrice: 1 }] });
        expect(wrongCustomer.status).toBeGreaterThanOrEqual(400);
      } finally {
        await prisma.order.deleteMany({ where: { id: { in: [orphan.id, theirs.id] } } });
        await prisma.businessPartner.delete({ where: { id: other.id } });
      }
    });

    it('accepts an order whose customer matches the invoice', async () => {
      const order = await prisma.order.create({
        data: { companyId: h.companyId, bpId: customer.id, total: 100 } });
      const res = await h.api('post', '/financials/ar-invoices', {
        bpId: customer.id, issueDate: '2026-08-24', orderId: order.id,
        lines: [{ description: 'From order', unitPrice: 100 }] });
      if (res.status < 300) arInvoices.push(res.body.id);
      expect(res.status).toBeLessThan(300);
      expect(res.body.orderId).toBe(order.id);
      await cleanupDocuments(prisma, h.companyId, { arInvoices: [res.body.id] });
      arInvoices.splice(arInvoices.indexOf(res.body.id), 1);
      await prisma.order.delete({ where: { id: order.id } });
    });
  });

  describe('A/P mirrors it', () => {
    it('approves to the ledger and pays down the control account', async () => {
      const before = {
        ap: await balance(prisma, h.companyId, '2000'),
        expense: await balance(prisma, h.companyId, '5000'),
        tax: await balance(prisma, h.companyId, '1200'),
      };
      const created = await h.api('post', '/financials/ap-bills', {
        bpId: vendor.id, number: `VEND-${Date.now()}`, issueDate: '2026-08-24',
        lines: [{ description: 'Hosting', quantity: 1, unitPrice: 800, taxPercent: 10 }] });
      expect(created.status).toBeLessThan(300);
      apBills.push(created.body.id);
      expect(Number(created.body.total)).toBe(880);

      const approved = await h.api('post', `/financials/ap-bills/${created.body.id}/post`);
      expect(approved.body.status).toBe('APPROVED');
      expect(await balance(prisma, h.companyId, '2000')).toBe(before.ap + 880);
      expect(await balance(prisma, h.companyId, '5000')).toBe(before.expense + 800);
      expect(await balance(prisma, h.companyId, '1200')).toBe(before.tax + 80);

      const paid = await h.api('post', `/financials/ap-bills/${created.body.id}/payments`, { amount: 880 });
      expect(paid.body.status).toBe('PAID');
      expect(await balance(prisma, h.companyId, '2000')).toBe(before.ap);
    });
  });
});
