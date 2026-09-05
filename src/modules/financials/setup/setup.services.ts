import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerStatusWhere } from '../ledger-status';
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
  constructor(prisma: PrismaService) { super(prisma); }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const lines = (dto.lines ?? []) as { accountId: string; percentage: number; side: string; description?: string; ordering?: number }[];
    this.assertPercentages(lines);
    return this.prisma.postingTemplate.create({
      data: {
        companyId: cid,
        code: dto.code as string,
        description: dto.description as string,
        isActive: (dto.isActive as boolean) ?? true,
        lines: { create: lines.map((l, i) => ({ ...l, ordering: l.ordering ?? i })) },
      },
      ...this.readArgs(),
    });
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const lines = dto.lines as { accountId: string; percentage: number; side: string; description?: string; ordering?: number }[] | undefined;
    if (lines) this.assertPercentages(lines);

    return this.prisma.$transaction(async (tx) => {
      if (lines) await tx.postingTemplateLine.deleteMany({ where: { templateId: id } });
      return tx.postingTemplate.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code as string } : {}),
          ...(dto.description !== undefined ? { description: dto.description as string } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive as boolean } : {}),
          ...(lines ? { lines: { create: lines.map((l, i) => ({ ...l, ordering: l.ordering ?? i })) } } : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  /**
   * A percentage template spreads one amount across accounts, so each side must
   * account for the whole amount — otherwise the generated entry cannot balance.
   */
  private assertPercentages(lines: { percentage: number; side: string }[]) {
    for (const side of ['debit', 'credit']) {
      const sideLines = lines.filter((l) => l.side === side);
      if (!sideLines.length) {
        throw new BadRequestException(`A posting template needs at least one ${side} line.`);
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
  constructor(prisma: PrismaService) { super(prisma); }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const lines = (dto.lines ?? []) as { accountId: string; debit?: number; credit?: number; description?: string; ordering?: number }[];
    this.assertBalanced(lines);
    return this.prisma.recurringPosting.create({
      data: {
        companyId: cid,
        code: dto.code as string,
        description: dto.description as string,
        frequency: dto.frequency as never,
        nextExecution: new Date(dto.nextExecution as string),
        validUntil: dto.validUntil ? new Date(dto.validUntil as string) : null,
        maxExecutions: (dto.maxExecutions as number) ?? null,
        currency: (dto.currency as string) ?? 'USD',
        isActive: (dto.isActive as boolean) ?? true,
        lines: {
          create: lines.map((l, i) => ({
            accountId: l.accountId,
            debit: D(l.debit),
            credit: D(l.credit),
            description: l.description ?? null,
            ordering: l.ordering ?? i,
          })),
        },
      },
      ...this.readArgs(),
    });
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const lines = dto.lines as { accountId: string; debit?: number; credit?: number; description?: string; ordering?: number }[] | undefined;
    if (lines) this.assertBalanced(lines);

    return this.prisma.$transaction(async (tx) => {
      if (lines) await tx.recurringPostingLine.deleteMany({ where: { recurringId: id } });
      return tx.recurringPosting.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code as string } : {}),
          ...(dto.description !== undefined ? { description: dto.description as string } : {}),
          ...(dto.frequency !== undefined ? { frequency: dto.frequency as never } : {}),
          ...(dto.nextExecution !== undefined ? { nextExecution: new Date(dto.nextExecution as string) } : {}),
          ...(dto.validUntil !== undefined ? { validUntil: dto.validUntil ? new Date(dto.validUntil as string) : null } : {}),
          ...(dto.maxExecutions !== undefined ? { maxExecutions: dto.maxExecutions as number } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive as boolean } : {}),
          ...(lines
            ? {
                lines: {
                  create: lines.map((l, i) => ({
                    accountId: l.accountId,
                    debit: D(l.debit),
                    credit: D(l.credit),
                    description: l.description ?? null,
                    ordering: l.ordering ?? i,
                  })),
                },
              }
            : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  /** Templates that are due — the "Confirmation of Recurring Transactions" list. */
  async due(companyId: string, asOf: Date = new Date()) {
    return this.prisma.recurringPosting.findMany({
      where: {
        companyId,
        isActive: true,
        nextExecution: { lte: asOf },
        OR: [{ validUntil: null }, { validUntil: { gte: asOf } }],
      },
      include: this.options.include as never,
      orderBy: { nextExecution: 'asc' },
    });
  }

  /** Advances the schedule after an execution. */
  async advance(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const rec = await this.prisma.recurringPosting.findFirst({ where: { id, companyId: cid } });
    if (!rec) throw new NotFoundException('Recurring posting not found');

    const next = addInterval(rec.nextExecution, rec.frequency);
    const executionCount = rec.executionCount + 1;
    const exhausted =
      (rec.maxExecutions !== null && executionCount >= rec.maxExecutions) ||
      (rec.validUntil !== null && next > rec.validUntil) ||
      rec.frequency === 'ONE_TIME';

    return this.prisma.recurringPosting.update({
      where: { id },
      data: {
        executionCount,
        lastExecutedAt: new Date(),
        nextExecution: next,
        isActive: !exhausted,
      },
    });
  }

  private assertBalanced(lines: { debit?: number; credit?: number }[]) {
    const debit = lines.reduce((s, l) => s.plus(D(l.debit)), new Prisma.Decimal(0));
    const credit = lines.reduce((s, l) => s.plus(D(l.credit)), new Prisma.Decimal(0));
    if (!debit.equals(credit)) {
      throw new BadRequestException(
        `Recurring posting is out of balance: debits ${debit.toFixed(2)} vs credits ${credit.toFixed(2)}.`,
      );
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

function addInterval(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'DAILY': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'WEEKLY': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'MONTHLY': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'QUARTERLY': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'SEMIANNUALLY': d.setUTCMonth(d.getUTCMonth() + 6); break;
    case 'ANNUALLY': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: break; // ONE_TIME never advances
  }
  return d;
}
