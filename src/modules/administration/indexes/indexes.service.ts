import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';

const D = (v: number | string) => new Prisma.Decimal(v);

export interface IndexGridRow {
  month: number;
  monthName: string;
  /** indexId -> value as a plain string, or null where no value is recorded. */
  values: Record<string, string | null>;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The Indexes tab of Exchange Rates & Indexes.
 *
 * An index is a named series (CPI, a construction cost index, …) with one value
 * per month. The window is a grid: rows are the twelve months of the selected
 * year, columns are the indexes. Both halves are served from here — the catalog
 * through the shared tenant CRUD, and the grid through `grid`/`saveGrid`, which
 * take and return the grid's own shape so the window does no reshaping of its
 * own.
 */
@Injectable()
export class FinancialIndexesService extends TenantCrudService {
  protected readonly modelName = 'financialIndex';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Index',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: { _count: { select: { values: true } } },
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected beforeWrite(dto: Record<string, unknown>) {
    const out = super.beforeWrite(dto);
    // A code is a column header in the grid; case drift would show the same
    // index twice under two spellings.
    if (typeof out.code === 'string') out.code = out.code.trim().toUpperCase();
    return out;
  }

  /**
   * The grid for one year: twelve rows regardless of how much data exists, so
   * the window renders a stable calendar instead of a table that shrinks when a
   * month has no value yet.
   */
  async grid(companyId: string, year: number) {
    const cid = this.requireCompany(companyId);
    this.assertYear(year);

    const indexes = await this.prisma.financialIndex.findMany({
      where: { companyId: cid, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, baseYear: true },
    });

    const values = await this.prisma.financialIndexValue.findMany({
      where: { companyId: cid, year },
      select: { indexId: true, month: true, value: true },
    });

    const byMonth = new Map<number, Map<string, string>>();
    for (const v of values) {
      if (!byMonth.has(v.month)) byMonth.set(v.month, new Map());
      byMonth.get(v.month)!.set(v.indexId, v.value.toString());
    }

    const rows: IndexGridRow[] = MONTH_NAMES.map((monthName, i) => {
      const month = i + 1;
      const found = byMonth.get(month);
      const cells: Record<string, string | null> = {};
      for (const idx of indexes) cells[idx.id] = found?.get(idx.id) ?? null;
      return { month, monthName, values: cells };
    });

    return { year, indexes, rows };
  }

  /**
   * Saves a grid edit.
   *
   * A cell the user cleared is a deletion, not a zero — an index that genuinely
   * read 0.00 for a month and one that was never published must stay
   * distinguishable, because the first is data and the second is a gap. So a
   * null/empty value removes the row rather than writing zero.
   */
  async saveGrid(
    companyId: string,
    year: number,
    cells: { indexId: string; month: number; value?: number | string | null }[],
  ) {
    const cid = this.requireCompany(companyId);
    this.assertYear(year);
    if (!cells.length) return this.grid(cid, year);

    const indexIds = [...new Set(cells.map((c) => c.indexId))];
    const owned = await this.prisma.financialIndex.findMany({
      where: { id: { in: indexIds }, companyId: cid },
      select: { id: true },
    });
    if (owned.length !== indexIds.length) {
      throw new BadRequestException('One or more indexes do not belong to this company.');
    }

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const cell of cells) {
      if (!Number.isInteger(cell.month) || cell.month < 1 || cell.month > 12) {
        throw new BadRequestException(`Month ${cell.month} is out of range — expected 1-12.`);
      }

      const blank =
        cell.value === null || cell.value === undefined || String(cell.value).trim() === '';

      if (blank) {
        writes.push(
          this.prisma.financialIndexValue.deleteMany({
            where: { companyId: cid, indexId: cell.indexId, year, month: cell.month },
          }),
        );
        continue;
      }

      const numeric = Number(cell.value);
      if (!Number.isFinite(numeric)) {
        throw new BadRequestException(
          `"${cell.value}" is not a number (index ${cell.indexId}, month ${cell.month}).`,
        );
      }
      if (numeric < 0) {
        throw new BadRequestException('An index value cannot be negative.');
      }

      writes.push(
        this.prisma.financialIndexValue.upsert({
          where: {
            indexId_year_month: { indexId: cell.indexId, year, month: cell.month },
          },
          create: {
            companyId: cid,
            indexId: cell.indexId,
            year,
            month: cell.month,
            value: D(numeric),
          },
          update: { value: D(numeric) },
        }),
      );
    }

    // One transaction: a half-saved grid would leave the window showing values
    // the database never agreed to as a set.
    await this.prisma.$transaction(writes);
    return this.grid(cid, year);
  }

  /** Years that have at least one value, newest first — fills the year picker. */
  async years(companyId: string) {
    const cid = this.requireCompany(companyId);
    const rows = await this.prisma.financialIndexValue.findMany({
      where: { companyId: cid },
      distinct: ['year'],
      select: { year: true },
      orderBy: { year: 'desc' },
    });
    const years = rows.map((r) => r.year);
    const current = new Date().getUTCFullYear();
    // The current year is always offered, even before it has any values —
    // otherwise a fresh company has an empty picker and no way to start.
    if (!years.includes(current)) years.unshift(current);
    return years;
  }

  /** One index with its full value history, for the detail pane. */
  async history(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const index = await this.prisma.financialIndex.findFirst({
      where: { id, companyId: cid },
      include: {
        values: { orderBy: [{ year: 'desc' }, { month: 'asc' }] },
      },
    });
    if (!index) throw new NotFoundException('Index not found');
    return index;
  }

  private assertYear(year: number) {
    if (!Number.isInteger(year) || year < 1900 || year > 2999) {
      throw new BadRequestException(`Year ${year} is out of range.`);
    }
  }
}
