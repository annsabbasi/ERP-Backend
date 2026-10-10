import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingTemplatesService, spreadByPercentage } from './setup.services';

/**
 * Posting templates store percentages, not amounts. These prove the split a
 * journal entry is built from always balances to the cent, and the rules the
 * service applies around it. Prisma and AccountsService are mocked.
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const COMPANY_ID = 'company-1';

const sum = (rows: { amount: Prisma.Decimal; side: string }[], side: string) =>
  rows
    .filter((r) => r.side === side)
    .reduce((s, r) => s.plus(r.amount), D(0))
    .toFixed(2);

describe('spreadByPercentage', () => {
  it('splits the worked example exactly', () => {
    const rows = spreadByPercentage(D(120000), [
      { side: 'debit', percentage: 50 },
      { side: 'debit', percentage: 30 },
      { side: 'debit', percentage: 20 },
      { side: 'credit', percentage: 100 },
    ]);
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual([
      '60000.00',
      '36000.00',
      '24000.00',
      '120000.00',
    ]);
  });

  it('gives the rounding leftover to the last line so each side totals the amount', () => {
    const rows = spreadByPercentage(D(100), [
      { side: 'debit', percentage: '33.3333' },
      { side: 'debit', percentage: '33.3333' },
      { side: 'debit', percentage: '33.3334' },
      { side: 'credit', percentage: 100 },
    ]);
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual([
      '33.33',
      '33.33',
      '33.34',
      '100.00',
    ]);
    expect(sum(rows, 'debit')).toBe('100.00');
    expect(sum(rows, 'credit')).toBe('100.00');
  });

  it('balances for awkward amounts', () => {
    for (const amount of ['0.07', '1.01', '999.99', '12345.67']) {
      const rows = spreadByPercentage(D(amount), [
        { side: 'debit', percentage: '12.5' },
        { side: 'debit', percentage: '37.5' },
        { side: 'debit', percentage: 50 },
        { side: 'credit', percentage: 60 },
        { side: 'credit', percentage: 40 },
      ]);
      expect(sum(rows, 'debit')).toBe(D(amount).toFixed(2));
      expect(sum(rows, 'credit')).toBe(D(amount).toFixed(2));
    }
  });

  it('refuses an amount too small to give every line a value', () => {
    expect(() =>
      spreadByPercentage(D('0.01'), [
        { side: 'debit', percentage: 50 },
        { side: 'debit', percentage: 50 },
        { side: 'credit', percentage: 100 },
      ]),
    ).toThrow(BadRequestException);
  });
});

function makeService(
  opts: { template?: Record<string, unknown> | null; usedBy?: number } = {},
) {
  const template =
    opts.template === undefined
      ? {
          id: 'tpl-1',
          companyId: COMPANY_ID,
          code: 'UTIL01',
          description: 'Utilities split',
          isActive: true,
          lines: [
            {
              accountId: 'acc-admin',
              account: { id: 'acc-admin', code: '6100', name: 'Admin' },
              description: null,
              percentage: D(50),
              side: 'debit',
              ordering: 0,
            },
            {
              accountId: 'acc-prod',
              account: { id: 'acc-prod', code: '6200', name: 'Production' },
              description: null,
              percentage: D(50),
              side: 'debit',
              ordering: 1,
            },
            {
              accountId: 'acc-bank',
              account: { id: 'acc-bank', code: '1110', name: 'Bank' },
              description: null,
              percentage: D(100),
              side: 'credit',
              ordering: 2,
            },
          ],
        }
      : opts.template;
  const prisma = {
    postingTemplate: {
      findFirst: jest.fn().mockResolvedValue(template),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'tpl-new', ...data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
    journalEntry: { count: jest.fn().mockResolvedValue(opts.usedBy ?? 0) },
  };
  const accounts = {
    assertPostableMany: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new PostingTemplatesService(
    prisma as never,
    accounts as never,
  );
  return { service, prisma, accounts };
}

describe('PostingTemplatesService', () => {
  const validLines = [
    { accountId: 'acc-admin', percentage: 60, side: 'debit' },
    { accountId: 'acc-prod', percentage: 40, side: 'debit' },
    { accountId: 'acc-bank', percentage: 100, side: 'credit' },
  ];

  it('apply returns balanced journal-entry lines', async () => {
    const { service } = makeService();
    const res = await service.apply(COMPANY_ID, 'tpl-1', 1000.01);
    expect(res.amount).toBe('1000.01');
    expect(res.lines.map((l) => [l.debit, l.credit])).toEqual([
      ['500.01', '0.00'],
      ['500.00', '0.00'],
      ['0.00', '1000.01'],
    ]);
  });

  it('apply refuses an inactive template', async () => {
    const { service } = makeService({
      template: { id: 'tpl-1', code: 'OLD', isActive: false, lines: [] },
    });
    await expect(service.apply(COMPANY_ID, 'tpl-1', 100)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create checks the accounts are postable in this company', async () => {
    const { service, accounts } = makeService();
    await service.create(COMPANY_ID, {
      code: 'T1',
      description: 'x',
      lines: validLines,
    });
    expect(accounts.assertPostableMany).toHaveBeenCalledWith(COMPANY_ID, [
      'acc-admin',
      'acc-prod',
      'acc-bank',
    ]);
  });

  it('create rejects percentages that do not total 100 per side', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create(COMPANY_ID, {
        code: 'T1',
        description: 'x',
        lines: [...validLines.slice(0, 1), validLines[2]],
      }),
    ).rejects.toThrow(/Debit percentages total 60%/);
    expect(prisma.postingTemplate.create).not.toHaveBeenCalled();
  });

  it('create rejects a zero-percent line', async () => {
    const { service } = makeService();
    await expect(
      service.create(COMPANY_ID, {
        code: 'T1',
        description: 'x',
        lines: [
          ...validLines,
          { accountId: 'a', percentage: 0, side: 'credit' },
        ],
      }),
    ).rejects.toThrow(/above 0/);
  });

  it('remove refuses a template that journal entries were built from', async () => {
    const { service, prisma } = makeService({ usedBy: 2 });
    await expect(service.remove(COMPANY_ID, 'tpl-1')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.postingTemplate.delete).not.toHaveBeenCalled();
  });

  it('remove deletes an unused template', async () => {
    const { service, prisma } = makeService({ usedBy: 0 });
    await service.remove(COMPANY_ID, 'tpl-1');
    expect(prisma.postingTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
    });
  });
});
