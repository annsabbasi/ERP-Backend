import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerStatusWhere } from '../ledger-status';
import { AccountsService } from '../accounts/accounts.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);

/** A node in the cost-center tree returned by CostCentersService.hierarchy(). */
export interface CostCenterNode {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  children: CostCenterNode[];
}

/**
 * Thin tenant-scoped catalogs. Each one is a table of reference data with no
 * behaviour beyond CRUD, so they lean entirely on TenantCrudService — the point
 * being that companyId scoping is implemented once, not twenty times.
 * Anything that needed real logic (rates, templates, rules, budgets, assets)
 * overrides below.
 */

@Injectable()
export class CurrenciesService extends TenantCrudService {
  protected readonly modelName = 'currency';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Currency',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }

  /** The company's base currency (companies.currency) and whether it is in the master. */
  async base(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: this.requireCompany(companyId) },
      select: { currency: true },
    });
    const code = company?.currency ?? null;
    const inMaster = code
      ? !!(await this.prisma.currency.findFirst({
          where: { companyId, code },
          select: { id: true },
        }))
      : false;
    const postedEntries = await this.prisma.journalEntry.count({
      where: { companyId, status: 'POSTED' },
    });
    return { code, inMaster, postedEntries, canChange: postedEntries === 0 };
  }

  /**
   * Makes a master currency the company's base currency. Refused once the
   * company has posted journal entries: every entry, balance and report is
   * in the base currency, so changing it afterwards would re-denominate the
   * ledger without converting a single amount (QA D3 applies the same rule).
   */
  async makeBase(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const cur = await this.prisma.currency.findFirst({
      where: { id, companyId: cid },
    });
    if (!cur) throw new NotFoundException(`Currency ${id} not found`);
    if (!cur.isActive)
      throw new BadRequestException(
        `${cur.code} is inactive; activate it before making it the base currency.`,
      );
    const { code, postedEntries } = await this.base(cid);
    if (code === cur.code) return this.base(cid);
    if (postedEntries > 0) {
      throw new ConflictException(
        `The base currency is ${code ?? 'not set'} and the company already has ${postedEntries} posted journal ` +
          'entr' +
          (postedEntries === 1 ? 'y' : 'ies') +
          ' in it. It cannot change without converting the ledger.',
      );
    }
    await this.prisma.company.update({
      where: { id: cid },
      data: { currency: cur.code },
    });
    return this.base(cid);
  }

  /** The base currency cannot be deleted — every posting would lose its currency. */
  async remove(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const cur = await this.prisma.currency.findFirst({
      where: { id, companyId: cid },
      select: { code: true },
    });
    const company = await this.prisma.company.findUnique({
      where: { id: cid },
      select: { currency: true },
    });
    if (cur && company?.currency === cur.code) {
      throw new ConflictException(
        `${cur.code} is the company's base currency and cannot be deleted.`,
      );
    }
    return super.remove(cid, id);
  }
}

