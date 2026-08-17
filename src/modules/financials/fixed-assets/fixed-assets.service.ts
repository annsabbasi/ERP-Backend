import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  AssetTransactionType,
  DepreciationMethod,
  FixedAssetStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CapitalizeAssetDto, DepreciationRunDto } from '../setup/setup.dto';

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);
const ZERO = new Prisma.Decimal(0);

@Injectable()
export class FixedAssetsService extends TenantCrudService {
  protected readonly modelName = 'fixedAsset';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Fixed asset',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name', 'serialNumber'],
    filterableFields: ['status', 'assetClass', 'depreciationMethod'],
    uniqueBy: ['code'],
    include: {
      costAccount: { select: { id: true, code: true, name: true } },
      depreciationAccount: { select: { id: true, code: true, name: true } },
      accumulatedAccount: { select: { id: true, code: true, name: true } },
      transactions: { orderBy: { postingDate: 'desc' as const }, take: 20 },
    },
  };

  constructor(
    prisma: PrismaService,
    private readonly journals: JournalEntriesService,
  ) {
    super(prisma);
  }

  /**
   * Capitalization: the asset enters service. Posts
   *   Dr asset cost account / Cr clearing (the credit side comes from the
   *   determination the caller already chose on the asset).
   */
  async capitalize(companyId: string, id: string, userId: string, dto: CapitalizeAssetDto) {
    const asset = (await this.findOne(companyId, id)) as unknown as {
      id: string; code: string; name: string; status: FixedAssetStatus;
      acquisitionCost: Prisma.Decimal; salvageValue: Prisma.Decimal;
      costAccountId: string | null; accumulatedAccountId: string | null;
      currency: string;
    };

    if (asset.status === FixedAssetStatus.CAPITALIZED) {
      throw new ConflictException(`Asset ${asset.code} is already capitalized.`);
    }
    if (asset.status === FixedAssetStatus.RETIRED || asset.status === FixedAssetStatus.SOLD) {
      throw new ConflictException(`Asset ${asset.code} is ${asset.status.toLowerCase()}.`);
    }

    const amount = D(dto.amount);
    const postingDate = new Date(dto.postingDate);

    return this.prisma.$transaction(async (tx) => {
      let journalEntryId: string | null = null;

      // Only post to the GL when both sides are configured; otherwise record
      // the asset movement and let finance wire the accounts up later.
      if (asset.costAccountId && asset.accumulatedAccountId) {
        const entry = await this.journals.postFromSource(tx, companyId, userId, {
          date: postingDate,
          source: 'fixed_asset_capitalization',
          sourceId: asset.id,
          description: `Capitalization — ${asset.code} ${asset.name}`,
          currency: asset.currency,
          lines: [
            { accountId: asset.costAccountId, debit: Number(amount) },
            { accountId: asset.accumulatedAccountId, credit: Number(amount) },
          ],
        });
        journalEntryId = entry.id;
      }

      await tx.fixedAssetTransaction.create({
        data: {
          assetId: asset.id,
          type: AssetTransactionType.CAPITALIZATION,
          postingDate,
          amount,
          journalEntryId,
          remarks: dto.remarks ?? null,
        },
      });

      return tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          status: FixedAssetStatus.CAPITALIZED,
          capitalizedAt: postingDate,
          acquisitionCost: amount,
          netBookValue: amount,
        },
      });
    });
  }

  /**
   * Depreciation run over every capitalized asset (or a chosen subset).
   *
   * Each asset is depreciated up to `postingDate` based on months elapsed since
   * capitalization, minus whatever has already been booked. Working from the
   * cumulative target rather than "one period's worth" means a run that was
   * skipped or ran twice self-corrects instead of compounding the error.
   */
  async depreciationRun(companyId: string, userId: string, dto: DepreciationRunDto) {
    const postingDate = new Date(dto.postingDate);

    const assets = await this.prisma.fixedAsset.findMany({
      where: {
        companyId,
        status: FixedAssetStatus.CAPITALIZED,
        depreciationMethod: { not: DepreciationMethod.NONE },
        ...(dto.assetIds?.length ? { id: { in: dto.assetIds } } : {}),
      },
    });

    const results: {
      assetId: string; code: string; name: string;
      charge: string; accumulated: string; netBookValue: string;
      posted: boolean; note?: string;
    }[] = [];

    for (const a of assets) {
      if (!a.capitalizedAt) continue;

      const monthsElapsed = monthsBetween(a.capitalizedAt, postingDate);
      if (monthsElapsed <= 0) continue;

      const depreciable = a.acquisitionCost.minus(a.salvageValue);
      if (depreciable.lte(ZERO)) continue;

      const target = this.cumulativeDepreciation(
        a.depreciationMethod,
        depreciable,
        a.usefulLifeMonths,
        Math.min(monthsElapsed, a.usefulLifeMonths),
      );

      const charge = target.minus(a.accumulatedDepreciation);
      if (charge.lte(ZERO)) continue;

      const accumulated = a.accumulatedDepreciation.plus(charge);
      const nbv = a.acquisitionCost.minus(accumulated);

      if (dto.dryRun) {
        results.push({
          assetId: a.id, code: a.code, name: a.name,
          charge: charge.toFixed(2),
          accumulated: accumulated.toFixed(2),
          netBookValue: nbv.toFixed(2),
          posted: false,
        });
        continue;
      }

      const canPost = !!(a.depreciationAccountId && a.accumulatedAccountId);

      await this.prisma.$transaction(async (tx) => {
        let journalEntryId: string | null = null;
        if (canPost) {
          const entry = await this.journals.postFromSource(tx, companyId, userId, {
            date: postingDate,
            source: 'fixed_asset_depreciation',
            sourceId: a.id,
            description: `Depreciation — ${a.code} ${a.name}`,
            currency: a.currency,
            lines: [
              { accountId: a.depreciationAccountId!, debit: Number(charge) },
              { accountId: a.accumulatedAccountId!, credit: Number(charge) },
            ],
          });
          journalEntryId = entry.id;
        }

        await tx.fixedAssetTransaction.create({
          data: {
            assetId: a.id,
            type: AssetTransactionType.DEPRECIATION,
            postingDate,
            amount: charge,
            journalEntryId,
          },
        });

        await tx.fixedAsset.update({
          where: { id: a.id },
          data: { accumulatedDepreciation: accumulated, netBookValue: nbv },
        });
      });

      results.push({
        assetId: a.id, code: a.code, name: a.name,
        charge: charge.toFixed(2),
        accumulated: accumulated.toFixed(2),
        netBookValue: nbv.toFixed(2),
        posted: canPost,
        note: canPost ? undefined : 'No depreciation/accumulated account configured — asset updated, nothing posted to the GL.',
      });
    }

    return {
      postingDate: postingDate.toISOString().slice(0, 10),
      dryRun: !!dto.dryRun,
      assetsProcessed: results.length,
      totalCharge: results
        .reduce((s, r) => s.plus(new Prisma.Decimal(r.charge)), ZERO)
        .toFixed(2),
      results,
    };
  }

  async retire(companyId: string, id: string, userId: string, dto: { postingDate: string; remarks?: string }) {
    const asset = (await this.findOne(companyId, id)) as unknown as {
      id: string; code: string; status: FixedAssetStatus; netBookValue: Prisma.Decimal;
    };
    if (asset.status !== FixedAssetStatus.CAPITALIZED) {
      throw new ConflictException(`Only capitalized assets can be retired; ${asset.code} is ${asset.status.toLowerCase()}.`);
    }
    const postingDate = new Date(dto.postingDate);

    return this.prisma.$transaction(async (tx) => {
      await tx.fixedAssetTransaction.create({
        data: {
          assetId: asset.id,
          type: AssetTransactionType.RETIREMENT,
          postingDate,
          amount: asset.netBookValue,
          remarks: dto.remarks ?? null,
        },
      });
      return tx.fixedAsset.update({
        where: { id: asset.id },
        data: { status: FixedAssetStatus.RETIRED, retiredAt: postingDate, netBookValue: ZERO },
      });
    });
  }

  /** Asset Depreciation Forecast Report — projected charge per remaining month. */
  async forecast(companyId: string, id: string, months = 12) {
    const a = await this.prisma.fixedAsset.findFirst({ where: { id, companyId } });
    if (!a) throw new BadRequestException('Asset not found');
    if (!a.capitalizedAt) return { assetId: id, rows: [] };

    const depreciable = a.acquisitionCost.minus(a.salvageValue);
    const elapsed = monthsBetween(a.capitalizedAt, new Date());
    const rows: { month: number; date: string; charge: string; accumulated: string; netBookValue: string }[] = [];

    let prev = this.cumulativeDepreciation(
      a.depreciationMethod, depreciable, a.usefulLifeMonths, Math.min(elapsed, a.usefulLifeMonths),
    );

    for (let i = 1; i <= months; i++) {
      const m = Math.min(elapsed + i, a.usefulLifeMonths);
      const cum = this.cumulativeDepreciation(a.depreciationMethod, depreciable, a.usefulLifeMonths, m);
      const charge = cum.minus(prev);
      prev = cum;
      const date = new Date(a.capitalizedAt);
      date.setUTCMonth(date.getUTCMonth() + m);
      rows.push({
        month: m,
        date: date.toISOString().slice(0, 10),
        charge: charge.toFixed(2),
        accumulated: cum.toFixed(2),
        netBookValue: a.acquisitionCost.minus(cum).toFixed(2),
      });
    }
    return { assetId: id, code: a.code, name: a.name, rows };
  }

  /**
   * Cumulative depreciation after `months` of a `lifeMonths` life.
   * Declining balance uses double-declining; sum-of-years uses the classic
   * digit weighting. Both are expressed cumulatively so callers stay idempotent.
   */
  private cumulativeDepreciation(
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
        // Double-declining, applied monthly, floored at the depreciable base.
        const rate = new Prisma.Decimal(2).dividedBy(lifeMonths);
        let remaining = depreciable;
        let cum = ZERO;
        for (let i = 0; i < m; i++) {
          const charge = remaining.times(rate).toDecimalPlaces(2);
          cum = cum.plus(charge);
          remaining = remaining.minus(charge);
        }
        return Prisma.Decimal.min(cum, depreciable);
      }

      case DepreciationMethod.SUM_OF_YEARS: {
        const total = (lifeMonths * (lifeMonths + 1)) / 2;
        // Weight for the first m months: life + (life-1) + … + (life-m+1)
        const used = (m * (2 * lifeMonths - m + 1)) / 2;
        return depreciable.times(used).dividedBy(total).toDecimalPlaces(2);
      }

      default:
        return ZERO;
    }
  }
}

function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  // Only count a month once its day-of-month has been reached.
  return to.getUTCDate() >= from.getUTCDate() ? months : months - 1;
}
