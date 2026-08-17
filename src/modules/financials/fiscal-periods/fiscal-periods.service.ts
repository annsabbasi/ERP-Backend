import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { FiscalPeriodStatus, Prisma, SubPeriodType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';
import { CreatePeriodDto, GeneratePeriodsDto } from './dto/fiscal-period.dto';

/** Which per-area lock a posting must satisfy. */
export type PostingArea = 'general' | 'sales' | 'purchasing' | 'inventory';

const AREA_FIELD: Record<PostingArea, 'generalStatus' | 'salesStatus' | 'purchasingStatus' | 'inventoryStatus'> = {
  general: 'generalStatus',
  sales: 'salesStatus',
  purchasing: 'purchasingStatus',
  inventory: 'inventoryStatus',
};

@Injectable()
export class FiscalPeriodsService extends TenantCrudService {
  protected readonly modelName = 'fiscalPeriod';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Posting period',
    orderBy: [{ startDate: 'asc' }],
    searchFields: ['name', 'displayName'],
    filterableFields: ['status', 'fiscalYear', 'parentId'],
    uniqueBy: ['name'],
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { children: true, journals: true } },
    },
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected beforeWrite(dto: Record<string, unknown>) {
    const out = super.beforeWrite(dto);
    for (const k of ['startDate', 'endDate', 'activeFrom', 'activeTo', 'dueDateFrom', 'dueDateTo']) {
      if (out[k]) out[k] = new Date(out[k] as string);
    }
    return out;
  }

  async create(companyId: string, dto: CreatePeriodDto) {
    const cid = this.requireCompany(companyId);
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    await this.assertNoOverlap(cid, start, end, dto.parentId ?? null, null);
    return super.create(cid, dto as unknown as Record<string, unknown>);
  }

  /**
   * Creates a fiscal year plus its sub-periods in one shot — the "Posting
   * Periods → New" flow, where picking a year and a sub-period type should not
   * mean typing twelve rows by hand.
   */
  async generate(companyId: string, dto: GeneratePeriodsDto) {
    const cid = this.requireCompany(companyId);
    const { fiscalYear, subPeriodType } = dto;
    // fiscalYearStart is 1-12; a year starting in April runs April..March.
    const company = await this.prisma.company.findUnique({
      where: { id: cid },
      select: { fiscalYearStart: true },
    });
    const startMonth = (dto.startMonth ?? company?.fiscalYearStart ?? 1) - 1;

    const yearStart = new Date(Date.UTC(fiscalYear, startMonth, 1));
    const yearEnd = new Date(Date.UTC(fiscalYear + 1, startMonth, 1));
    yearEnd.setUTCDate(yearEnd.getUTCDate() - 1);

    const existing = await this.prisma.fiscalPeriod.findFirst({
      where: { companyId: cid, name: String(fiscalYear) },
    });
    if (existing) {
      throw new ConflictException(`Fiscal year ${fiscalYear} already exists.`);
    }

    const spans = buildSpans(yearStart, subPeriodType, startMonth, fiscalYear);

    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.fiscalPeriod.create({
        data: {
          companyId: cid,
          name: String(fiscalYear),
          displayName: dto.displayName ?? `Fiscal Year ${fiscalYear}`,
          fiscalYear,
          subPeriodType: SubPeriodType.YEAR,
          startDate: yearStart,
          endDate: yearEnd,
          activeFrom: yearStart,
          activeTo: yearEnd,
        },
      });

      for (const s of spans) {
        await tx.fiscalPeriod.create({
          data: {
            companyId: cid,
            parentId: parent.id,
            name: s.name,
            displayName: s.label,
            fiscalYear,
            subPeriodType,
            startDate: s.start,
            endDate: s.end,
            activeFrom: s.start,
            activeTo: s.end,
            dueDateFrom: s.start,
            dueDateTo: s.end,
          },
        });
      }

      return tx.fiscalPeriod.findFirst({
        where: { id: parent.id },
        include: { children: { orderBy: { startDate: 'asc' } } },
      });
    });
  }

  /**
   * Resolves the period a posting date falls into, and refuses the posting when
   * that period is closed for the relevant area. Every posting routine funnels
   * through here so "you cannot post into a closed period" holds everywhere,
   * not just where someone remembered to check.
   */
  async resolveOpenPeriod(
    companyId: string,
    date: Date,
    area: PostingArea = 'general',
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const period = await client.fiscalPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
        // Sub-periods are what postings land in; the year row is a container.
        NOT: { subPeriodType: SubPeriodType.YEAR },
      },
      orderBy: { startDate: 'desc' },
    });

    const resolved =
      period ??
      (await client.fiscalPeriod.findFirst({
        where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
        orderBy: { startDate: 'desc' },
      }));

    if (!resolved) {
      throw new BadRequestException(
        `No posting period covers ${date.toISOString().slice(0, 10)}. ` +
          `Create one under Administration → System Initialization → Posting Periods.`,
      );
    }

    if (resolved.status === FiscalPeriodStatus.LOCKED) {
      throw new ConflictException(
        `Period "${resolved.name}" is locked; no postings of any kind are accepted.`,
      );
    }

    const areaStatus = resolved[AREA_FIELD[area]];
    if (areaStatus === FiscalPeriodStatus.CLOSED || areaStatus === FiscalPeriodStatus.LOCKED) {
      throw new ConflictException(
        `Period "${resolved.name}" is ${areaStatus.toLowerCase()} for ${area} postings.`,
      );
    }
    if (resolved.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException(`Period "${resolved.name}" is closed.`);
    }

    return resolved;
  }

  /** Changes the overall status, or one area's status, with the legal transitions enforced. */
  async setStatus(
    companyId: string,
    id: string,
    status: FiscalPeriodStatus,
    area?: PostingArea,
    userId?: string,
  ) {
    const cid = this.requireCompany(companyId);
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id, companyId: cid } });
    if (!period) throw new BadRequestException('Posting period not found');

    // LOCKED is terminal by design: it is the state auditors rely on to mean
    // "this period can never change again".
    if (period.status === FiscalPeriodStatus.LOCKED && status !== FiscalPeriodStatus.LOCKED) {
      throw new ConflictException(
        `Period "${period.name}" is locked and cannot be reopened.`,
      );
    }

    if (status === FiscalPeriodStatus.CLOSED || status === FiscalPeriodStatus.LOCKED) {
      const drafts = await this.prisma.journalEntry.count({
        where: { companyId: cid, periodId: id, status: 'DRAFT' },
      });
      if (drafts > 0) {
        throw new ConflictException(
          `Period "${period.name}" still has ${drafts} draft journal entr${drafts === 1 ? 'y' : 'ies'}. ` +
            `Post or delete them before closing.`,
        );
      }
    }

    const data: Prisma.FiscalPeriodUpdateInput = area
      ? { [AREA_FIELD[area]]: status }
      : {
          status,
          salesStatus: status,
          purchasingStatus: status,
          generalStatus: status,
          inventoryStatus: status,
          ...(status === FiscalPeriodStatus.CLOSED || status === FiscalPeriodStatus.LOCKED
            ? { closedAt: new Date(), closedById: userId ?? null }
            : { closedAt: null, closedById: null }),
        };

    return this.prisma.fiscalPeriod.update({ where: { id }, data });
  }

  async remove(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id, companyId: cid },
      include: { _count: { select: { journals: true, children: true } } },
    });
    if (!period) return super.remove(cid, id);

    if (period._count.journals > 0) {
      throw new ConflictException(
        `Period "${period.name}" has ${period._count.journals} journal entr${period._count.journals === 1 ? 'y' : 'ies'} and cannot be deleted.`,
      );
    }
    if (period._count.children > 0) {
      throw new ConflictException(
        `Period "${period.name}" has ${period._count.children} sub-period(s). Delete those first.`,
      );
    }
    return super.remove(cid, id);
  }

  private async assertNoOverlap(
    companyId: string,
    start: Date,
    end: Date,
    parentId: string | null,
    selfId: string | null,
  ) {
    // Only sibling sub-periods must be disjoint — a year legitimately spans its
    // own months, so the year row is excluded from the comparison.
    const clash = await this.prisma.fiscalPeriod.findFirst({
      where: {
        companyId,
        parentId,
        ...(selfId ? { NOT: { id: selfId } } : {}),
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { name: true, startDate: true, endDate: true },
    });
    if (clash) {
      throw new ConflictException(
        `That range overlaps period "${clash.name}" ` +
          `(${clash.startDate.toISOString().slice(0, 10)} → ${clash.endDate.toISOString().slice(0, 10)}).`,
      );
    }
  }
}

function buildSpans(
  yearStart: Date,
  type: SubPeriodType,
  startMonth: number,
  fiscalYear: number,
): { name: string; label: string; start: Date; end: Date }[] {
  const out: { name: string; label: string; start: Date; end: Date }[] = [];

  if (type === SubPeriodType.YEAR) return out;

  const step = type === SubPeriodType.QUARTERS ? 3 : 1;
  const count = type === SubPeriodType.QUARTERS ? 4 : 12;

  for (let i = 0; i < count; i++) {
    const start = new Date(Date.UTC(fiscalYear, startMonth + i * step, 1));
    const end = new Date(Date.UTC(fiscalYear, startMonth + (i + 1) * step, 1));
    end.setUTCDate(end.getUTCDate() - 1);
    const seq = String(i + 1).padStart(2, '0');
    out.push({
      name: type === SubPeriodType.QUARTERS ? `${fiscalYear}-Q${i + 1}` : `${fiscalYear}-${seq}`,
      label:
        type === SubPeriodType.QUARTERS
          ? `Q${i + 1} ${fiscalYear}`
          : start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ` ${start.getUTCFullYear()}`,
      start,
      end,
    });
  }
  return out;
}
