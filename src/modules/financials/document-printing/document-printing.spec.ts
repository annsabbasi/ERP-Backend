import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DocumentPrintingService,
  internalNumberOf,
  propertySet,
} from './document-printing.service';

/**
 * Document Printing finds posted documents by the Selection Criteria window's
 * filters and keeps SAP's Printed / E-Mailed flags. These prove the filters
 * that run in memory (internal number, printed, e-mailed, BP properties), the
 * per-type permission check, and that confirming a print bumps the flag and
 * is audited. Prisma, AuditService and ConfigService are mocked.
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const COMPANY_ID = 'company-1';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const user = (
  permissions: string[] = ['financials.journal.view', 'financials.ar.view'],
) => ({
  sub: 'user-1',
  email: 'u@example.com',
  companyId: COMPANY_ID,
  isSuperAdmin: false,
  roleType: 'USER',
  departmentId: null,
  branchId: null,
  permissions,
  enabledModuleSlugs: ['financials'],
});

const entry = (
  id: string,
  number: string,
  date: string,
  status = 'POSTED',
) => ({
  id,
  number,
  date: day(date),
  totalDebit: D(100),
  currency: 'USD',
  status,
  lines: [],
});

function makeService(
  opts: {
    entries?: ReturnType<typeof entry>[];
    invoices?: unknown[];
    partners?: { id: string; properties: unknown }[];
    statuses?: { documentId: string; printCount: number; emailCount: number }[];
  } = {},
) {
  const prisma = {
    journalEntry: { findMany: jest.fn().mockResolvedValue(opts.entries ?? []) },
    aRInvoice: { findMany: jest.fn().mockResolvedValue(opts.invoices ?? []) },
    businessPartner: {
      findMany: jest.fn().mockResolvedValue(opts.partners ?? []),
    },
    documentOutputStatus: {
      findMany: jest.fn().mockResolvedValue(
        (opts.statuses ?? []).map((s) => ({
          ...s,
          lastPrintedAt: null,
          lastEmailedAt: null,
        })),
      ),
      upsert: jest.fn((args: unknown) => args),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn() };
  const service = new DocumentPrintingService(
    prisma as never,
    audit as never,
    config as never,
  );
  return { service, prisma, audit };
}

describe('internalNumberOf', () => {
  it.each([
    ['JE-000123', 123],
    ['INV-2026-0042', 42],
    ['42', 42],
    ['BILL-7A', 7],
    ['NO-DIGITS', null],
  ])('%s → %s', (number, expected) => {
    expect(internalNumberOf(number)).toBe(expected);
  });
});

describe('propertySet', () => {
  it('reads the object and array shapes and ignores unset properties', () => {
    expect([...propertySet({ '1': true, '2': false, '5': 'Y' })]).toEqual([
      1, 5,
    ]);
    expect([...propertySet([3, '4'])]).toEqual([3, 4]);
    expect(propertySet(null).size).toBe(0);
  });
});

describe('DocumentPrintingService.search', () => {
  it('drops drafts in the query and filters by internal number in memory', async () => {
    const { service, prisma } = makeService({
      entries: [
        entry('a', 'JE-000010', '2026-09-02'),
        entry('b', 'JE-000020', '2026-09-03'),
        entry('c', 'JE-000030', '2026-09-04'),
      ],
    });

    const res = await service.search(user(), {
      documentType: 'journal_entry',
      postingDateFrom: '2026-09-01',
      postingDateTo: '2026-09-25',
      internalNumberFrom: 15,
      internalNumberTo: 30,
    });

    expect(res.rows.map((r) => r.number)).toEqual(['JE-000020', 'JE-000030']);
    const where = prisma.journalEntry.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'DRAFT' });
    expect(where.date.gte).toEqual(day('2026-09-01'));
    expect(where.date.lte).toEqual(new Date('2026-09-25T23:59:59.999Z'));
  });

  it('"Only Documents Still to Be Printed" hides printed ones and flags the rest', async () => {
    const { service } = makeService({
      entries: [
        entry('a', 'JE-1', '2026-09-02'),
        entry('b', 'JE-2', '2026-09-03'),
      ],
      statuses: [{ documentId: 'a', printCount: 2, emailCount: 0 }],
    });

    const all = await service.search(user(), { documentType: 'journal_entry' });
    expect(all.rows.map((r) => [r.id, r.printed, r.printCount])).toEqual([
      ['a', true, 2],
      ['b', false, 0],
    ]);

    const pending = await service.search(user(), {
      documentType: 'journal_entry',
      onlyNotPrinted: true,
    });
    expect(pending.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('BP properties with "and" need every property; "or" needs one', async () => {
    const partners = [
      { id: 'bp-1', properties: { '1': true, '2': true } },
      { id: 'bp-2', properties: { '1': true } },
    ];
    const and = makeService({ partners });
    await and.service.search(user(), {
      documentType: 'ar_invoice',
      properties: [1, 2],
      propertiesMode: 'and',
    });
    expect(and.prisma.aRInvoice.findMany.mock.calls[0][0].where.bpId).toEqual({
      in: ['bp-1'],
    });

    const or = makeService({ partners });
    await or.service.search(user(), {
      documentType: 'ar_invoice',
      properties: [1, 2],
      propertiesMode: 'or',
    });
    expect(or.prisma.aRInvoice.findMany.mock.calls[0][0].where.bpId).toEqual({
      in: ['bp-1', 'bp-2'],
    });
  });

  it('returns nothing without querying documents when no partner matches', async () => {
    const { service, prisma } = makeService({ partners: [] });
    const res = await service.search(user(), {
      documentType: 'ar_invoice',
      bpCodeFrom: 'C9',
      bpCodeTo: 'C9',
    });
    expect(res.rows).toEqual([]);
    expect(prisma.aRInvoice.findMany).not.toHaveBeenCalled();
  });

  it('refuses a "From" after its "To"', async () => {
    const { service } = makeService();
    await expect(
      service.search(user(), {
        documentType: 'journal_entry',
        accountFrom: '5000',
        accountTo: '1000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('needs the view right of the document type', async () => {
    const { service } = makeService();
    await expect(
      service.search(user(['financials.journal.view']), {
        documentType: 'ap_invoice',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentPrintingService.mark', () => {
  it('bumps the print count of every document and writes one audit event', async () => {
    const { service, prisma, audit } = makeService({
      entries: [
        entry('a', 'JE-1', '2026-09-02'),
        entry('b', 'JE-2', '2026-09-03'),
      ],
    });

    const res = await service.mark(
      user(),
      'journal_entry',
      ['a', 'b', 'a'],
      'print',
    );

    expect(res.marked).toBe(2);
    expect(prisma.documentOutputStatus.upsert).toHaveBeenCalledTimes(2);
    const first = prisma.documentOutputStatus.upsert.mock.calls[0][0] as {
      create: { printCount: number };
      update: { printCount: unknown };
    };
    expect(first.create.printCount).toBe(1);
    expect(first.update.printCount).toEqual({ increment: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.printed',
        refType: 'journal_entry',
      }),
    );
  });

  it('refuses ids that are not (or no longer) printable', async () => {
    const { service, prisma } = makeService({
      entries: [entry('a', 'JE-1', '2026-09-02')],
    });
    await expect(
      service.mark(user(), 'journal_entry', ['a', 'gone'], 'print'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.documentOutputStatus.upsert).not.toHaveBeenCalled();
  });
});
