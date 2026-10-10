import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetClass,
  AssetTransactionType,
  BpCardType,
  DepreciationMethod,
  FixedAssetStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantCrudOptions,
  TenantCrudService,
} from '../../../common/crud/tenant-crud.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { FiscalPeriodsService } from '../fiscal-periods/fiscal-periods.service';
import { NumberingService } from '../../administration/numbering/numbering.service';
import type { JournalLineDto } from '../journal-entries/dto/journal-entry.dto';
import {
  AssetAreaParamsDto,
  CreateFixedAssetDto,
  DepreciationRunDto,
  UpdateFixedAssetDto,
} from './fixed-assets.dto';
import {
  companyCurrency,
  D,
  fiscalYearOf,
  lifeEndDate,
  lockAssets,
  monthsBetween,
  money,
  ZERO,
} from './fixed-assets.shared';
import { DEPRECIATION_METHODS } from './asset-setup.services';

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const REF = { select: { id: true, code: true, name: true } } as const;

/** The list shape: enough for the register and the header of the window. */
const LIST_INCLUDE = {
  assetClass: {
    select: {
      id: true,
      code: true,
      name: true,
      depreciationMethod: true,
      usefulLifeMonths: true,
      assetAccount: REF,
      accumulatedDepreciationAccount: REF,
      depreciationExpenseAccount: REF,
      clearingAccount: REF,
    },
  },
  areaValues: {
    include: {
      area: {
        select: {
          id: true,
          code: true,
          name: true,
          postsToGl: true,
          ordering: true,
          isActive: true,
        },
      },
    },
    orderBy: { area: { ordering: 'asc' } },
  },
  vendor: { select: { id: true, cardCode: true, cardName: true } },
  branch: { select: { id: true, code: true, name: true } },
  employee: { select: { id: true, employeeNumber: true, name: true } },
  technician: { select: { id: true, employeeNumber: true, name: true } },
  costCenter: REF,
  project: REF,
  distributionRule: REF,
} satisfies Prisma.FixedAssetInclude;

/**
 * The detail shape adds the asset's whole history (Fixed Assets → History and
 * Depreciation). Never truncated: the figures derived from it would undercount
 * (QA FA-1 B13).
 */
const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  transactions: {
    orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      area: { select: { id: true, code: true } },
      journalEntry: { select: { id: true, number: true, status: true } },
      capitalization: {
        select: { id: true, number: true, kind: true, status: true },
      },
    },
  },
  _count: { select: { capitalizationLines: true } },
} satisfies Prisma.FixedAssetInclude;

type AreaValueRow = Prisma.FixedAssetAreaValueGetPayload<{
  include: { area: true };
}>;

