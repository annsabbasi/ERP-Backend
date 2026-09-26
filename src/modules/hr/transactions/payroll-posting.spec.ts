import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollRunsService, translateRecoveryError } from './transactions.services';

/**
 * Unit coverage for Payroll Process's posting, locking and recovery rules
 * (`PayrollRunsService`). Prisma, JournalEntriesService and
 * AccountDeterminationService are mocked — this proves the *logic* (which
 * accounts get hit, whether the entry balances, how deductions are split across
 * installments, which states refuse which writes). The database-side guards
 * (duplicate index, recovery trigger, concurrency) are proven against a real
 * Postgres in test/sql/payroll-phase1-guards.sql and test/integration.
 */

const COMPANY_ID = 'company-1';
const RUN_ID = 'run-1';
const USER_ID = 'user-1';

const ACCOUNTS = {
  salaryExpense: 'acct-expense',
  salariesPayable: 'acct-payable',
  taxPayable: 'acct-tax',
  loanReceivable: 'acct-loan',
  advanceReceivable: 'acct-advance',
};

interface Inst { id: string; loanId: string; employeeId: string; amount: number; recovered?: number; advance?: boolean; dueDate?: string }

function makeService(
  runOverrides: Record<string, unknown> = {},
  lineRows: Record<string, unknown>[] = [],
  opts: { currency?: string | null; currencyInMaster?: boolean; installments?: Inst[]; financials?: boolean; unmapped?: string[] } = {},
) {
  const run = {
    id: RUN_ID,
    companyId: COMPANY_ID,
    status: 'Open',
    runType: 'Regular',
    payPeriodId: 'pp-1',
    jeNo: null,
    journalEntryId: null,
    payMonth: 'January 2026',
    documentDate: new Date('2026-01-31'),
    payPeriod: { id: 'pp-1', name: 'Jan 2026' },
    ...runOverrides,
  };

  const lines = lineRows.map((l, i) => ({
    id: `line-${i + 1}`,
    employeeId: `emp-${i + 1}`,
    employee: { name: `Employee ${i + 1}`, employeeNumber: `E${i + 1}` },
    ...l,
  }));

  // Rows as outstandingInstallmentsSql's SELECT returns them (already ordered by due date).
  const installmentRows = (opts.installments ?? []).map((i) => ({
    id: i.id,
    loanId: i.loanId,
    employeeId: i.employeeId,
    loanType: i.advance ? 'Advance' : 'Personal',
    dueDate: new Date(i.dueDate ?? '2026-01-15'),
    outstanding: new Prisma.Decimal(i.amount - (i.recovered ?? 0)),
  }));
  const mapped: Record<string, string> = {
    salary_expense: ACCOUNTS.salaryExpense,
    salaries_payable: ACCOUNTS.salariesPayable,
    tax_payable: ACCOUNTS.taxPayable,
    loan_receivable: ACCOUNTS.loanReceivable,
    advance_receivable: ACCOUNTS.advanceReceivable,
  };
  for (const k of opts.unmapped ?? []) delete mapped[k];

  const prisma: any = {
    payrollRun: {
      findFirst: jest.fn().mockResolvedValue(run),
      update: jest.fn(async ({ data }: any) => ({ ...run, ...data })),
      delete: jest.fn(),
    },
    payrollRunLine: {
      findMany: jest.fn().mockResolvedValue(lines),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    payPeriod: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pp-1', fromDate: new Date('2026-01-01'), toDate: new Date('2026-01-31'), workingDays: 22 }),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({ currency: opts.currency === undefined ? 'PKR' : opts.currency }),
    },
    currency: {
      findFirst: jest.fn().mockResolvedValue(opts.currencyInMaster === false ? null : { id: 'cur-1' }),
    },
    accountDetermination: {
      findMany: jest.fn(async () => Object.entries(mapped).map(([key, accountId]) => ({ key, accountId }))),
    },
    employee: { findMany: jest.fn(async () => lines.map((l: any) => ({ id: l.employeeId, ...l.employee }))) },
    companyModule: { findFirst: jest.fn().mockResolvedValue(opts.financials === false ? null : { id: 'cm-1' }) },
    loanRecovery: { createMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    // lockRun's SELECT … FOR UPDATE. By default the lock sees what findOne saw;
    // tests override it to simulate another request having changed the run.
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) =>
      sql.join('').includes('employee_loan_installments') ? installmentRows : [{ status: (run as any).status }]),
  };

  const journals: any = {
    postFromSource: jest.fn().mockResolvedValue({ id: 'je-1', number: 'JE-0001' }),
    reverseFromSource: jest.fn().mockResolvedValue({ id: 'je-2', number: 'JE-0002' }),
  };

  const determinations: any = {
    resolve: jest.fn(async (_companyId: string, _area: string, key: string) => {
      const map: Record<string, string> = {
        salary_expense: ACCOUNTS.salaryExpense,
        salaries_payable: ACCOUNTS.salariesPayable,
        tax_payable: ACCOUNTS.taxPayable,
        loan_receivable: ACCOUNTS.loanReceivable,
        advance_receivable: ACCOUNTS.advanceReceivable,
      };
      if (!(key in map)) throw new BadRequestException(`No G/L account mapped for payroll/${key}.`);
      return map[key];
    }),
  };

  const service = new PayrollRunsService(prisma, journals, determinations);
  return { service, prisma, journals, determinations, run };
}

