import { BadRequestException, ConflictException } from '@nestjs/common';
import { PayrollRunsService } from './transactions.services';

/**
 * Unit coverage for the HR-Payroll → Financials integration
 * (`PayrollRunsService.post`/`.cancel`), mirroring how `payroll-calculation.spec.ts`
 * covers the payslip math next to it. Prisma, JournalEntriesService and
 * AccountDeterminationService are all mocked — this proves the posting *logic*
 * (which accounts get hit, whether the entry balances, the status guards)
 * without touching a real database. End-to-end behaviour against a live
 * Postgres belongs in `test/integration`, which this repo deliberately refuses
 * to run against a non-disposable host (see `test/integration/harness.ts`) —
 * this project's DATABASE_URL points at Supabase, so that suite is
 * intentionally not exercised here.
 */

const COMPANY_ID = 'company-1';
const RUN_ID = 'run-1';
const USER_ID = 'user-1';

const ACCOUNTS = {
  salaryExpense: 'acct-expense',
  salariesPayable: 'acct-payable',
  taxPayable: 'acct-tax',
  loanReceivable: 'acct-loan',
};

function makeService(runOverrides: Record<string, unknown> = {}, lineRows: Record<string, unknown>[] = []) {
  const run = {
    id: RUN_ID,
    companyId: COMPANY_ID,
    status: 'Open',
    jeNo: null,
    journalEntryId: null,
    payMonth: 'January 2026',
    documentDate: new Date('2026-01-31'),
    payPeriod: null,
    ...runOverrides,
  };

  const prisma: any = {
    payrollRun: {
      findFirst: jest.fn().mockResolvedValue(run),
      update: jest.fn(async ({ data }: any) => ({ ...run, ...data })),
    },
    payrollRunLine: {
      findMany: jest.fn().mockResolvedValue(lineRows),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
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
      };
      if (!(key in map)) throw new BadRequestException(`No G/L account mapped for payroll/${key}.`);
      return map[key];
    }),
  };

  const service = new PayrollRunsService(prisma, journals, determinations);
  return { service, prisma, journals, determinations, run };
}

const line = (netPay: number, taxDeduction = 0, loanDeduction = 0) => ({
  totalEarnings: netPay + taxDeduction + loanDeduction,
  netPay,
  taxDeduction,
  loanDeduction,
});

describe('PayrollRunsService.post', () => {
  it('posts a balanced journal — Dr expense = net pay + tax + loan; credits split across payable/tax/loan', async () => {
    const { service, journals, prisma } = makeService({}, [
      line(9000, 500, 200),
      line(4500, 250, 0),
    ]);

    const result = await service.post(COMPANY_ID, RUN_ID, USER_ID);

    expect(journals.postFromSource).toHaveBeenCalledTimes(1);
    const [, calledCompanyId, calledUserId, input] = journals.postFromSource.mock.calls[0];
    expect(calledCompanyId).toBe(COMPANY_ID);
    expect(calledUserId).toBe(USER_ID);
    expect(input.source).toBe('payroll_run');
    expect(input.sourceId).toBe(RUN_ID);

    const debit = input.lines.filter((l: any) => l.debit).reduce((s: number, l: any) => s + l.debit, 0);
    const credit = input.lines.filter((l: any) => l.credit).reduce((s: number, l: any) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(9000 + 4500 + 500 + 250 + 200, 2); // netPay + tax + loan, summed

    const byAccount = Object.fromEntries(input.lines.map((l: any) => [l.accountId, l]));
    expect(byAccount[ACCOUNTS.salaryExpense].debit).toBeCloseTo(14450, 2);
    expect(byAccount[ACCOUNTS.salariesPayable].credit).toBeCloseTo(13500, 2);
    expect(byAccount[ACCOUNTS.taxPayable].credit).toBeCloseTo(750, 2);
    expect(byAccount[ACCOUNTS.loanReceivable].credit).toBeCloseTo(200, 2);

    // The run is stamped with the real journal entry, not a manually-typed jeNo.
    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Posted', journalEntryId: 'je-1', jeNo: 'JE-0001' }),
      }),
    );
    expect(result.status).toBe('Posted');
  });

  it('omits the tax/loan credit lines — and never resolves those accounts — when a run has neither', async () => {
    const { service, journals, determinations } = makeService({}, [line(5000, 0, 0)]);

    await service.post(COMPANY_ID, RUN_ID, USER_ID);

    const input = journals.postFromSource.mock.calls[0][3];
    expect(input.lines).toHaveLength(2); // expense + payable only
    expect(determinations.resolve).not.toHaveBeenCalledWith(COMPANY_ID, 'PAYROLL', 'tax_payable');
    expect(determinations.resolve).not.toHaveBeenCalledWith(COMPANY_ID, 'PAYROLL', 'loan_receivable');
  });

  it('rejects posting a run that is already Posted', async () => {
    const { service } = makeService({ status: 'Posted' }, [line(1000)]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
  });

  it('rejects posting a run that was Cancelled', async () => {
    const { service } = makeService({ status: 'Cancelled' }, [line(1000)]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(ConflictException);
  });

  it('rejects posting a run with no employee lines', async () => {
    const { service } = makeService({}, []);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(BadRequestException);
  });

  it('rejects posting a run whose total net pay is zero', async () => {
    const { service } = makeService({}, [line(0, 0, 0)]);
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(BadRequestException);
  });

  it('surfaces a clear error when a required account has not been mapped', async () => {
    const { service, determinations } = makeService({}, [line(1000)]);
    determinations.resolve.mockImplementation(async () => {
      throw new BadRequestException(
        'No G/L account is mapped for PAYROLL/salary_expense. Set it under Administration → Setup → Financials → G/L Account Determination.',
      );
    });
    await expect(service.post(COMPANY_ID, RUN_ID, USER_ID)).rejects.toThrow(/No G\/L account is mapped/);
  });
});

describe('PayrollRunsService.cancel', () => {
  it('reverses the linked journal entry and flips the run to Cancelled', async () => {
    const { service, journals, prisma } = makeService({ status: 'Posted', journalEntryId: 'je-1', jeNo: 'JE-0001' });

    const result = await service.cancel(COMPANY_ID, RUN_ID, USER_ID, { reason: 'Payroll error' });

    expect(journals.reverseFromSource).toHaveBeenCalledWith(
      prisma, COMPANY_ID, USER_ID, 'je-1', expect.objectContaining({ reason: 'Payroll error' }),
    );
    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Cancelled', cancellationJeNo: 'JE-0002' }),
      }),
    );
    expect(result.status).toBe('Cancelled');
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