@Injectable()
export class FixedAssetsService extends TenantCrudService {
  protected readonly modelName = 'fixedAsset';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Fixed asset',
    orderBy: { code: 'asc' },
    searchFields: [
      'code',
      'name',
      'foreignName',
      'serialNumber',
      'inventoryNo',
      'barCode',
    ],
    filterableFields: ['status', 'assetClassId', 'isActive', 'branchId'],
    uniqueBy: ['code'],
    include: LIST_INCLUDE,
  };

  constructor(
    prisma: PrismaService,
    private readonly journals: JournalEntriesService,
    private readonly periods: FiscalPeriodsService,
    private readonly numbering: NumberingService,
  ) {
    super(prisma);
  }

  /**
   * The asset with its history, plus what the window derives from it: per
   * area the life's end date and the months not yet depreciated, and whether
   * the asset may still be deleted (FA-D10) or edited freely (FA-D5).
   */
  async findOne(companyId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, companyId },
      include: DETAIL_INCLUDE,
    });
    if (!asset) throw new NotFoundException(`Fixed asset ${id} not found`);

    const areaValues = asset.areaValues.map((v) => {
      const depreciated = asset.transactions.filter(
        (t) =>
          t.areaId === v.areaId && t.type === AssetTransactionType.DEPRECIATION,
      );
      const lastDepreciation = depreciated.length
        ? depreciated[depreciated.length - 1].postingDate
        : null;
      const used =
        v.depreciationStartDate && lastDepreciation
          ? Math.max(0, monthsBetween(v.depreciationStartDate, lastDepreciation))
          : 0;
      return {
        ...v,
        endDate: v.depreciationStartDate
          ? lifeEndDate(v.depreciationStartDate, v.usefulLifeMonths)
          : null,
        remainingLifeMonths: Math.max(0, v.usefulLifeMonths - used),
        lastDepreciationDate: lastDepreciation,
      };
    });
    return {
      ...asset,
      areaValues,
      // Class, code and depreciation parameters are fixed once the asset is
      // capitalized; the window renders them read-only.
      locked: asset.status !== FixedAssetStatus.NEW,
      deletable:
        asset.status === FixedAssetStatus.NEW &&
        asset.transactions.length === 0 &&
        asset._count.capitalizationLines === 0,
    };
  }

  // ── Master data ─────────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateFixedAssetDto) {
    const assetClass = await this.requireClass(companyId, dto.assetClassId);
    this.assertOneCostObject(dto.costCenterId, dto.distributionRuleId);
    await this.validateReferences(companyId, dto);
    const areas = await this.prisma.depreciationArea.findMany({
      where: { companyId, isActive: true },
    });
    if (!areas.length) {
      throw new BadRequestException(
        'This company has no active depreciation area. Set one up under Administration → Setup → Financials → ' +
          'Fixed Assets → Depreciation Areas.',
      );
    }
    const params = this.paramsByArea(
      dto.areas,
      areas.map((a) => a.id),
    );

    let code = dto.code?.trim() ?? '';
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        if (!code) {
          code = (
            await this.numbering.allocate(
              tx,
              companyId,
              'fixed_asset',
              dto.seriesId ?? null,
            )
          ).number;
        }
        const asset = await tx.fixedAsset.create({
          data: {
            companyId,
            code,
            name: dto.name.trim(),
            foreignName: dto.foreignName?.trim() || null,
            assetClassId: assetClass.id,
            isActive: dto.isActive ?? true,
            ...this.masterFields(dto),
          },
          select: { id: true },
        });
        await tx.fixedAssetAreaValue.createMany({
          data: areas.map((area) => {
            const p = params.get(area.id);
            return {
              companyId,
              assetId: asset.id,
              areaId: area.id,
              depreciationMethod:
                p?.depreciationMethod ?? assetClass.depreciationMethod,
              usefulLifeMonths:
                p?.usefulLifeMonths ?? assetClass.usefulLifeMonths,
              depreciationStartDate: p?.depreciationStartDate
                ? new Date(p.depreciationStartDate)
                : null,
              salvageValue: D(p?.salvageValue ?? 0),
            };
          }),
        });
        return asset.id;
      }, TX_OPTIONS);
      return this.findOne(companyId, id);
    } catch (e) {
      throw this.translateAssetError(e, code, dto);
    }
  }

  async update(companyId: string, id: string, dto: UpdateFixedAssetDto) {
    const asset = await this.findOne(companyId, id);
    const hasHistory = asset.transactions.length > 0;
    if (dto.seriesId !== undefined) {
      throw new BadRequestException(
        'The numbering series only applies when an asset is created.',
      );
    }
    if (
      dto.code !== undefined &&
      dto.code.trim() !== asset.code &&
      (asset.locked || hasHistory)
    ) {
      throw new ConflictException(
        `Asset ${asset.code} has been capitalized, so its number can no longer change.`,
      );
    }
    let newClass: AssetClass | null = null;
    if (
      dto.assetClassId !== undefined &&
      dto.assetClassId !== asset.assetClassId
    ) {
      // The class decides the accounts. Once anything posted, the values are in
      // the old class's accounts; a Transfer moves them, a re-label does not.
      if (asset.locked || hasHistory) {
        throw new ConflictException(
          `Asset ${asset.code} already has postings, so its asset class can no longer change.`,
        );
      }
      newClass = await this.requireClass(companyId, dto.assetClassId);
    }
    this.assertOneCostObject(
      dto.costCenterId !== undefined ? dto.costCenterId : asset.costCenterId,
      dto.distributionRuleId !== undefined
        ? dto.distributionRuleId
        : asset.distributionRuleId,
    );
    await this.validateReferences(companyId, dto);

    const areaParams = this.paramsByArea(
      dto.areas,
      asset.areaValues.map((v) => v.areaId),
    );
    for (const [areaId, p] of areaParams) {
      const value = asset.areaValues.find((v) => v.areaId === areaId)!;
      const changes =
        (p.depreciationMethod !== undefined &&
          p.depreciationMethod !== value.depreciationMethod) ||
        (p.usefulLifeMonths !== undefined &&
          p.usefulLifeMonths !== value.usefulLifeMonths) ||
        (p.salvageValue !== undefined &&
          !D(p.salvageValue).equals(value.salvageValue)) ||
        (p.depreciationStartDate !== undefined &&
          (value.depreciationStartDate?.toISOString().slice(0, 10) ?? '') !==
            (p.depreciationStartDate ?? '').slice(0, 10));
      if (changes && asset.locked) {
        // FA-D5: the parameters are copied from the class and stay editable
        // until the first capitalization. The depreciation run computes a
        // cumulative target from them, so a later change would rewrite history.
        throw new ConflictException(
          `Asset ${asset.code} has been capitalized; its depreciation parameters in area ${value.area.code} are locked.`,
        );
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.fixedAsset.update({
          where: { id },
          data: {
            ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.foreignName !== undefined
              ? { foreignName: dto.foreignName.trim() || null }
              : {}),
            ...(newClass ? { assetClassId: newClass.id } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...this.masterFields(dto),
          },
        });
        for (const v of asset.areaValues) {
          const p = areaParams.get(v.areaId);
          // A new class re-copies its defaults; explicit values on this request win.
          const method =
            p?.depreciationMethod ?? newClass?.depreciationMethod ?? undefined;
          const life =
            p?.usefulLifeMonths ?? newClass?.usefulLifeMonths ?? undefined;
          if (!p && !newClass) continue;
          await tx.fixedAssetAreaValue.update({
            where: { assetId_areaId: { assetId: id, areaId: v.areaId } },
            data: {
              ...(method !== undefined ? { depreciationMethod: method } : {}),
              ...(life !== undefined ? { usefulLifeMonths: life } : {}),
              ...(p?.salvageValue !== undefined
                ? { salvageValue: D(p.salvageValue) }
                : {}),
              ...(p?.depreciationStartDate !== undefined
                ? {
                    depreciationStartDate: p.depreciationStartDate
                      ? new Date(p.depreciationStartDate)
                      : null,
                  }
                : {}),
            },
          });
        }
      }, TX_OPTIONS);
    } catch (e) {
      throw this.translateAssetError(e, dto.code?.trim() ?? asset.code, dto);
    }
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    const asset = await this.findOne(companyId, id);
    if (!asset.deletable) {
      throw new ConflictException(
        `Asset ${asset.code} has postings (capitalization or depreciation) and cannot be deleted. Deactivate it instead.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.fixedAssetAreaValue.deleteMany({
        where: { companyId, assetId: id },
      });
      await tx.fixedAsset.delete({ where: { id } });
    });
    return { id, message: `Fixed asset ${asset.code} deleted` };
  }

  // ── Fixed Assets → Values: the asset's figures per fiscal year ──────────────
  /**
   * One row per fiscal year and area, from the first movement to the current
   * year, aggregated over every transaction of the asset (B13). Columns for
   * movements that are not built yet (retirement, transfer, write-up) are
   * there and read 0.00 until they are.
   */
  async values(companyId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        areaValues: {
          include: {
            area: { select: { id: true, code: true, name: true, postsToGl: true } },
          },
          orderBy: { area: { ordering: 'asc' } },
        },
      },
    });
    if (!asset) throw new NotFoundException(`Fixed asset ${id} not found`);
    const [moves, company] = await Promise.all([
      this.prisma.fixedAssetTransaction.findMany({
        where: { companyId, assetId: id },
        select: { areaId: true, type: true, postingDate: true, amount: true },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { fiscalYearStart: true },
      }),
    ]);
    const fiscalYear = (d: Date) => fiscalYearOf(d, company?.fiscalYearStart);
    const thisYear = fiscalYear(new Date());

    return asset.areaValues.map((v) => {
      const own = moves.filter((t) => t.areaId === v.areaId);
      const firstYear = own.length
        ? Math.min(...own.map((t) => fiscalYear(t.postingDate)))
        : thisYear;
      const lastYear = Math.max(
        thisYear,
        ...own.map((t) => fiscalYear(t.postingDate)),
      );
      const years: Record<string, string | number>[] = [];
      let apc = ZERO;
      let accumulated = ZERO;
      for (let y = firstYear; y <= lastYear; y++) {
        const inYear = own.filter((t) => fiscalYear(t.postingDate) === y);
        const sum = (...types: AssetTransactionType[]) =>
          inYear
            .filter((t) => types.includes(t.type))
            .reduce((s, t) => s.plus(t.amount), ZERO);
        // Acquisition is net of capitalization credit memos, as in SAP's Values tab.
        const acquisition = sum(
          AssetTransactionType.CAPITALIZATION,
          AssetTransactionType.CAPITALIZATION_CREDIT_MEMO,
        );
        const retirement = sum(AssetTransactionType.RETIREMENT);
        const transfer = sum(AssetTransactionType.TRANSFER);
        const writeUp = sum(AssetTransactionType.REVALUATION);
        const ordinary = sum(AssetTransactionType.DEPRECIATION);
        const unplanned = sum(AssetTransactionType.MANUAL_DEPRECIATION);
        const apcFirstDay = apc;
        apc = apc.plus(acquisition).plus(retirement).plus(transfer).plus(writeUp);
        accumulated = accumulated.plus(ordinary).plus(unplanned);
        years.push({
          fiscalYear: y,
          apcFirstDay: apcFirstDay.toFixed(2),
          acquisition: acquisition.toFixed(2),
          retirement: retirement.toFixed(2),
          transfer: transfer.toFixed(2),
          writeUp: writeUp.toFixed(2),
          ordinaryDepreciation: ordinary.toFixed(2),
          unplannedDepreciation: unplanned.toFixed(2),
          apcLastDay: apc.toFixed(2),
          accumulatedLastDay: accumulated.toFixed(2),
          nbvLastDay: apc.minus(accumulated).toFixed(2),
        });
      }
      return { area: v.area, years };
    });
  }

  /**
   * Asset Depreciation Forecast: the planned charge for each month after the
   * last posted one, in one area (the posting area unless one is named). Each
   * row is dated at the end of the month in which that depreciation month is
   * complete, which is when a period-end run first charges it.
   */
  async forecast(companyId: string, id: string, months = 12, areaId?: string) {
    const asset = await this.findOne(companyId, id);
    const value =
      asset.areaValues.find((v) =>
        areaId ? v.areaId === areaId : v.area.postsToGl,
      ) ?? asset.areaValues[0];
    const base = {
      assetId: id,
      code: asset.code,
      name: asset.name,
      area: value?.area ?? null,
    };
    if (
      !value ||
      !value.depreciationStartDate ||
      value.acquisitionCost.lte(ZERO) ||
      value.depreciationMethod === DepreciationMethod.NONE
    )
      return { ...base, rows: [] };

    const start = value.depreciationStartDate;
    const depreciable = value.acquisitionCost.minus(value.salvageValue);
    const life = value.usefulLifeMonths;
    const done = life - value.remainingLifeMonths;
    const rows: {
      month: number;
      date: string;
      charge: string;
      accumulated: string;
      netBookValue: string;
    }[] = [];
    let prev = value.accumulatedDepreciation;
    for (let i = 1; i <= Math.min(months, 600) && done + i <= life; i++) {
      const m = done + i;
      const cum = Prisma.Decimal.min(
        cumulativeDepreciation(value.depreciationMethod, depreciable, life, m),
        depreciable,
      );
      const complete = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, start.getUTCDate()),
      );
      const periodEnd = new Date(
        Date.UTC(complete.getUTCFullYear(), complete.getUTCMonth() + 1, 0),
      );
      const charge = Prisma.Decimal.max(cum.minus(prev), ZERO);
      rows.push({
        month: m,
        date: periodEnd.toISOString().slice(0, 10),
        charge: charge.toFixed(2),
        accumulated: Prisma.Decimal.max(cum, prev).toFixed(2),
        netBookValue: value.acquisitionCost
          .minus(Prisma.Decimal.max(cum, prev))
          .toFixed(2),
      });
      prev = Prisma.Decimal.max(cum, prev);
    }
    return { ...base, rows };
  }

  /**
   * Depreciation run over capitalized assets (or a chosen subset), per area.
   *
   * Each area is depreciated up to `postingDate` from its Depreciation Start
   * Date — the first capitalization's asset value date (FA-D7) — as a
   * cumulative target minus what is already booked, so a skipped or repeated
   * run self-corrects instead of compounding. A month counts once its
   * day-of-month is reached. The posting area's charge goes to the G/L: debit
   * the class's depreciation expense (with the asset's cost center or
   * distribution rule, and project), credit its accumulated depreciation.
   * Statistical areas are valued only. Each asset is one transaction, under
   * its row lock and recomputed inside it, so two runs at once cannot both
   * book the same charge.
   */
  async depreciationRun(
    companyId: string,
    userId: string,
    dto: DepreciationRunDto,
  ) {
    const postingDate = new Date(dto.postingDate);
    const assets = await this.prisma.fixedAsset.findMany({
      where: {
        companyId,
        status: FixedAssetStatus.CAPITALIZED,
        ...(dto.assetIds?.length ? { id: { in: dto.assetIds } } : {}),
      },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    let currency: string | null = null;
    if (!dto.dryRun) {
      // Refuse the whole run up front rather than post some assets and fail
      // on the first one that needs a journal entry.
      await this.periods.resolveOpenPeriod(companyId, postingDate, 'general');
      currency = await companyCurrency(this.prisma, companyId);
    }

    type Row = {
      assetId: string;
      code: string;
      name: string;
      area: string;
      charge: string;
      accumulated: string;
      netBookValue: string;
      posted: boolean;
    };
    const results: Row[] = [];

    for (const { id } of assets) {
      const work = async (tx: Prisma.TransactionClient): Promise<Row[]> => {
        if (!dto.dryRun) await lockAssets(tx, companyId, [id]);
        const a = await tx.fixedAsset.findUniqueOrThrow({
          where: { id },
          include: {
            assetClass: true,
            areaValues: { include: { area: true } },
          },
        });
        const charges = a.areaValues
          .map((v) => ({ v, charge: this.chargeUpTo(v, postingDate) }))
          .filter((c) => c.charge.gt(ZERO));
        if (!charges.length) return [];

        let journalEntryId: string | null = null;
        const posting = charges.find((c) => c.v.area.postsToGl);
        if (!dto.dryRun && posting) {
          const lines: JournalLineDto[] = [
            {
              accountId: a.assetClass.depreciationExpenseAccountId,
              debit: money(posting.charge),
              description: `Depreciation — ${a.code} ${a.name}`,
              costCenterId: a.costCenterId ?? undefined,
              distributionRuleId: a.distributionRuleId ?? undefined,
              projectId: a.projectId ?? undefined,
            },
            {
              accountId: a.assetClass.accumulatedDepreciationAccountId,
              credit: money(posting.charge),
              description: `Accumulated depreciation — ${a.code}`,
            },
          ];
          const entry = await this.journals.postFromSource(
            tx,
            companyId,
            userId,
            {
              date: postingDate,
              source: 'fixed_asset_depreciation',
              sourceId: a.id,
              description: `Depreciation — ${a.code} ${a.name}`,
              reference: a.code,
              currency: currency!,
              lines,
            },
          );
          journalEntryId = entry.id;
        }

        const out: Row[] = [];
        for (const { v, charge } of charges) {
          const accumulated = v.accumulatedDepreciation.plus(charge);
          const nbv = v.acquisitionCost.minus(accumulated);
          if (!dto.dryRun) {
            await tx.fixedAssetAreaValue.update({
              where: { id: v.id },
              data: { accumulatedDepreciation: accumulated, netBookValue: nbv },
            });
            await tx.fixedAssetTransaction.create({
              data: {
                companyId,
                assetId: a.id,
                areaId: v.areaId,
                type: AssetTransactionType.DEPRECIATION,
                postingDate,
                amount: charge,
                journalEntryId: v.area.postsToGl ? journalEntryId : null,
              },
            });
          }
          out.push({
            assetId: a.id,
            code: a.code,
            name: a.name,
            area: v.area.code,
            charge: charge.toFixed(2),
            accumulated: accumulated.toFixed(2),
            netBookValue: nbv.toFixed(2),
            posted: !dto.dryRun && v.area.postsToGl,
          });
        }
        return out;
      };
      results.push(
        ...(dto.dryRun
          ? await work(this.prisma)
          : await this.prisma.$transaction(work, TX_OPTIONS)),
      );
    }

    return {
      postingDate: postingDate.toISOString().slice(0, 10),
      dryRun: !!dto.dryRun,
      assetsProcessed: new Set(results.map((r) => r.assetId)).size,
      totalPosted: results
        .filter((r) => r.posted)
        .reduce((s, r) => s.plus(D(r.charge)), ZERO)
        .toFixed(2),
      results,
    };
  }

  /**
   * Retirement is a module of its own (scrapping vs. sale, gain or loss, the
   * accumulated depreciation cleared) and arrives with FA-3. The old endpoint
   * only flipped a status and left the asset's value in the G/L, so it is
   * refused rather than letting it corrupt the ledger (QA FA-1 B10).
   */
  retire(): never {
    throw new ConflictException(
      'Retirement is not available yet. A capitalization credit memo reverses an acquisition in the meantime.',
    );
  }

  // ── Lookups for Asset Master Data ───────────────────────────────────────────
  async lookups(companyId: string) {
    const [
      assetClasses,
      depreciationAreas,
      vendors,
      branches,
      employees,
      costCenters,
      projects,
      distributionRules,
      series,
      periods,
      company,
    ] = await Promise.all([
      this.prisma.assetClass.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          depreciationMethod: true,
          usefulLifeMonths: true,
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.depreciationArea.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          postsToGl: true,
          ordering: true,
        },
        orderBy: [{ ordering: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.businessPartner.findMany({
        where: { companyId, cardType: BpCardType.VENDOR, isActive: true },
        select: { id: true, cardCode: true, cardName: true },
        orderBy: { cardName: 'asc' },
        take: 2000,
      }),
      this.prisma.branch.findMany({
        where: { companyId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.employee.findMany({
        where: { companyId, isActive: true, deletedAt: null },
        select: { id: true, employeeNumber: true, name: true },
        orderBy: { name: 'asc' },
        take: 5000,
      }),
      this.prisma.costCenter.findMany({
        where: { companyId, isActive: true },
        select: REF.select,
        orderBy: { code: 'asc' },
      }),
      this.prisma.financeProject.findMany({
        where: { companyId, isActive: true },
        select: REF.select,
        orderBy: { code: 'asc' },
      }),
      this.prisma.distributionRule.findMany({
        where: { companyId, isActive: true },
        select: REF.select,
        orderBy: { code: 'asc' },
      }),
      this.prisma.numberingSeries.findMany({
        where: { companyId, documentType: 'fixed_asset', isLocked: false },
        select: {
          id: true,
          name: true,
          prefix: true,
          nextNumber: true,
          digits: true,
          isDefault: true,
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.fiscalPeriod.findMany({
        where: { companyId },
        select: { fiscalYear: true, startDate: true },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { currency: true, fiscalYearStart: true },
      }),
    ]);
    // Fiscal years from Posting Periods, plus the current one so the Overview
    // always has a year to show.
    const years = new Set<number>(
      periods.map(
        (p) =>
          p.fiscalYear ?? fiscalYearOf(p.startDate, company?.fiscalYearStart),
      ),
    );
    const currentFiscalYear = fiscalYearOf(
      new Date(),
      company?.fiscalYearStart,
    );
    years.add(currentFiscalYear);
    return {
      assetClasses,
      depreciationAreas,
      vendors,
      branches,
      employees,
      costCenters,
      projects,
      distributionRules,
      series,
      fiscalYears: [...years].sort((a, b) => a - b),
      currentFiscalYear,
      currency: company?.currency ?? null,
      depreciationMethods: DEPRECIATION_METHODS,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  /** What the run would charge in one area up to `postingDate` (≤ 0 = nothing). */
  private chargeUpTo(v: AreaValueRow, postingDate: Date): Prisma.Decimal {
    if (!v.area.isActive || v.depreciationMethod === DepreciationMethod.NONE)
      return ZERO;
    if (!v.depreciationStartDate || v.acquisitionCost.lte(ZERO)) return ZERO;
    // A month counts once its day-of-month is reached: from 1 Sep, a run on
    // 31 Oct charges one month (QA FA-1 T2).
    const months = monthsBetween(v.depreciationStartDate, postingDate);
    if (months <= 0) return ZERO;
    const depreciable = v.acquisitionCost.minus(v.salvageValue);
    if (depreciable.lte(ZERO)) return ZERO;
    const target = cumulativeDepreciation(
      v.depreciationMethod,
      depreciable,
      v.usefulLifeMonths,
      Math.min(months, v.usefulLifeMonths),
    );
    // Never past the depreciable base.
    return Prisma.Decimal.min(target, depreciable).minus(
      v.accumulatedDepreciation,
    );
  }

  private paramsByArea(
    areas: AssetAreaParamsDto[] | undefined,
    allowed: string[],
  ) {
    const map = new Map<string, AssetAreaParamsDto>();
    for (const p of areas ?? []) {
      if (!allowed.includes(p.areaId)) {
        throw new BadRequestException(
          'A depreciation area on this asset does not exist or is not active.',
        );
      }
      if (map.has(p.areaId))
        throw new BadRequestException(
          'The same depreciation area is listed twice.',
        );
      map.set(p.areaId, p);
    }
    return map;
  }

  private async requireClass(companyId: string, assetClassId: string) {
    const cls = await this.prisma.assetClass.findFirst({
      where: { id: assetClassId, companyId },
    });
    if (!cls)
      throw new BadRequestException(
        'The asset class does not exist in this company.',
      );
    if (!cls.isActive)
      throw new BadRequestException(`Asset class ${cls.code} is inactive.`);
    return cls;
  }

  /** The same rule as on journal lines: a cost center or a distribution rule, not both. */
  private assertOneCostObject(
    costCenterId: string | null | undefined,
    distributionRuleId: string | null | undefined,
  ) {
    if (costCenterId && distributionRuleId) {
      throw new BadRequestException(
        'Choose a cost center or a distribution rule for this asset, not both.',
      );
    }
  }

  /** A duplicate asset number is named, whether it was typed or came from a series. */
  private translateAssetError(
    e: unknown,
    code: string,
    dto: Partial<CreateFixedAssetDto>,
  ): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      ((e.meta?.target as string[] | undefined) ?? []).includes('code')
    ) {
      return new ConflictException(`${code} already exists.`);
    }
    return this.translatePrismaError(
      e,
      dto as unknown as Record<string, unknown>,
    );
  }

  /**
   * Every reference is checked against this company first, for a clear
   * message; the composite foreign keys refuse another tenant's id anyway.
   */
  private async validateReferences(
    companyId: string,
    dto: Partial<CreateFixedAssetDto>,
  ) {
    const checks: Promise<void>[] = [];
    const need = (found: Promise<unknown>, message: string) =>
      checks.push(
        found.then((r) => {
          if (!r) throw new BadRequestException(message);
        }),
      );

    if (dto.vendorId) {
      checks.push(
        this.prisma.businessPartner
          .findFirst({
            where: { id: dto.vendorId, companyId },
            select: { cardType: true, cardName: true, isActive: true },
          })
          .then((bp) => {
            if (!bp)
              throw new BadRequestException(
                'The preferred vendor does not exist in this company.',
              );
            if (bp.cardType !== BpCardType.VENDOR)
              throw new BadRequestException(`${bp.cardName} is not a vendor.`);
            if (!bp.isActive)
              throw new BadRequestException(
                `Vendor ${bp.cardName} is inactive.`,
              );
          }),
      );
    }
    if (dto.branchId)
      need(
        this.prisma.branch.findFirst({
          where: { id: dto.branchId, companyId },
        }),
        'The location (branch) does not exist in this company.',
      );
    if (dto.employeeId)
      need(
        this.prisma.employee.findFirst({
          where: { id: dto.employeeId, companyId, deletedAt: null },
        }),
        'The employee does not exist in this company.',
      );
    if (dto.technicianId)
      need(
        this.prisma.employee.findFirst({
          where: { id: dto.technicianId, companyId, deletedAt: null },
        }),
        'The technician does not exist in this company.',
      );
    if (dto.costCenterId)
      need(
        this.prisma.costCenter.findFirst({
          where: { id: dto.costCenterId, companyId },
        }),
        'The cost center does not exist in this company.',
      );
    if (dto.projectId)
      need(
        this.prisma.financeProject.findFirst({
          where: { id: dto.projectId, companyId },
        }),
        'The project does not exist in this company.',
      );
    if (dto.distributionRuleId)
      need(
        this.prisma.distributionRule.findFirst({
          where: { id: dto.distributionRuleId, companyId },
        }),
        'The distribution rule does not exist in this company.',
      );
    if (dto.seriesId)
      need(
        this.prisma.numberingSeries.findFirst({
          where: { id: dto.seriesId, companyId, documentType: 'fixed_asset' },
        }),
        'The numbering series is not a fixed asset series of this company.',
      );
    await Promise.all(checks);
  }

  /** The plain master fields: '' → null, dates parsed, absent keys left out. */
  private masterFields(dto: Partial<CreateFixedAssetDto>) {
    const text = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() || null;
    const ref = (v: string | undefined) =>
      v === undefined ? undefined : v || null;
    const vendorId = ref(dto.vendorId);
    const out: Record<string, unknown> = {
      barCode: text(dto.barCode),
      manufacturer: text(dto.manufacturer),
      additionalIdentifier: text(dto.additionalIdentifier),
      serialNumber: text(dto.serialNumber),
      inventoryNo: text(dto.inventoryNo),
      mfrCatalogNo: text(dto.mfrCatalogNo),
      remarks: text(dto.remarks),
      vendorId,
      // Part of the vendor foreign key: the database itself refuses a
      // business partner that is not a vendor.
      vendorCardType:
        vendorId === undefined ? undefined : vendorId ? BpCardType.VENDOR : null,
      branchId: ref(dto.branchId),
      employeeId: ref(dto.employeeId),
      technicianId: ref(dto.technicianId),
      costCenterId: ref(dto.costCenterId),
      projectId: ref(dto.projectId),
      distributionRuleId: ref(dto.distributionRuleId),
      purchaseDate:
        dto.purchaseDate === undefined
          ? undefined
          : dto.purchaseDate
            ? new Date(dto.purchaseDate)
            : null,
      // null clears it; a missing key leaves it as it is.
      purchaseCost:
        dto.purchaseCost === undefined
          ? undefined
          : dto.purchaseCost === null
            ? null
            : D(dto.purchaseCost),
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }
}

/**
 * Cumulative depreciation after `months` of a `lifeMonths` life. Declining
 * balance is double-declining applied monthly, with the last month taking the
 * remainder; sum-of-years uses the digit weighting. All cumulative, so callers
 * stay idempotent.
 */
export function cumulativeDepreciation(
  method: DepreciationMethod,
  depreciable: Prisma.Decimal,
  lifeMonths: number,
  months: number,
): Prisma.Decimal {
  if (months <= 0 || lifeMonths <= 0) return ZERO;
  const m = Math.min(months, lifeMonths);
  switch (method) {
    case DepreciationMethod.IMMEDIATE:
      return depreciable;
    case DepreciationMethod.STRAIGHT_LINE:
      return depreciable.times(m).dividedBy(lifeMonths).toDecimalPlaces(2);
    case DepreciationMethod.DECLINING_BALANCE: {
      const rate = new Prisma.Decimal(2).dividedBy(lifeMonths);
      let remaining = depreciable;
      let cum = ZERO;
      for (let i = 0; i < m; i++) {
        const charge =
          i === lifeMonths - 1
            ? remaining
            : remaining.times(rate).toDecimalPlaces(2);
        cum = cum.plus(charge);
        remaining = remaining.minus(charge);
      }
      return Prisma.Decimal.min(cum, depreciable);
    }
    case DepreciationMethod.SUM_OF_YEARS: {
      const total = (lifeMonths * (lifeMonths + 1)) / 2;
      const used = (m * (2 * lifeMonths - m + 1)) / 2;
      return depreciable.times(used).dividedBy(total).toDecimalPlaces(2);
    }
    default:
      return ZERO;
  }
}