@Injectable()
export class PaymentTermsService extends TenantCrudService {
  protected readonly modelName = 'paymentTerms';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Payment terms',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class FinanceProjectsService extends TenantCrudService {
  protected readonly modelName = 'financeProject';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Project',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class TransactionCodesService extends TenantCrudService {
  protected readonly modelName = 'transactionCode';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Transaction code',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'description'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class TaxCodesService extends TenantCrudService {
  protected readonly modelName = 'taxCode';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Tax code',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['type', 'isActive'],
    uniqueBy: ['code'],
    include: { account: { select: { id: true, code: true, name: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class CashFlowLineItemsService extends TenantCrudService {
  protected readonly modelName = 'cashFlowLineItem';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Cash flow line item',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['section', 'isActive', 'parentId'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

/** A DTO field class-validator has already checked is a string. */
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

@Injectable()
export class BanksService extends TenantCrudService {
  protected readonly modelName = 'bank';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Bank',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name', 'swift'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class HouseBankAccountsService extends TenantCrudService {
  protected readonly modelName = 'houseBankAccount';
  protected readonly options: TenantCrudOptions = {
    entityName: 'House bank account',
    orderBy: { accountNo: 'asc' },
    searchFields: ['accountNo', 'accountName', 'iban'],
    filterableFields: ['bankId', 'isActive', 'currency'],
    uniqueBy: ['bankId', 'accountNo'],
    include: {
      bank: { select: { id: true, code: true, name: true } },
      glAccount: { select: { id: true, code: true, name: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async create(
    companyId: string,
    dto: Record<string, unknown>,
  ): Promise<unknown> {
    await this.checkRefs(companyId, dto, true);
    return super.create(companyId, dto) as Promise<unknown>;
  }

  async update(
    companyId: string,
    id: string,
    dto: Record<string, unknown>,
  ): Promise<unknown> {
    await this.checkRefs(companyId, dto, false);
    return super.update(companyId, id, dto) as Promise<unknown>;
  }

  /**
   * bankId and glAccountId arrive as bare ids from the client; both must be
   * this company's. The G/L account is what a payment from this account
   * credits (Pay Salaries, disbursements, remittances), so it must be a
   * postable, active asset account — required on create, and never cleared.
   */
  private async checkRefs(
    companyId: string,
    dto: Record<string, unknown>,
    creating: boolean,
  ) {
    if (dto.bankId !== undefined) {
      const bank = await this.prisma.bank.findFirst({
        where: { id: asText(dto.bankId), companyId },
        select: { id: true },
      });
      if (!bank)
        throw new BadRequestException(
          'That bank does not exist in this company.',
        );
    }
    if (creating || dto.glAccountId !== undefined) {
      if (!dto.glAccountId) {
        throw new BadRequestException(
          'A house bank account needs its G/L account (the bank account in the chart of accounts that payments from it credit).',
        );
      }
      const acct = await this.prisma.account.findFirst({
        where: { id: asText(dto.glAccountId), companyId },
        select: { type: true, isTitle: true, isActive: true, code: true },
      });
      if (!acct)
        throw new BadRequestException(
          'That G/L account does not exist in this company.',
        );
      if (acct.type !== 'ASSET' || acct.isTitle || !acct.isActive) {
        throw new BadRequestException(
          `G/L account ${acct.code} must be an active, postable (non-title) asset account.`,
        );
      }
    }
    if (dto.currency !== undefined) {
      const cur = await this.prisma.currency.findFirst({
        where: { companyId, code: asText(dto.currency) },
        select: { id: true },
      });
      if (!cur)
        throw new BadRequestException(
          `Currency ${asText(dto.currency)} is not in this company's currency master.`,
        );
    }
  }
}

@Injectable()
export class PaymentMethodsService extends TenantCrudService {
  protected readonly modelName = 'paymentMethod';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Payment method',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'description'],
    filterableFields: ['direction', 'isActive'],
    uniqueBy: ['code'],
    include: { houseBankAccount: { select: { id: true, accountNo: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async create(
    companyId: string,
    dto: Record<string, unknown>,
  ): Promise<unknown> {
    await this.checkHouseBank(companyId, dto);
    return super.create(companyId, dto) as Promise<unknown>;
  }

  async update(
    companyId: string,
    id: string,
    dto: Record<string, unknown>,
  ): Promise<unknown> {
    await this.checkHouseBank(companyId, dto);
    return super.update(companyId, id, dto) as Promise<unknown>;
  }

  /** houseBankAccountId arrives as a bare id; it must be this company's. */
  private async checkHouseBank(
    companyId: string,
    dto: Record<string, unknown>,
  ) {
    if (!dto.houseBankAccountId) return;
    const hba = await this.prisma.houseBankAccount.findFirst({
      where: { id: asText(dto.houseBankAccountId), companyId },
      select: { id: true },
    });
    if (!hba)
      throw new BadRequestException(
        'That house bank account does not exist in this company.',
      );
  }
}

@Injectable()
export class DunningTermsService extends TenantCrudService {
  protected readonly modelName = 'dunningTerm';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Dunning term',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class DimensionsService extends TenantCrudService {
  protected readonly modelName = 'dimension';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Dimension',
    orderBy: { dimensionNo: 'asc' },
    searchFields: ['name'],
    filterableFields: ['isActive'],
    uniqueBy: ['dimensionNo'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class CostCentersService extends TenantCrudService {
  protected readonly modelName = 'costCenter';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Cost center',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['dimensionId', 'isActive', 'parentId'],
    uniqueBy: ['dimensionId', 'code'],
    include: {
      dimension: { select: { id: true, dimensionNo: true, name: true } },
      parent: { select: { id: true, code: true, name: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  /** Cost Center Hierarchy window — the tree for one dimension. */
  async hierarchy(companyId: string, dimensionId?: string): Promise<CostCenterNode[]> {
    const cid = this.requireCompany(companyId);
    const rows = await this.prisma.costCenter.findMany({
      where: { companyId: cid, ...(dimensionId ? { dimensionId } : {}) },
      orderBy: { code: 'asc' },
    });

    const byId = new Map<string, CostCenterNode>(
      rows.map((r) => [r.id, { id: r.id, code: r.code, name: r.name, isActive: r.isActive, children: [] }]),
    );
    const roots: CostCenterNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      const parent = r.parentId ? byId.get(r.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }
}

// ─── EXCHANGE RATES ───────────────────────────────────────────────────────────
@Injectable()
export class ExchangeRatesService extends TenantCrudService {
  protected readonly modelName = 'exchangeRate';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Exchange rate',
    orderBy: [{ date: 'desc' }, { targetCurrency: 'asc' }],
    searchFields: ['targetCurrency', 'baseCurrency'],
    filterableFields: ['baseCurrency', 'targetCurrency'],
    uniqueBy: ['baseCurrency', 'targetCurrency', 'date'],
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>) {
    const out = super.beforeWrite(dto);
    if (out.date) {
      // Stored as a DATE; normalising to UTC midnight keeps the unique
      // (base, target, date) key from splitting on the caller's timezone.
      const d = new Date(out.date as string);
      out.date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    return out;
  }

  /**
   * Rate to use for a posting: the most recent quote on or before the date.
   * A missing quote is an error rather than a silent 1.0 — quietly posting at
   * parity is the kind of bug that only surfaces at year end.
   */
  async rateFor(
    companyId: string,
    targetCurrency: string,
    date: Date,
    baseCurrency = 'USD',
  ): Promise<Prisma.Decimal> {
    if (targetCurrency === baseCurrency) return new Prisma.Decimal(1);

    const row = await this.prisma.exchangeRate.findFirst({
      where: { companyId, baseCurrency, targetCurrency, date: { lte: date } },
      orderBy: { date: 'desc' },
    });
    if (!row) {
      throw new BadRequestException(
        `No ${baseCurrency}→${targetCurrency} exchange rate on or before ` +
          `${date.toISOString().slice(0, 10)}. Add one under Administration → Exchange Rates & Indexes.`,
      );
    }
    return row.rate;
  }

  /** Bulk upsert — the Exchange Rates grid saves a whole month at once. */
  async bulkUpsert(
    companyId: string,
    rows: { baseCurrency?: string; targetCurrency: string; rate: number; date: string; source?: string }[],
  ) {
    const cid = this.requireCompany(companyId);
    const results = await this.prisma.$transaction(
      rows.map((r) => {
        const d = new Date(r.date);
        const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const baseCurrency = r.baseCurrency ?? 'USD';
        return this.prisma.exchangeRate.upsert({
          where: {
            companyId_baseCurrency_targetCurrency_date: {
              companyId: cid, baseCurrency, targetCurrency: r.targetCurrency, date,
            },
          },
          create: {
            companyId: cid, baseCurrency, targetCurrency: r.targetCurrency,
            date, rate: D(r.rate), source: r.source ?? 'manual',
          },
          update: { rate: D(r.rate), source: r.source ?? 'manual' },
        });
      }),
    );
    return { upserted: results.length, rates: results };
  }

  /**
   * One month shaped as the Exchange Rates grid draws it.
   *
   * The columns are the company's active currencies rather than whichever
   * currencies happen to have a quote that month — otherwise a column appears
   * and disappears as the operator pages between months, and there is nowhere
   * to type the first rate for a currency that has none yet.
   */
  async monthGrid(companyId: string, year: number, month: number, baseCurrency = 'USD') {
    const cid = this.requireCompany(companyId);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException(`Month ${month} is out of range — expected 1-12.`);
    }
    if (!Number.isInteger(year) || year < 1900 || year > 2999) {
      throw new BadRequestException(`Year ${year} is out of range.`);
    }

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last of this
    const daysInMonth = end.getUTCDate();

    const [currencies, rows] = await Promise.all([
      this.prisma.currency.findMany({
        where: { companyId: cid, isActive: true, code: { not: baseCurrency } },
        orderBy: { code: 'asc' },
        select: { code: true, name: true, decimals: true },
      }),
      this.prisma.exchangeRate.findMany({
        where: { companyId: cid, baseCurrency, date: { gte: start, lte: end } },
        select: { id: true, targetCurrency: true, date: true, rate: true, source: true },
      }),
    ]);

    const byDay = new Map<number, Map<string, { id: string; rate: string; source: string | null }>>();
    for (const r of rows) {
      const day = r.date.getUTCDate();
      if (!byDay.has(day)) byDay.set(day, new Map());
      byDay.get(day)!.set(r.targetCurrency, {
        id: r.id,
        rate: r.rate.toString(),
        source: r.source,
      });
    }

    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const found = byDay.get(day);
      const cells: Record<string, { id: string; rate: string; source: string | null } | null> = {};
      for (const c of currencies) cells[c.code] = found?.get(c.code) ?? null;
      return {
        day,
        date: new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10),
        cells,
      };
    });

    return { year, month, baseCurrency, currencies, days };
  }

  /** Clears one quote. A cleared cell is "no quote", which is not a rate of 0. */
  async clearCell(companyId: string, targetCurrency: string, date: string, baseCurrency = 'USD') {
    const cid = this.requireCompany(companyId);
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`"${date}" is not a valid date.`);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    const removed = await this.prisma.exchangeRate.deleteMany({
      where: { companyId: cid, baseCurrency, targetCurrency, date: day },
    });
    return { removed: removed.count, targetCurrency, date: day.toISOString().slice(0, 10) };
  }
}

// ─── ACCOUNT DETERMINATION ────────────────────────────────────────────────────
@Injectable()
export class AccountDeterminationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, area?: string) {
    return this.prisma.accountDetermination.findMany({
      where: { companyId, ...(area ? { area: area as never } : {}) },
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: [{ area: 'asc' }, { key: 'asc' }],
    });
  }

  async set(companyId: string, dto: { area: never; key: string; accountId: string }) {
    const account = await this.prisma.account.findFirst({
      where: { id: dto.accountId, companyId },
      select: { id: true, isTitle: true, code: true },
    });
    if (!account) throw new BadRequestException('Account not found in this company');
    if (account.isTitle) {
      throw new BadRequestException(
        `Account ${account.code} is a Title account and cannot be a determination target.`,
      );
    }

    return this.prisma.accountDetermination.upsert({
      where: { companyId_area_key: { companyId, area: dto.area, key: dto.key } },
      create: { companyId, area: dto.area, key: dto.key, accountId: dto.accountId },
      update: { accountId: dto.accountId },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
  }

  /** Resolves a determination key to an account id, for posting routines. */
  async resolve(companyId: string, area: string, key: string): Promise<string> {
    const row = await this.prisma.accountDetermination.findFirst({
      where: { companyId, area: area as never, key },
    });
    if (!row) {
      throw new BadRequestException(
        `No G/L account is mapped for ${area}/${key}. ` +
          `Set it under Administration → Setup → Financials → G/L Account Determination.`,
      );
    }
    return row.accountId;
  }

  async remove(companyId: string, id: string) {
    const row = await this.prisma.accountDetermination.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Determination not found');
    await this.prisma.accountDetermination.delete({ where: { id } });
    return { id, message: 'Determination cleared' };
  }
}

// ─── POSTING TEMPLATES ────────────────────────────────────────────────────────
@Injectable()
export class PostingTemplatesService extends TenantCrudService {
  protected readonly modelName = 'postingTemplate';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Posting template',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'description'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: {
      lines: {
        orderBy: { ordering: 'asc' },
        include: { account: { select: { id: true, code: true, name: true } } },
      },
    },
  };
  constructor(
    prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {
    super(prisma);
  }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const lines = (dto.lines ?? []) as {
      accountId: string;
      percentage: number;
      side: string;
      description?: string;
      ordering?: number;
    }[];
    this.assertPercentages(lines);
    await this.accounts.assertPostableMany(
      cid,
      lines.map((l) => l.accountId),
    );
    try {
      return await this.prisma.postingTemplate.create({
        data: {
          companyId: cid,
          code: dto.code as string,
          description: dto.description as string,
          isActive: (dto.isActive as boolean) ?? true,
          lines: {
            create: lines.map((l, i) => ({ ...l, ordering: l.ordering ?? i })),
          },
        },
        ...this.readArgs(),
      });
    } catch (e) {
      throw this.translatePrismaError(e, dto);
    }
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const lines = dto.lines as
      | {
          accountId: string;
          percentage: number;
          side: string;
          description?: string;
          ordering?: number;
        }[]
      | undefined;
    if (lines) {
      this.assertPercentages(lines);
      await this.accounts.assertPostableMany(
        cid,
        lines.map((l) => l.accountId),
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (lines)
          await tx.postingTemplateLine.deleteMany({
            where: { templateId: id },
          });
        return tx.postingTemplate.update({
          where: { id },
          data: {
            ...(dto.code !== undefined ? { code: dto.code as string } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description as string }
              : {}),
            ...(dto.isActive !== undefined
              ? { isActive: dto.isActive as boolean }
              : {}),
            ...(lines
              ? {
                  lines: {
                    create: lines.map((l, i) => ({
                      ...l,
                      ordering: l.ordering ?? i,
                    })),
                  },
                }
              : {}),
          },
          ...this.readArgs(),
        });
      });
    } catch (e) {
      throw this.translatePrismaError(e, dto);
    }
  }

  /**
   * Deleting a template that entries were built from would null their
   * `templateId` (ON DELETE SET NULL) and lose that audit trail, so a used
   * template can only be deactivated.
   */
  async remove(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const used = await this.prisma.journalEntry.count({
      where: { companyId: cid, templateId: id },
    });
    if (used > 0) {
      throw new ConflictException(
        `This posting template was used by ${used} journal entr${used === 1 ? 'y' : 'ies'} and cannot be deleted. Deactivate it instead.`,
      );
    }
    return super.remove(cid, id);
  }

  /**
   * Spreads `amount` across the template's lines by percentage, giving the
   * journal-entry lines the user then reviews and posts. Each side is rounded
   * to cents and the last line on that side absorbs the leftover, so debits and
   * credits each total exactly `amount`.
   */
  async apply(companyId: string, id: string, amount: number) {
    const cid = this.requireCompany(companyId);
    const template = await this.prisma.postingTemplate.findFirst({
      where: { id, companyId: cid },
      include: {
        lines: {
          orderBy: { ordering: 'asc' },
          include: {
            account: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!template)
      throw new NotFoundException(`Posting template ${id} not found`);
    if (!template.isActive) {
      throw new BadRequestException(
        `Posting template ${template.code} is inactive.`,
      );
    }

    const total = D(amount).toDecimalPlaces(2);
    if (total.lte(0))
      throw new BadRequestException('Amount must be greater than zero.');

    const lines = spreadByPercentage(total, template.lines);
    return {
      templateId: template.id,
      code: template.code,
      description: template.description,
      amount: total.toFixed(2),
      lines: lines.map((l) => ({
        accountId: l.accountId,
        account: l.account,
        description: l.description,
        percentage: l.percentage.toString(),
        side: l.side,
        debit: l.side === 'debit' ? l.amount.toFixed(2) : '0.00',
        credit: l.side === 'credit' ? l.amount.toFixed(2) : '0.00',
      })),
    };
  }

  /**
   * A percentage template spreads one amount across accounts, so each side must
   * account for the whole amount — otherwise the generated entry cannot balance.
   */
  private assertPercentages(lines: { percentage: number; side: string }[]) {
    if (lines.some((l) => !(Number(l.percentage) > 0))) {
      throw new BadRequestException(
        'Every posting template line needs a percentage above 0.',
      );
    }
    for (const side of ['debit', 'credit']) {
      const sideLines = lines.filter((l) => l.side === side);
      if (!sideLines.length) {
        throw new BadRequestException(
          `A posting template needs at least one ${side} line.`,
        );
      }
      const total = sideLines.reduce((s, l) => s + Number(l.percentage), 0);
      if (Math.abs(total - 100) > 0.0001) {
        throw new BadRequestException(
          `${side[0].toUpperCase()}${side.slice(1)} percentages total ${total}%, but must total 100%.`,
        );
      }
    }
  }
}

// ─── RECURRING POSTINGS ───────────────────────────────────────────────────────
/** `JournalEntry.source` of entries posted from a recurring posting. */
export const RECURRING_POSTING_SOURCE = 'recurring_posting';

type RecurringLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  ordering?: number;
};

type ScheduleState = {
  frequency: string;
  nextExecution: Date;
  validUntil: Date | null;
  executionCount: number;
  maxExecutions: number | null;
};

/**
 * Interactive-transaction budget for an execution: it allocates a document
 * number and posts a journal, the same work JournalEntriesService gives 20s.
 */
const EXECUTE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Recurring postings: a fixed, balanced set of journal lines that repeats on a
 * schedule (rent, insurance, monthly accruals).
 *
 * Nothing posts by itself. Due postings appear in the confirmation list and the
 * user executes them. One execution posts one journal entry, dated at the
 * scheduled date unless the user overrides it, and moves the schedule on by one
 * interval in the same transaction. Missed runs therefore stay due and are
 * caught up one instance at a time, each in its own period.
 */
@Injectable()
export class RecurringPostingsService extends TenantCrudService {
  protected readonly modelName = 'recurringPosting';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Recurring posting',
    orderBy: { nextExecution: 'asc' },
    searchFields: ['code', 'description'],
    filterableFields: ['isActive', 'frequency'],
    uniqueBy: ['code'],
    include: {
      lines: {
        orderBy: { ordering: 'asc' },
        include: { account: { select: { id: true, code: true, name: true } } },
      },
    },
  };
  constructor(
    prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly journals: JournalEntriesService,
  ) {
    super(prisma);
  }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const lines = (dto.lines ?? []) as RecurringLineInput[];
    this.assertLines(lines);
    await this.assertAccounts(cid, lines);

    const schedule: ScheduleState = {
      frequency: dto.frequency as string,
      nextExecution: new Date(dto.nextExecution as string),
      validUntil: dto.validUntil ? new Date(dto.validUntil as string) : null,
      executionCount: 0,
      maxExecutions: (dto.maxExecutions as number) ?? null,
    };
    const isActive = (dto.isActive as boolean) ?? true;
    this.assertSchedule(schedule, isActive);

    try {
      return await this.prisma.recurringPosting.create({
        data: {
          companyId: cid,
          code: dto.code as string,
          description: dto.description as string,
          frequency: dto.frequency as never,
          nextExecution: schedule.nextExecution,
          validUntil: schedule.validUntil,
          maxExecutions: schedule.maxExecutions,
          currency: (dto.currency as string) ?? 'USD',
          isActive,
          lines: { create: this.lineRows(lines) },
        },
        ...this.readArgs(),
      });
    } catch (e) {
      throw this.translatePrismaError(e, dto);
    }
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const current = (await this.findOne(
      cid,
      id,
    )) as unknown as ScheduleState & {
      isActive: boolean;
    };
    const lines = dto.lines as RecurringLineInput[] | undefined;
    if (lines) {
      this.assertLines(lines);
      await this.assertAccounts(cid, lines);
    }

    // Check the schedule as it will be after this update, not just the fields
    // sent — re-activating a finished posting is an update of `isActive` alone.
    const schedule: ScheduleState = {
      frequency: (dto.frequency as string) ?? current.frequency,
      nextExecution:
        dto.nextExecution !== undefined
          ? new Date(dto.nextExecution as string)
          : current.nextExecution,
      validUntil:
        dto.validUntil !== undefined
          ? dto.validUntil
            ? new Date(dto.validUntil as string)
            : null
          : current.validUntil,
      executionCount: current.executionCount,
      maxExecutions:
        dto.maxExecutions !== undefined
          ? ((dto.maxExecutions as number) ?? null)
          : current.maxExecutions,
    };
    this.assertSchedule(
      schedule,
      (dto.isActive as boolean) ?? current.isActive,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (lines) {
          await tx.recurringPostingLine.deleteMany({
            where: { recurringId: id },
          });
        }
        return tx.recurringPosting.update({
          where: { id },
          data: {
            ...(dto.code !== undefined ? { code: dto.code as string } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description as string }
              : {}),
            ...(dto.frequency !== undefined
              ? { frequency: dto.frequency as never }
              : {}),
            ...(dto.nextExecution !== undefined
              ? { nextExecution: schedule.nextExecution }
              : {}),
            ...(dto.validUntil !== undefined
              ? { validUntil: schedule.validUntil }
              : {}),
            ...(dto.maxExecutions !== undefined
              ? { maxExecutions: schedule.maxExecutions }
              : {}),
            ...(dto.currency !== undefined
              ? { currency: dto.currency as string }
              : {}),
            ...(dto.isActive !== undefined
              ? { isActive: dto.isActive as boolean }
              : {}),
            ...(lines ? { lines: { create: this.lineRows(lines) } } : {}),
          },
          ...this.readArgs(),
        });
      });
    } catch (e) {
      throw this.translatePrismaError(e, dto);
    }
  }

  /**
   * A posting that has produced journal entries is kept, so those entries can
   * still be traced back to it. It can be deactivated instead.
   */
  async remove(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const posted = await this.prisma.journalEntry.count({
      where: { companyId: cid, source: RECURRING_POSTING_SOURCE, sourceId: id },
    });
    if (posted > 0) {
      throw new ConflictException(
        `This recurring posting has posted ${posted} journal entr${posted === 1 ? 'y' : 'ies'} and cannot be deleted. Deactivate it instead.`,
      );
    }
    return super.remove(cid, id);
  }

  /** Postings that are due — the "Confirmation of Recurring Transactions" list. */
  async due(companyId: string, asOf: Date = new Date()) {
    const cid = this.requireCompany(companyId);
    return this.prisma.recurringPosting.findMany({
      where: {
        companyId: cid,
        isActive: true,
        nextExecution: { lte: asOf },
      },
      include: this.options.include as never,
      orderBy: { nextExecution: 'asc' },
    });
  }

  /** Journal entries this posting has produced, newest first. */
  async entries(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    return this.prisma.journalEntry.findMany({
      where: { companyId: cid, source: RECURRING_POSTING_SOURCE, sourceId: id },
      select: {
        id: true,
        number: true,
        date: true,
        status: true,
        reference: true,
        totalDebit: true,
        reversal: { select: { id: true, number: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Executes the next instance: posts its journal entry and advances the
   * schedule, together or not at all. `postingDate` defaults to the scheduled
   * date, so a catch-up run lands in the period it belongs to.
   */
  async execute(
    companyId: string,
    userId: string | null,
    id: string,
    postingDate?: string,
  ) {
    const cid = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.recurringPosting.findFirst({
        where: { id, companyId: cid },
        include: { lines: { orderBy: { ordering: 'asc' } } },
      });
      if (!rec) throw new NotFoundException('Recurring posting not found');
      if (!rec.isActive) {
        throw new BadRequestException(
          `Recurring posting ${rec.code} is inactive and cannot be executed.`,
        );
      }

      const instance = rec.executionCount + 1;
      // Claim the instance before posting. Two users executing the same row at
      // once both read the same count; only one of these updates matches, so
      // the other fails here instead of posting the instance a second time.
      await this.claimInstance(tx, rec, { lastExecutedAt: new Date() });

      const entry = await this.journals.postFromSource(tx, cid, userId, {
        date: postingDate ? new Date(postingDate) : rec.nextExecution,
        source: RECURRING_POSTING_SOURCE,
        sourceId: rec.id,
        description: rec.description,
        reference: `${rec.code} #${instance}`,
        currency: rec.currency,
        lines: rec.lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description ?? undefined,
          ordering: l.ordering,
        })),
      });

      const recurringPosting = await tx.recurringPosting.findUniqueOrThrow({
        where: { id },
        include: this.options.include as never,
      });
      return {
        instance,
        journalEntry: {
          id: entry.id,
          number: entry.number,
          date: entry.date,
          totalDebit: entry.totalDebit,
        },
        recurringPosting,
      };
    }, EXECUTE_TX_OPTIONS);
  }

  /**
   * Skips the next instance without posting it: the schedule moves on by one
   * interval and the instance counts toward Max Executions.
   */
  async advance(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.recurringPosting.findFirst({
        where: { id, companyId: cid },
      });
      if (!rec) throw new NotFoundException('Recurring posting not found');
      if (!rec.isActive) {
        throw new BadRequestException(
          `Recurring posting ${rec.code} is inactive.`,
        );
      }
      await this.claimInstance(tx, rec, {});
      return tx.recurringPosting.findUniqueOrThrow({
        where: { id },
        include: this.options.include as never,
      });
    });
  }

  /**
   * Moves the schedule on by one instance, conditional on nobody having done so
   * since `rec` was read. Deactivates the posting when that was its last run.
   */
  private async claimInstance(
    tx: Prisma.TransactionClient,
    rec: ScheduleState & { id: string; code: string },
    extra: { lastExecutedAt?: Date },
  ) {
    const executionCount = rec.executionCount + 1;
    const next = addInterval(rec.nextExecution, rec.frequency);
    const finished =
      rec.frequency === 'ONE_TIME' ||
      (rec.maxExecutions !== null && executionCount >= rec.maxExecutions) ||
      (rec.validUntil !== null && next > rec.validUntil);

    const claimed = await tx.recurringPosting.updateMany({
      where: { id: rec.id, executionCount: rec.executionCount, isActive: true },
      data: {
        ...extra,
        executionCount,
        nextExecution: rec.frequency === 'ONE_TIME' ? rec.nextExecution : next,
        isActive: !finished,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        `Instance ${executionCount} of ${rec.code} was already processed by another user. Refresh the list.`,
      );
    }
  }

  private lineRows(lines: RecurringLineInput[]) {
    return lines.map((l, i) => ({
      accountId: l.accountId,
      debit: D(l.debit),
      credit: D(l.credit),
      description: l.description ?? null,
      ordering: l.ordering ?? i,
    }));
  }

  /** The lines must be able to post as they are, every time the posting runs. */
  private assertLines(lines: RecurringLineInput[]) {
    for (const [i, l] of lines.entries()) {
      const debit = D(l.debit);
      const credit = D(l.credit);
      if (debit.gt(0) && credit.gt(0)) {
        throw new BadRequestException(
          `Line ${i + 1}: put an amount in either debit or credit, not both.`,
        );
      }
      if (debit.eq(0) && credit.eq(0)) {
        throw new BadRequestException(
          `Line ${i + 1}: debit and credit are both zero.`,
        );
      }
    }
    const debit = lines.reduce(
      (s, l) => s.plus(D(l.debit)),
      new Prisma.Decimal(0),
    );
    const credit = lines.reduce(
      (s, l) => s.plus(D(l.credit)),
      new Prisma.Decimal(0),
    );
    if (!debit.equals(credit)) {
      throw new BadRequestException(
        `Recurring posting is out of balance: debits ${debit.toFixed(2)} vs credits ${credit.toFixed(2)}.`,
      );
    }
  }

  /**
   * Lines carry no business partner, so a control account (A/R, A/P) could
   * never post from here; refusing it at save beats failing at every run.
   */
  private async assertAccounts(companyId: string, lines: RecurringLineInput[]) {
    const accounts = await this.accounts.assertPostableMany(
      companyId,
      lines.map((l) => l.accountId),
    );
    for (const [i, l] of lines.entries()) {
      const account = accounts.get(l.accountId)!;
      if (account.isControl) {
        throw new BadRequestException(
          `Line ${i + 1}: account ${account.code} is a control account and needs a business partner, which recurring postings do not carry.`,
        );
      }
    }
  }

  private assertSchedule(s: ScheduleState, isActive: boolean) {
    if (Number.isNaN(s.nextExecution.getTime())) {
      throw new BadRequestException('Next Execution is not a valid date.');
    }
    if (s.validUntil && s.validUntil < s.nextExecution) {
      throw new BadRequestException(
        'Valid Until cannot be before Next Execution.',
      );
    }
    if (s.maxExecutions !== null && s.maxExecutions < s.executionCount) {
      throw new BadRequestException(
        `Max Executions cannot be below the ${s.executionCount} instance(s) already run.`,
      );
    }
    // Activating a posting that has nothing left to run would put it straight
    // back on the confirmation list with nothing it is allowed to post.
    if (isActive && s.executionCount > 0) {
      if (s.frequency === 'ONE_TIME') {
        throw new BadRequestException(
          'This one-time posting has already run. Create a new posting instead.',
        );
      }
      if (s.maxExecutions !== null && s.executionCount >= s.maxExecutions) {
        throw new BadRequestException(
          `All ${s.maxExecutions} instance(s) have run. Raise Max Executions to activate it again.`,
        );
      }
    }
  }
}

// ─── DISTRIBUTION RULES ───────────────────────────────────────────────────────
@Injectable()
export class DistributionRulesService extends TenantCrudService {
  protected readonly modelName = 'distributionRule';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Distribution rule',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['dimensionId', 'isActive'],
    uniqueBy: ['dimensionId', 'code'],
    include: {
      dimension: { select: { id: true, dimensionNo: true, name: true } },
      lines: { include: { costCenter: { select: { id: true, code: true, name: true } } } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const lines = (dto.lines ?? []) as { costCenterId: string; ratio: number }[];
    const totalRatio = this.totalRatio(lines);

    return this.prisma.distributionRule.create({
      data: {
        companyId: cid,
        dimensionId: dto.dimensionId as string,
        code: dto.code as string,
        name: dto.name as string,
        totalRatio,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom as string) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo as string) : null,
        isActive: (dto.isActive as boolean) ?? true,
        lines: { create: lines.map((l) => ({ costCenterId: l.costCenterId, ratio: D(l.ratio) })) },
      },
      ...this.readArgs(),
    });
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const lines = dto.lines as { costCenterId: string; ratio: number }[] | undefined;

    return this.prisma.$transaction(async (tx) => {
      if (lines) await tx.distributionRuleLine.deleteMany({ where: { ruleId: id } });
      return tx.distributionRule.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code as string } : {}),
          ...(dto.name !== undefined ? { name: dto.name as string } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive as boolean } : {}),
          ...(lines
            ? {
                totalRatio: this.totalRatio(lines),
                lines: { create: lines.map((l) => ({ costCenterId: l.costCenterId, ratio: D(l.ratio) })) },
              }
            : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  /**
   * Splits an amount across the rule's cost centers.
   * The last share absorbs the rounding remainder so the parts always add back
   * up to the original amount — otherwise repeated allocations drift by cents.
   */
  async split(companyId: string, ruleId: string, amount: Prisma.Decimal) {
    const rule = await this.prisma.distributionRule.findFirst({
      where: { id: ruleId, companyId },
      include: { lines: true },
    });
    if (!rule) throw new NotFoundException('Distribution rule not found');
    if (!rule.lines.length) throw new BadRequestException('Distribution rule has no lines');
    if (rule.totalRatio.isZero()) {
      throw new BadRequestException(`Distribution rule ${rule.code} has a total ratio of zero.`);
    }

    const out: { costCenterId: string; amount: Prisma.Decimal }[] = [];
    let allocated = new Prisma.Decimal(0);

    rule.lines.forEach((l, i) => {
      const isLast = i === rule.lines.length - 1;
      const share = isLast
        ? amount.minus(allocated)
        : amount.times(l.ratio).dividedBy(rule.totalRatio).toDecimalPlaces(2);
      allocated = allocated.plus(share);
      out.push({ costCenterId: l.costCenterId, amount: share });
    });

    return out;
  }

  private totalRatio(lines: { ratio: number }[]): Prisma.Decimal {
    const total = lines.reduce((s, l) => s.plus(D(l.ratio)), new Prisma.Decimal(0));
    if (total.isZero()) {
      throw new BadRequestException('Distribution ratios cannot all be zero.');
    }
    return total;
  }
}

// ─── BUDGETS ──────────────────────────────────────────────────────────────────
@Injectable()
export class BudgetScenariosService extends TenantCrudService {
  protected readonly modelName = 'budgetScenario';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Budget scenario',
    orderBy: [{ fiscalYear: 'desc' }, { code: 'asc' }],
    searchFields: ['code', 'name'],
    filterableFields: ['fiscalYear', 'isActive'],
    uniqueBy: ['code'],
    include: { basedOn: { select: { id: true, code: true, name: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class BudgetDistributionMethodsService extends TenantCrudService {
  protected readonly modelName = 'budgetDistributionMethod';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Budget distribution method',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>) {
    const out = super.beforeWrite(dto);
    if (Array.isArray(out.monthlyRatios)) {
      const ratios = out.monthlyRatios as number[];
      if (ratios.length !== 12) {
        throw new BadRequestException('monthlyRatios must contain exactly 12 values.');
      }
      const total = ratios.reduce((s, r) => s + Number(r), 0);
      if (Math.abs(total - 100) > 0.01) {
        throw new BadRequestException(
          `Monthly ratios total ${total.toFixed(2)}%, but must total 100%.`,
        );
      }
    }
    return out;
  }
}

@Injectable()
export class BudgetLinesService extends TenantCrudService {
  protected readonly modelName = 'budgetLine';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Budget line',
    orderBy: { createdAt: 'asc' },
    filterableFields: ['scenarioId', 'accountId', 'costCenterId', 'periodId'],
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      scenario: { select: { id: true, code: true, name: true, fiscalYear: true } },
      distributionMethod: { select: { id: true, code: true, name: true, monthlyRatios: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  /** Spreads the annual figures over 12 periods using the chosen method. */
  protected beforeWrite(dto: Record<string, unknown>) {
    return super.beforeWrite(dto);
  }

  async create(companyId: string, dto: Record<string, unknown>) {
    const created = (await super.create(companyId, dto)) as { id: string };
    await this.recomputeBreakdown(companyId, created.id);
    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    await super.update(companyId, id, dto);
    await this.recomputeBreakdown(companyId, id);
    return this.findOne(companyId, id);
  }

  private async recomputeBreakdown(companyId: string, id: string) {
    const line = await this.prisma.budgetLine.findFirst({
      where: { id, companyId },
      include: { distributionMethod: true },
    });
    if (!line) return;

    const ratios: number[] = line.distributionMethod
      ? (line.distributionMethod.monthlyRatios as number[])
      : Array(12).fill(100 / 12);

    const debit = line.annualDebit;
    const credit = line.annualCredit;
    let allocDebit = new Prisma.Decimal(0);
    let allocCredit = new Prisma.Decimal(0);

    const breakdown = ratios.map((r, i) => {
      const isLast = i === ratios.length - 1;
      // Last month soaks up rounding so the twelve parts sum to the annual total.
      const d = isLast
        ? debit.minus(allocDebit)
        : debit.times(r).dividedBy(100).toDecimalPlaces(2);
      const c = isLast
        ? credit.minus(allocCredit)
        : credit.times(r).dividedBy(100).toDecimalPlaces(2);
      allocDebit = allocDebit.plus(d);
      allocCredit = allocCredit.plus(c);
      return { month: i + 1, ratio: r, debit: d.toFixed(2), credit: c.toFixed(2) };
    });

    await this.prisma.budgetLine.update({
      where: { id },
      data: { breakdown: breakdown as unknown as Prisma.InputJsonValue },
    });
  }

  /** Budget vs actual for a scenario — the "Budget Report" and its variants. */
  async versusActual(companyId: string, scenarioId: string) {
    const scenario = await this.prisma.budgetScenario.findFirst({
      where: { id: scenarioId, companyId },
    });
    if (!scenario) throw new NotFoundException('Budget scenario not found');

    const lines = await this.prisma.budgetLine.findMany({
      where: { companyId, scenarioId },
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
    });

    const yearStart = new Date(Date.UTC(scenario.fiscalYear, 0, 1));
    const yearEnd = new Date(Date.UTC(scenario.fiscalYear, 11, 31, 23, 59, 59));

    const actuals = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: lines.map((l) => l.accountId) },
        entry: { companyId, ...ledgerStatusWhere(), date: { gte: yearStart, lte: yearEnd } },
      },
      _sum: { debit: true, credit: true },
    });
    const actualBy = new Map(
      actuals.map((a) => [
        a.accountId,
        (a._sum.debit ?? new Prisma.Decimal(0)).minus(a._sum.credit ?? new Prisma.Decimal(0)),
      ]),
    );

    return {
      scenario: { id: scenario.id, code: scenario.code, name: scenario.name, fiscalYear: scenario.fiscalYear },
      rows: lines.map((l) => {
        const budget = l.annualDebit.minus(l.annualCredit);
        const actual = actualBy.get(l.accountId) ?? new Prisma.Decimal(0);
        const variance = actual.minus(budget);
        return {
          account: l.account,
          budget: budget.toFixed(2),
          actual: actual.toFixed(2),
          variance: variance.toFixed(2),
          variancePercent: budget.isZero() ? null : variance.dividedBy(budget).times(100).toFixed(2),
        };
      }),
    };
  }
}

/**
 * The next scheduled date. Month-based steps keep the day of the month, clamped
 * to the month's length (31 Jan → 28 Feb); a date on the last day of its month
 * stays on the last day (28 Feb → 31 Mar), so month-end accruals don't drift.
 */
export function addInterval(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'DAILY':
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    case 'WEEKLY':
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case 'MONTHLY':
      return addMonths(d, 1);
    case 'QUARTERLY':
      return addMonths(d, 3);
    case 'SEMIANNUALLY':
      return addMonths(d, 6);
    case 'ANNUALLY':
      return addMonths(d, 12);
    default:
      return d; // ONE_TIME never advances
  }
}

function addMonths(from: Date, months: number): Date {
  const daysIn = (y: number, m: number) =>
    new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = from.getUTCDate();
  const monthEnd = day === daysIn(from.getUTCFullYear(), from.getUTCMonth());
  const d = new Date(from);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = daysIn(d.getUTCFullYear(), d.getUTCMonth());
  d.setUTCDate(monthEnd ? last : Math.min(day, last));
  return d;
}

/**
 * Splits `total` across lines by percentage, per side. Every line but the last
 * on a side is rounded half-up to cents; the last takes whatever is left, so
 * the side sums to `total` exactly and the resulting entry balances.
 */
export function spreadByPercentage<
  L extends { side: string; percentage: Prisma.Decimal | number | string },
>(total: Prisma.Decimal, lines: L[]): (L & { amount: Prisma.Decimal })[] {
  const out = lines.map((l) => ({ ...l, amount: new Prisma.Decimal(0) }));
  for (const side of ['debit', 'credit']) {
    const idx = out
      .map((l, i) => (l.side === side ? i : -1))
      .filter((i) => i >= 0);
    let allocated = new Prisma.Decimal(0);
    idx.forEach((i, n) => {
      const amount =
        n === idx.length - 1
          ? total.minus(allocated)
          : total
              .mul(D(out[i].percentage))
              .div(100)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      allocated = allocated.plus(amount);
      out[i].amount = amount;
    });
  }
  if (out.some((l) => l.amount.lte(0))) {
    throw new BadRequestException(
      `${total.toFixed(2)} is too small to split across this template — at least one line would be zero or negative.`,
    );
  }
  return out;
}