const line = (netPay: number, taxDeduction = 0, loanDeduction = 0, advanceDeduction = 0) => ({
  totalEarnings: netPay + taxDeduction + loanDeduction + advanceDeduction,
  netPay,
  taxDeduction,
  loanDeduction,
  advanceDeduction,
});

const journalInput = (journals: any) => journals.postFromSource.mock.calls[0][3];
const byAccount = (input: any) => Object.fromEntries(input.lines.map((l: any) => [l.accountId, l]));

describe('PayrollRunsService.post — the journal entry', () => {
  it('posts a balanced journal — Dr expense = net + tax + loan + advance; one credit per liability/receivable', async () => {
    const { service, journals, prisma } = makeService({}, [
      line(9000, 500, 200, 300),
      line(4500, 250, 0, 0),
    ], {
      installments: [
        { id: 'i-loan', loanId: 'loan-1', employeeId: 'emp-1', amount: 200 },
        { id: 'i-adv', loanId: 'adv-1', employeeId: 'emp-1', amount: 300, advance: true },
      ],
    });

    const result = await service.post(COMPANY_ID, RUN_ID, USER_ID);

    const input = journalInput(journals);
    expect(input.source).toBe('payroll_run');
    expect(input.sourceId).toBe(RUN_ID);
    const debit = input.lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
    const credit = input.lines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
    expect(debit).toBeCloseTo(credit, 2);

    const acc = byAccount(input);
    expect(acc[ACCOUNTS.salaryExpense].debit).toBeCloseTo(9000 + 4500 + 750 + 200 + 300, 2);
    expect(acc[ACCOUNTS.salariesPayable].credit).toBeCloseTo(13500, 2);
    expect(acc[ACCOUNTS.taxPayable].credit).toBeCloseTo(750, 2);
    expect(acc[ACCOUNTS.loanReceivable].credit).toBeCloseTo(200, 2);
    expect(acc[ACCOUNTS.advanceReceivable].credit).toBeCloseTo(300, 2);
    expect(acc[ACCOUNTS.advanceReceivable].description).toMatch(/^Advance recovered — /);

    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Posted', journalEntryId: 'je-1', jeNo: 'JE-0001' }) }),
    );
    expect(result.status).toBe('Posted');
  });

  it('passes the company base currency to the journal — never the USD fallback', async () => {
    const { service, journals } = makeService({}, [line(1000)], { currency: 'PKR' });
    await service.post(COMPANY_ID, RUN_ID, USER_ID);
    expect(journalInput(journals).currency).toBe('PKR');
  });

  it('refuses to post when the company does not have the Financials module', async () => {
    const { service, journals } = makeService({}, [line(1000)], { financials: false });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/Financials module is not enabled/);
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('refuses to post when the company has no base currency', async () => {
    const { service, journals } = makeService({}, [line(1000)], { currency: null });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/no base currency/);
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('refuses to post when the base currency is missing from the currency master', async () => {
    const { service, journals } = makeService({}, [line(1000)], { currency: 'PKR', currencyInMaster: false });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/not in this company's currency master/);
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('omits tax/loan/advance lines — and does not need those accounts mapped — when a run has none', async () => {
    const { service, journals } = makeService({}, [line(5000)], { unmapped: ['tax_payable', 'loan_receivable', 'advance_receivable'] });
    await service.post(COMPANY_ID, RUN_ID, USER_ID);
    expect(journalInput(journals).lines).toHaveLength(2);
  });

  it('surfaces a clear error when a required account has not been mapped', async () => {
    const { service, journals } = makeService({}, [line(1000)], { unmapped: ['salary_expense'] });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/No G\/L account is mapped for PAYROLL\/salary_expense/);
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('resolves every PAYROLL account in one query, not one per key', async () => {
    const { service, prisma } = makeService({}, [line(9000, 500, 200, 300)], {
      installments: [
        { id: 'i-loan', loanId: 'loan-1', employeeId: 'emp-1', amount: 200 },
        { id: 'i-adv', loanId: 'adv-1', employeeId: 'emp-1', amount: 300, advance: true },
      ],
    });
    await service.post(COMPANY_ID, RUN_ID, USER_ID);
    expect(prisma.accountDetermination.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('PayrollRunsService.post — recovery ledger', () => {
  it('writes one recovery per installment, oldest due first, in the same transaction as the journal', async () => {
    // The SQL returns them ordered by due date — the mock mirrors that order.
    const { service, prisma, journals } = makeService({}, [line(8000, 0, 700, 0)], {
      installments: [
        { id: 'i-dec', loanId: 'loan-1', employeeId: 'emp-1', amount: 500, dueDate: '2025-12-10' },
        { id: 'i-jan', loanId: 'loan-1', employeeId: 'emp-1', amount: 500, dueDate: '2026-01-10' },
      ],
    });

    await service.post(COMPANY_ID, RUN_ID, USER_ID);

    const data = prisma.loanRecovery.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ installmentId: 'i-dec', source: 'payroll', payrollRunId: RUN_ID, payrollRunLineId: 'line-1' });
    expect(Number(data[0].amount)).toBe(500);
    expect(data[1]).toMatchObject({ installmentId: 'i-jan' });
    expect(Number(data[1].amount)).toBe(200);
    // Journal first, then the ledger, then the run — all inside the one transaction callback.
    const order = [
      journals.postFromSource.mock.invocationCallOrder[0],
      prisma.loanRecovery.createMany.mock.invocationCallOrder[0],
      prisma.payrollRun.update.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('keeps loan and advance deductions on their own installments', async () => {
    const { service, prisma } = makeService({}, [line(8000, 0, 100, 250)], {
      installments: [
        { id: 'i-loan', loanId: 'loan-1', employeeId: 'emp-1', amount: 100 },
        { id: 'i-adv', loanId: 'adv-1', employeeId: 'emp-1', amount: 250, advance: true },
      ],
    });
    await service.post(COMPANY_ID, RUN_ID, USER_ID);
    const data = prisma.loanRecovery.createMany.mock.calls[0][0].data;
    const byInst = Object.fromEntries(data.map((d: any) => [d.installmentId, Number(d.amount)]));
    expect(byInst).toEqual({ 'i-loan': 100, 'i-adv': 250 });
  });

  it('only counts what is still outstanding after earlier recoveries', async () => {
    const { service } = makeService({}, [line(8000, 0, 400)], {
      installments: [{ id: 'i-1', loanId: 'loan-1', employeeId: 'emp-1', amount: 500, recovered: 200 }],
    });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/only 300 is outstanding/);
  });

  it('refuses a Loan Ded. with no loan behind it rather than crediting an empty receivable', async () => {
    const { service, journals } = makeService({}, [line(8000, 0, 150)], { installments: [] });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
    expect(journals.postFromSource).not.toHaveBeenCalled();
  });

  it('refuses an Advance Ded. that exceeds the outstanding advance', async () => {
    const { service } = makeService({}, [line(8000, 0, 0, 999)], {
      installments: [{ id: 'i-adv', loanId: 'adv-1', employeeId: 'emp-1', amount: 500, advance: true }],
    });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/Advance Ded\. for E1 Employee 1 is 999/);
  });

  it('turns the database over-recovery refusal into a 409', async () => {
    const { service, journals } = makeService({}, [line(8000, 0, 100)], {
      installments: [{ id: 'i-1', loanId: 'loan-1', employeeId: 'emp-1', amount: 100 }],
    });
    journals.postFromSource.mockRejectedValue(new Error('P2010 ... LOAN_OVER_RECOVERY: installment i-1 has 0 outstanding'));
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
    expect(translateRecoveryError(new Error('unrelated'))).toBeInstanceOf(Error);
  });
});

describe('PayrollRunsService.post — status guards', () => {
  it.each(['Posted', 'Partially Paid', 'Paid'])('rejects posting a run that is %s', async (status) => {
    const { service } = makeService({ status }, [line(1000)]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/already posted/);
  });

  it('rejects posting a run that was Cancelled', async () => {
    const { service } = makeService({ status: 'Cancelled' }, [line(1000)]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/cancelled/);
  });

  it('rejects posting a run with no employee lines', async () => {
    const { service } = makeService({}, []);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(BadRequestException);
  });

  it('rejects posting a run whose total net pay is zero', async () => {
    const { service } = makeService({}, [line(0)]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(BadRequestException);
  });
});

describe('PayrollRunsService — server-side lock', () => {
  it.each(['Posted', 'Cancelled', 'Partially Paid', 'Paid'])('refuses to edit the header of a %s run', async (status) => {
    const { service, prisma } = makeService({ status });
    await expect(service.update(COMPANY_ID, RUN_ID, { remarks: 'x' })).rejects.toThrow(ConflictException);
    expect(prisma.payrollRun.update).not.toHaveBeenCalled();
  });

  it.each(['Posted', 'Cancelled'])('refuses to delete a %s run', async (status) => {
    const { service, prisma } = makeService({ status });
    await expect(service.remove(COMPANY_ID, RUN_ID)).rejects.toThrow(ConflictException);
    expect(prisma.payrollRun.delete).not.toHaveBeenCalled();
  });

  it.each(['Posted', 'Cancelled'])('refuses to replace the lines of a %s run', async (status) => {
    const { service, prisma } = makeService({ status });
    await expect(service.replaceLines(COMPANY_ID, RUN_ID, { rows: [] })).rejects.toThrow(ConflictException);
    expect(prisma.payrollRunLine.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['Posted', 'Cancelled'])('refuses to regenerate the lines of a %s run', async (status) => {
    const { service, prisma } = makeService({ status });
    await expect(service.generateLines(COMPANY_ID, RUN_ID)).rejects.toThrow(ConflictException);
    expect(prisma.payrollRunLine.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a Regular run without a pay period', async () => {
    const { service } = makeService();
    await expect(service.create(COMPANY_ID, { runType: 'Regular' })).rejects.toThrow(/needs a Pay Period/);
  });
});

describe('PayrollRunsService — status is re-checked under the row lock', () => {
  it('post: another Post committed first → 409, and no second journal entry', async () => {
    const { service, prisma, journals } = makeService({}, [line(1000)]);
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'Posted' }]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/already posted/);
    expect(journals.postFromSource).not.toHaveBeenCalled();
    expect(prisma.payrollRun.update).not.toHaveBeenCalled();
  });

  it('post: lines are read after the lock, inside the transaction', async () => {
    const { service, prisma } = makeService({}, [line(1000)]);
    await service.post(COMPANY_ID, RUN_ID, USER_ID);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.payrollRunLine.findMany.mock.invocationCallOrder[0]);
  });

  it('replaceLines: the run was posted meanwhile → 409, grid untouched', async () => {
    const { service, prisma } = makeService();
    prisma.employee = { count: jest.fn().mockResolvedValue(0) };
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'Posted' }]);
    await expect(service.replaceLines(COMPANY_ID, RUN_ID, { rows: [] })).rejects.toThrow(ConflictException);
    expect(prisma.payrollRunLine.deleteMany).not.toHaveBeenCalled();
  });

  it('cancel: another Cancel committed first → 409, no second reversal', async () => {
    const { service, prisma, journals } = makeService({ status: 'Posted', journalEntryId: 'je-1' });
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'Cancelled' }]);
    await expect(service.cancel(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
    expect(journals.reverseFromSource).not.toHaveBeenCalled();
    expect(prisma.loanRecovery.updateMany).not.toHaveBeenCalled();
  });
});

describe('PayrollRunsService.cancel', () => {
  it('reverses the journal, reverses exactly this run\'s recoveries, and flips the run to Cancelled', async () => {
    const { service, journals, prisma } = makeService({ status: 'Posted', journalEntryId: 'je-1', jeNo: 'JE-0001' });

    const result = await service.cancel(COMPANY_ID, RUN_ID, USER_ID, { reason: 'Payroll error' });

    expect(journals.reverseFromSource).toHaveBeenCalledWith(
      prisma, COMPANY_ID, USER_ID, 'je-1', expect.objectContaining({ reason: 'Payroll error' }),
    );
    expect(prisma.loanRecovery.updateMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, payrollRunId: RUN_ID, source: 'payroll', reversedAt: null },
      data: expect.objectContaining({ reversedById: USER_ID, reversedAt: expect.any(Date) }),
    });
    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Cancelled', cancellationJeNo: 'JE-0002' }) }),
    );
    expect(result.status).toBe('Cancelled');
  });

  it.each(['Partially Paid', 'Paid'])('refuses to cancel a %s run until its payments are reversed', async (status) => {
    const { service, journals } = makeService({ status, journalEntryId: 'je-1' });
    await expect(service.cancel(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/Reverse those payments/);
    expect(journals.reverseFromSource).not.toHaveBeenCalled();
  });

  it('rejects cancelling a run that was never posted', async () => {
    const { service } = makeService({ status: 'Open' });
    await expect(service.cancel(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
  });

  it('rejects cancelling a Posted run with no linked journal entry (data inconsistency guard)', async () => {
    const { service } = makeService({ status: 'Posted', journalEntryId: null });
    await expect(service.cancel(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
  });
});
