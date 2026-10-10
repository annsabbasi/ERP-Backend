import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RECURRING_POSTING_SOURCE,
  RecurringPostingsService,
  addInterval,
} from './setup.services';

/**
 * Recurring postings post nothing on their own: executing an instance posts
 * one journal entry and moves the schedule on, together. These prove the
 * schedule arithmetic, that an instance cannot be posted twice, and the rules
 * applied when a posting is saved. Prisma, AccountsService and
 * JournalEntriesService are mocked.
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const COMPANY_ID = 'company-1';
const USER_ID = 'user-1';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('addInterval', () => {
  it.each([
    ['2026-01-15', 'MONTHLY', '2026-02-15'],
    ['2026-01-31', 'MONTHLY', '2026-02-28'],
    ['2026-02-28', 'MONTHLY', '2026-03-31'],
    ['2026-04-30', 'QUARTERLY', '2026-07-31'],
    ['2026-03-10', 'SEMIANNUALLY', '2026-09-10'],
    ['2028-02-29', 'ANNUALLY', '2029-02-28'],
    ['2026-12-31', 'DAILY', '2027-01-01'],
    ['2026-12-28', 'WEEKLY', '2027-01-04'],
    ['2026-05-05', 'ONE_TIME', '2026-05-05'],
  ])('%s + %s = %s', (from, frequency, expected) => {
    expect(iso(addInterval(day(from), frequency))).toBe(expected);
  });
});

function makeService(
  opts: {
    rec?: Record<string, unknown> | null;
    claimed?: number;
    posted?: number;
    accounts?: Map<string, { code: string; isControl: boolean }>;
  } = {},
) {
  const rec =
    opts.rec === undefined
      ? {
          id: 'rec-1',
          companyId: COMPANY_ID,
          code: 'RENT01',
          description: 'Office rent',
          frequency: 'MONTHLY',
          nextExecution: day('2026-11-01'),
          validUntil: day('2027-12-31'),
          executionCount: 0,
          maxExecutions: null,
          currency: 'USD',
          isActive: true,
          lines: [
            {
              accountId: 'acc-rent',
              debit: D(50000),
              credit: D(0),
              description: 'Rent',
              ordering: 0,
            },
            {
              accountId: 'acc-bank',
              debit: D(0),
              credit: D(50000),
              description: null,
              ordering: 1,
            },
          ],
        }
      : opts.rec;
  const recurringPosting = {
    findFirst: jest.fn().mockResolvedValue(rec),
    findUniqueOrThrow: jest.fn().mockResolvedValue(rec),
    updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
    create: jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'rec-new', ...data }),
      ),
    update: jest.fn().mockResolvedValue(rec),
    delete: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    recurringPosting,
    recurringPostingLine: { deleteMany: jest.fn() },
    journalEntry: { count: jest.fn().mockResolvedValue(opts.posted ?? 0) },
    $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
  };
  const accounts = {
    assertPostableMany: jest.fn().mockResolvedValue(
      opts.accounts ??
        new Map([
          ['acc-rent', { code: '6300', isControl: false }],
          ['acc-bank', { code: '1110', isControl: false }],
        ]),
    ),
  };
  const journals = {
    postFromSource: jest.fn().mockResolvedValue({
      id: 'je-1',
      number: 'JE-1023',
      date: day('2026-11-01'),
      totalDebit: D(50000),
    }),
  };
  const service = new RecurringPostingsService(
    prisma as never,
    accounts as never,
    journals as never,
  );
  return { service, prisma, accounts, journals };
}

describe('RecurringPostingsService.execute', () => {
  it('posts the instance on its scheduled date and advances the schedule', async () => {
    const { service, prisma, journals } = makeService();
    const res = await service.execute(COMPANY_ID, USER_ID, 'rec-1');

    expect(res.instance).toBe(1);
    expect(res.journalEntry.number).toBe('JE-1023');
    expect(journals.postFromSource).toHaveBeenCalledWith(
      prisma,
      COMPANY_ID,
      USER_ID,
      expect.objectContaining({
        date: day('2026-11-01'),
        source: RECURRING_POSTING_SOURCE,
        sourceId: 'rec-1',
        reference: 'RENT01 #1',
        lines: [
          expect.objectContaining({
            accountId: 'acc-rent',
            debit: 50000,
            credit: 0,
          }),
          expect.objectContaining({
            accountId: 'acc-bank',
            debit: 0,
            credit: 50000,
          }),
        ],
      }),
    );
    const claim = prisma.recurringPosting.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({
      id: 'rec-1',
      executionCount: 0,
      isActive: true,
    });
    expect(iso(claim.data.nextExecution)).toBe('2026-12-01');
    expect(claim.data.executionCount).toBe(1);
    expect(claim.data.isActive).toBe(true);
  });

  it('uses the posting date the user chose', async () => {
    const { service, journals } = makeService();
    await service.execute(COMPANY_ID, USER_ID, 'rec-1', '2026-11-05');
    expect(journals.postFromSource.mock.calls[0][3].date).toEqual(
      day('2026-11-05'),
    );
  });

  it('refuses an instance another user already processed, without posting', async () => {
    const { service, journals } = makeService({ claimed: 0 });
    await expect(service.execute(COMPANY_ID, USER_ID, 'rec-1')).rejects.toThrow(
      ConflictException,
    );
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('refuses an inactive posting', async () => {
    const { service, journals } = makeService({
      rec: { id: 'rec-1', code: 'OLD', isActive: false, lines: [] },
    });
    await expect(service.execute(COMPANY_ID, USER_ID, 'rec-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('deactivates the posting after its last instance', async () => {
    const { service, prisma } = makeService({
      rec: {
        id: 'rec-1',
        code: 'INS',
        description: 'Insurance',
        frequency: 'MONTHLY',
        nextExecution: day('2027-12-01'),
        validUntil: day('2027-12-31'),
        executionCount: 13,
        maxExecutions: null,
        currency: 'USD',
        isActive: true,
        lines: [],
      },
    });
    await service.execute(COMPANY_ID, USER_ID, 'rec-1');
    const claim = prisma.recurringPosting.updateMany.mock.calls[0][0];
    expect(claim.data.executionCount).toBe(14);
    expect(claim.data.isActive).toBe(false);
  });

  it('skipping advances the schedule without posting', async () => {
    const { service, prisma, journals } = makeService();
    await service.advance(COMPANY_ID, 'rec-1');
    expect(journals.postFromSource).not.toHaveBeenCalled();
    const claim = prisma.recurringPosting.updateMany.mock.calls[0][0];
    expect(iso(claim.data.nextExecution)).toBe('2026-12-01');
    expect(claim.data.lastExecutedAt).toBeUndefined();
  });
});

describe('RecurringPostingsService saving', () => {
  const base = {
    code: 'RENT01',
    description: 'Office rent',
    frequency: 'MONTHLY',
    nextExecution: '2026-11-01',
    lines: [
      { accountId: 'acc-rent', debit: 50000 },
      { accountId: 'acc-bank', credit: 50000 },
    ],
  };

  it('creates a balanced posting', async () => {
    const { service, prisma } = makeService();
    await service.create(COMPANY_ID, base);
    expect(prisma.recurringPosting.create).toHaveBeenCalled();
  });

  it('rejects lines that do not balance', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create(COMPANY_ID, {
        ...base,
        lines: [
          { accountId: 'acc-rent', debit: 50000 },
          { accountId: 'acc-bank', credit: 40000 },
        ],
      }),
    ).rejects.toThrow(/out of balance/);
    expect(prisma.recurringPosting.create).not.toHaveBeenCalled();
  });

  it('rejects a control account, which would need a business partner', async () => {
    const { service } = makeService({
      accounts: new Map([
        ['acc-rent', { code: '6300', isControl: false }],
        ['acc-bank', { code: '2100', isControl: true }],
      ]),
    });
    await expect(service.create(COMPANY_ID, base)).rejects.toThrow(
      /control account/,
    );
  });

  it('rejects Valid Until before Next Execution', async () => {
    const { service } = makeService();
    await expect(
      service.create(COMPANY_ID, { ...base, validUntil: '2026-10-01' }),
    ).rejects.toThrow(/Valid Until/);
  });

  it('will not re-activate a posting whose instances have all run', async () => {
    const { service } = makeService({
      rec: {
        id: 'rec-1',
        frequency: 'MONTHLY',
        nextExecution: day('2027-01-01'),
        validUntil: null,
        executionCount: 12,
        maxExecutions: 12,
        isActive: false,
      },
    });
    await expect(
      service.update(COMPANY_ID, 'rec-1', { isActive: true }),
    ).rejects.toThrow(/Raise Max Executions/);
  });

  it('will not delete a posting that has posted entries', async () => {
    const { service, prisma } = makeService({ posted: 3 });
    await expect(service.remove(COMPANY_ID, 'rec-1')).rejects.toThrow(
      /Deactivate it instead/,
    );
    expect(prisma.recurringPosting.delete).not.toHaveBeenCalled();
  });
});
