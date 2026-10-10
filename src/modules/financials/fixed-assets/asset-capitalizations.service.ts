import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  APBillStatus,
  AssetCapitalizationKind as Kind,
  AssetCapitalizationOrigin as Origin,
  AssetCapitalizationStatus as Status,
  AccountSubtype,
  AccountType,
  AssetTransactionType,
  FixedAssetStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { FiscalPeriodsService } from '../fiscal-periods/fiscal-periods.service';
import { NumberingService } from '../../administration/numbering/numbering.service';
import type { JournalLineDto } from '../journal-entries/dto/journal-entry.dto';
import {
  CancelAssetCapitalizationDto,
  CreateAssetCapitalizationDto,
} from './fixed-assets.dto';
import {
  companyCurrency,
  D,
  fiscalYearOf,
  lockAssets,
  money,
  requireClassAccount,
  statusFromValues,
  ZERO,
} from './fixed-assets.shared';

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/** A/P invoices whose lines can be capitalized: posted and not voided. */
const POSTED_BILL_STATUSES: APBillStatus[] = [
  APBillStatus.APPROVED,
  APBillStatus.PARTIALLY_PAID,
  APBillStatus.PAID,
  APBillStatus.OVERDUE,
];

/** Numbering document type, and journal entry source (one per document). */
const DOC_TYPE: Record<Kind, string> = {
  [Kind.CAPITALIZATION]: 'fixed_asset_capitalization',
  [Kind.CREDIT_MEMO]: 'fixed_asset_credit_memo',
};
/** Also the default Journal Remark (Accounting tab). */
const LABEL: Record<Kind, string> = {
  [Kind.CAPITALIZATION]: 'Capitalization',
  [Kind.CREDIT_MEMO]: 'Capitalization Credit Memo',
};
const CLASS_WINDOW =
  'Administration → Setup → Financials → Fixed Assets → Asset Classes';

/** dd.mm.yyyy, as the windows show dates. */
const shown = (d: Date) =>
  d.toISOString().slice(0, 10).split('-').reverse().join('.');
const TX_TYPE: Record<Kind, AssetTransactionType> = {
  [Kind.CAPITALIZATION]: AssetTransactionType.CAPITALIZATION,
  [Kind.CREDIT_MEMO]: AssetTransactionType.CAPITALIZATION_CREDIT_MEMO,
};

const REF = { select: { id: true, code: true, name: true } } as const;

const DETAIL_INCLUDE = {
  lines: {
    orderBy: { ordering: 'asc' },
    include: {
      asset: {
        select: {
          id: true,
          code: true,
          name: true,
          assetClass: { select: { id: true, code: true, name: true } },
        },
      },
      apBillLine: {
        select: { id: true, description: true, lineTotal: true, account: REF },
      },
    },
  },
  apBill: {
    select: {
      id: true,
      number: true,
      issueDate: true,
      bp: { select: { id: true, cardCode: true, cardName: true } },
    },
  },
  baseCapitalization: { select: { id: true, number: true } },
  creditMemos: {
    where: { status: Status.POSTED },
    select: { id: true, number: true },
  },
  depreciationArea: {
    select: { id: true, code: true, name: true, postsToGl: true },
  },
  journalEntry: {
    select: {
      id: true,
      number: true,
      status: true,
      date: true,
      lines: {
        orderBy: { ordering: 'asc' },
        select: {
          id: true,
          debit: true,
          credit: true,
          description: true,
          account: REF,
        },
      },
    },
  },
  cancellationJournalEntry: { select: { id: true, number: true, date: true } },
} satisfies Prisma.AssetCapitalizationInclude;

type LoadedAsset = Prisma.FixedAssetGetPayload<{
  include: { assetClass: true; areaValues: { include: { area: true } } };
}>;

/**
 * Capitalization and Capitalization Credit Memo (Fixed Assets).
 *
 * A capitalization places an asset in service: its acquisition and production
 * cost (APC) goes up in every chosen depreciation area, and in the area that
 * posts to the G/L the journal entry is (QA FA-D3)
 *     Dr  asset class's APC account        (with the asset's project)
 *     Cr  asset class's clearing account   (manual origin; with the project)
 *      or the A/P invoice line's account   (A/P invoice origin; it must be the
 *                                           clearing account the bill booked to)
 * A credit memo is the mirror image and lowers APC. Both are posted on Add
 * and are only ever undone by Cancel, which reverses the journal entry and
 * writes offsetting asset history; nothing is edited or deleted.
 */
@Injectable()
export class AssetCapitalizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalEntriesService,
    private readonly periods: FiscalPeriodsService,
    private readonly numbering: NumberingService,
  ) {}

  findAll(companyId: string, kind?: Kind) {
    return this.prisma.assetCapitalization.findMany({
      where: { companyId, ...(kind ? { kind } : {}) },
      orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        apBill: { select: { id: true, number: true } },
        depreciationArea: { select: { id: true, code: true } },
        journalEntry: { select: { id: true, number: true } },
        _count: { select: { lines: true } },
      },
    });
  }

  async findOne(companyId: string, id: string) {
    const doc = await this.prisma.assetCapitalization.findFirst({
      where: { id, companyId },
      include: DETAIL_INCLUDE,
    });
    if (!doc)
      throw new NotFoundException(`Capitalization document ${id} not found`);
    return doc;
  }

  // ── Add (post) ──────────────────────────────────────────────────────────────
  async create(
    companyId: string,
    userId: string,
    dto: CreateAssetCapitalizationDto,
    idempotencyKey?: string,
  ) {
    const kind = dto.kind ?? Kind.CAPITALIZATION;
    const isCredit = kind === Kind.CREDIT_MEMO;
    const postingDate = new Date(dto.postingDate);
    const documentDate = dto.documentDate
      ? new Date(dto.documentDate)
      : postingDate;
    const assetValueDate = dto.assetValueDate
      ? new Date(dto.assetValueDate)
      : postingDate;

    // ── header rules, before anything is locked ──
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true },
    });
    if (
      fiscalYearOf(assetValueDate, company?.fiscalYearStart) !==
      fiscalYearOf(postingDate, company?.fiscalYearStart)
    ) {
      // FA-D7: the value date may differ from the posting date, but not by a
      // fiscal year — the year-end values would land in the wrong year.
      throw new BadRequestException(
        `The asset value date ${shown(assetValueDate)} must be in the same fiscal year as the posting date ${shown(postingDate)}.`,
      );
    }
    const journalRemark = dto.journalRemark?.trim() || LABEL[kind];
    const base = dto.baseCapitalizationId
      ? await this.requireBase(companyId, dto.baseCapitalizationId, isCredit)
      : null;
    const origin = dto.origin ?? base?.origin ?? Origin.MANUAL;
    const apBillId =
      dto.apBillId ??
      (base?.origin === Origin.AP_INVOICE ? base.apBillId : null) ??
      null;
    if (
      base &&
      (origin !== base.origin || (apBillId ?? null) !== (base.apBillId ?? null))
    ) {
      throw new BadRequestException(
        `A credit memo based on ${base.number} must keep its origin (${base.origin.toLowerCase()}).`,
      );
    }
    if (origin === Origin.AP_INVOICE && !apBillId) {
      throw new BadRequestException(
        'Choose the A/P invoice (Origin No.) this document capitalizes from.',
      );
    }
    if (origin === Origin.MANUAL && apBillId) {
      throw new BadRequestException(
        'Origin No. only applies when the origin is an A/P invoice.',
      );
    }
    const seen = new Set<string>();
    for (const l of dto.lines) {
      // One line per asset: each line is checked against the asset's values as
      // they stand, which two lines for one asset would both read unchanged.
      if (seen.has(l.assetId)) {
        throw new BadRequestException(
          'The same asset appears twice on this document. Put it on one line, or post a second document.',
        );
      }
      seen.add(l.assetId);
      if (origin === Origin.MANUAL && l.apBillLineId) {
        throw new BadRequestException(
          'A/P invoice lines only apply when the origin is an A/P invoice.',
        );
      }
      if (origin === Origin.AP_INVOICE && !l.apBillLineId) {
        throw new BadRequestException(
          'Every line must say which A/P invoice line it capitalizes.',
        );
      }
    }

    const area = dto.depreciationAreaId
      ? await this.prisma.depreciationArea.findFirst({
          where: { id: dto.depreciationAreaId, companyId },
        })
      : null;
    if (dto.depreciationAreaId && !area)
      throw new BadRequestException(
        'The depreciation area does not exist in this company.',
      );
    if (area && !area.isActive)
      throw new BadRequestException(
        `Depreciation area ${area.code} is inactive.`,
      );
    if (!area) {
      // "*" must reach the ledger. Without an active posting area the values
      // would move and the G/L would not — the silent drift of QA FA-1 B2.
      const posting = await this.prisma.depreciationArea.findFirst({
        where: { companyId, isActive: true, postsToGl: true },
        select: { id: true },
      });
      if (!posting) {
        throw new BadRequestException(
          'No active depreciation area posts to the G/L, so this document would never reach the ledger. ' +
            'Set one under Administration → Setup → Financials → Fixed Assets → Depreciation Areas.',
        );
      }
    }

    const bill = apBillId
      ? await this.prisma.aPBill.findFirst({
          where: { id: apBillId, companyId },
          select: {
            id: true,
            number: true,
            status: true,
            bpId: true,
            lines: {
              select: {
                id: true,
                accountId: true,
                lineTotal: true,
                description: true,
              },
            },
          },
        })
      : null;
    if (apBillId && !bill)
      throw new BadRequestException(
        'The A/P invoice does not exist in this company.',
      );
    if (bill && !POSTED_BILL_STATUSES.includes(bill.status)) {
      throw new ConflictException(
        `A/P invoice ${bill.number} is ${bill.status.toLowerCase()}; only a posted invoice can be capitalized from.`,
      );
    }
    if (dto.seriesId) {
      const series = await this.prisma.numberingSeries.findFirst({
        where: { id: dto.seriesId, companyId, documentType: DOC_TYPE[kind] },
        select: { id: true },
      });
      if (!series)
        throw new BadRequestException(
          `The numbering series is not a ${LABEL[kind].toLowerCase()} series of this company.`,
        );
    }
    const currency = await companyCurrency(this.prisma, companyId);
    const total = dto.lines.reduce((s, l) => s.plus(D(l.amount)), ZERO);

    let id: string;
    try {
    id = await this.prisma.$transaction(async (tx) => {
      // Locks first, then every check against what is locked — two documents
      // against one asset (or one invoice line) cannot both pass the limits.
      await lockAssets(
        tx,
        companyId,
        dto.lines.map((l) => l.assetId),
      );
      const billLineIds = [
        ...new Set(
          dto.lines.map((l) => l.apBillLineId).filter((x): x is string => !!x),
        ),
      ].sort();
      if (billLineIds.length) {
        await tx.$queryRaw`SELECT "id" FROM "ap_bill_lines" WHERE "id" = ANY(${billLineIds}::text[]) ORDER BY "id" FOR UPDATE`;
      }

      const assets = await tx.fixedAsset.findMany({
        where: { companyId, id: { in: dto.lines.map((l) => l.assetId) } },
        include: { assetClass: true, areaValues: { include: { area: true } } },
      });
      const byId = new Map(assets.map((a) => [a.id, a]));
      const capitalizedByBillLine = await this.netCapitalizedByBillLine(
        tx,
        billLineIds,
      );
      const creditedAgainstBase = base
        ? await this.creditedAgainstBase(tx, base.id)
        : new Map<string, Prisma.Decimal>();

      const depreciatedTo = await this.lastDepreciation(
        tx,
        companyId,
        assets.map((a) => a.id),
      );
      for (const a of assets) await this.assertClassCanPost(tx, companyId, a);

      const plan = dto.lines.map((line, i) => {
        const asset = byId.get(line.assetId)!;
        const amount = D(line.amount);
        // FA-D15: whole units. A first capitalization brings at least one unit
        // into service; a later document may be value-only (0).
        const quantity =
          line.quantity ?? (isCredit ? 0 : asset.quantity === 0 ? 1 : 0);
        const areas = this.affectedAreas(asset, area?.id ?? null);
        this.checkLine(
          kind,
          asset,
          amount,
          quantity,
          areas,
          i + 1,
          depreciatedTo.get(asset.id),
        );

        let creditAccountId = asset.assetClass.clearingAccountId;
        if (bill && line.apBillLineId) {
          const billLine = bill.lines.find((bl) => bl.id === line.apBillLineId);
          if (!billLine)
            throw new BadRequestException(
              `Line ${i + 1}: that A/P invoice line is not on invoice ${bill.number}.`,
            );
          if (billLine.accountId !== asset.assetClass.clearingAccountId) {
            throw new BadRequestException(
              `Line ${i + 1}: A/P invoice ${bill.number} booked "${billLine.description}" to another account, not to the ` +
                `clearing account of asset class ${asset.assetClass.code}. Only an amount sitting on the clearing account can be capitalized.`,
            );
          }
          const already = capitalizedByBillLine.get(billLine.id) ?? ZERO;
          const after = isCredit ? already.minus(amount) : already.plus(amount);
          if (!isCredit && after.gt(billLine.lineTotal)) {
            throw new ConflictException(
              `Line ${i + 1}: "${billLine.description}" on ${bill.number} is ${billLine.lineTotal.toFixed(2)}, of which ` +
                `${already.toFixed(2)} is already capitalized; ${amount.toFixed(2)} more would exceed it.`,
            );
          }
          if (isCredit && after.lt(ZERO)) {
            throw new ConflictException(
              `Line ${i + 1}: only ${already.toFixed(2)} of "${billLine.description}" on ${bill.number} is capitalized; ` +
                `${amount.toFixed(2)} cannot be credited.`,
            );
          }
          capitalizedByBillLine.set(billLine.id, after);
          creditAccountId = billLine.accountId;
        }
        if (base) {
          const baseAmount = base.lines
            .filter((bl) => bl.assetId === asset.id)
            .reduce((s, bl) => s.plus(bl.amount), ZERO);
          if (baseAmount.eq(ZERO)) {
            throw new BadRequestException(
              `Line ${i + 1}: asset ${asset.code} is not on ${base.number}.`,
            );
          }
          const credited = creditedAgainstBase.get(asset.id) ?? ZERO;
          if (credited.plus(amount).gt(baseAmount)) {
            throw new ConflictException(
              `Line ${i + 1}: ${base.number} capitalized ${baseAmount.toFixed(2)} for ${asset.code} and ` +
                `${credited.toFixed(2)} is already credited; ${amount.toFixed(2)} more would exceed it.`,
            );
          }
          creditedAgainstBase.set(asset.id, credited.plus(amount));
        }
        return {
          line,
          asset,
          amount,
          quantity,
          areas,
          creditAccountId,
          ordering: i,
        };
      });

      const allocated = await this.numbering.allocate(
        tx,
        companyId,
        DOC_TYPE[kind],
        dto.seriesId ?? null,
      );
      const doc = await tx.assetCapitalization.create({
        data: {
          companyId,
          kind,
          number: allocated.number,
          seriesId: allocated.seriesId,
          origin,
          apBillId,
          baseCapitalizationId: base?.id ?? null,
          depreciationAreaId: area?.id ?? null,
          reference: dto.reference?.trim() || null,
          postingDate,
          documentDate,
          assetValueDate,
          currency,
          total,
          journalRemark,
          remarks: dto.remarks?.trim() || null,
          idempotencyKey: idempotencyKey ?? null,
          createdById: userId,
          lines: {
            // companyId comes from the parent: it is part of the composite key.
            create: plan.map((p) => ({
              assetId: p.asset.id,
              apBillLineId: p.line.apBillLineId ?? null,
              amount: p.amount,
              quantity: p.quantity,
              remarks: p.line.remarks?.trim() || null,
              ordering: p.ordering,
            })),
          },
        },
        select: {
          id: true,
          number: true,
          lines: { select: { id: true, assetId: true } },
        },
      });
      const lineIdByAsset = new Map(doc.lines.map((l) => [l.assetId, l.id]));

      // ── the journal entry: only the amounts in the posting area ──
      // The asset's project goes on both lines (FA-D3); its cost center and
      // distribution rule belong to the depreciation expense, not to cost.
      const journalLines: JournalLineDto[] = [];
      for (const p of plan) {
        if (!p.areas.some((v) => v.area.postsToGl)) continue;
        const projectId = p.asset.projectId ?? undefined;
        const amt = money(p.amount);
        const what = `${LABEL[kind]} ${doc.number} — ${p.asset.code} ${p.asset.name}`;
        const apc = p.asset.assetClass.assetAccountId;
        journalLines.push(
          {
            accountId: isCredit ? p.creditAccountId : apc,
            debit: amt,
            description: what,
            projectId,
          },
          {
            accountId: isCredit ? apc : p.creditAccountId,
            credit: amt,
            description: what,
            projectId,
          },
        );
      }
      let journalEntryId: string | null = null;
      if (journalLines.length) {
        const entry = await this.journals.postFromSource(
          tx,
          companyId,
          userId,
          {
            date: postingDate,
            source: DOC_TYPE[kind],
            sourceId: doc.id,
            description: journalRemark,
            reference: doc.number,
            currency,
            lines: journalLines,
          },
        );
        journalEntryId = entry.id;
        await tx.assetCapitalization.update({
          where: { id: doc.id },
          data: { journalEntryId },
        });
      } else {
        // A statistical-only document still belongs to an open period.
        await this.periods.resolveOpenPeriod(
          companyId,
          postingDate,
          'general',
          tx,
        );
      }

      // ── asset values, status, quantity and history ──
      const sign = isCredit ? -1 : 1;
      for (const p of plan) {
        for (const v of p.areas) {
          const apc = v.acquisitionCost.plus(p.amount.times(sign));
          if (apc.gt(ZERO) && v.salvageValue.gt(ZERO) && v.salvageValue.gte(apc)) {
            throw new BadRequestException(
              `Asset ${p.asset.code}: the salvage value ${v.salvageValue.toFixed(2)} in area ${v.area.code} must be below ` +
                `its acquisition cost (${apc.toFixed(2)} after this document).`,
            );
          }
          await tx.fixedAssetAreaValue.update({
            where: { id: v.id },
            data: {
              acquisitionCost: apc,
              netBookValue: apc.minus(v.accumulatedDepreciation),
              ...(!isCredit && !v.depreciationStartDate
                ? { depreciationStartDate: assetValueDate }
                : {}),
            },
          });
          await tx.fixedAssetTransaction.create({
            data: {
              companyId,
              assetId: p.asset.id,
              areaId: v.areaId,
              type: TX_TYPE[kind],
              postingDate,
              amount: p.amount.times(sign),
              journalEntryId: v.area.postsToGl ? journalEntryId : null,
              capitalizationId: doc.id,
              capitalizationLineId: lineIdByAsset.get(p.asset.id) ?? null,
              remarks: p.line.remarks?.trim() || null,
            },
          });
        }
        await this.refreshAssetState(
          tx,
          p.asset.id,
          p.quantity * sign,
          assetValueDate,
        );
      }
      return doc.id;
    }, TX_OPTIONS);
    } catch (e) {
      await this.duplicateKey(e, companyId, idempotencyKey);
      throw e;
    }

    return this.findOne(companyId, id);
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────
  async cancel(
    companyId: string,
    id: string,
    userId: string,
    dto: CancelAssetCapitalizationDto = {},
  ) {
    const doc = await this.findOne(companyId, id);
    if (doc.status !== Status.POSTED) {
      throw new ConflictException(
        `${LABEL[doc.kind]} ${doc.number} is already cancelled.`,
      );
    }
    if (doc.creditMemos.length) {
      throw new ConflictException(
        `${doc.number} has credit memo${doc.creditMemos.length === 1 ? '' : 's'} ` +
          `${doc.creditMemos.map((c) => c.number).join(', ')} based on it. Cancel ${doc.creditMemos.length === 1 ? 'it' : 'them'} first.`,
      );
    }
    const assetIds = [...new Set(doc.lines.map((l) => l.assetId))];

    await this.prisma.$transaction(async (tx) => {
      await lockAssets(tx, companyId, assetIds);
      const current = await tx.assetCapitalization.findUniqueOrThrow({
        where: { id },
        select: { status: true, createdAt: true },
      });
      if (current.status !== Status.POSTED) {
        throw new ConflictException(
          `${LABEL[doc.kind]} ${doc.number} is already cancelled.`,
        );
      }

      // Undoing a document is only exact while nothing has happened to its
      // assets since: a later depreciation or capitalization was computed from
      // the values this document produced.
      const later = await tx.fixedAssetTransaction.findMany({
        where: {
          companyId,
          assetId: { in: assetIds },
          createdAt: { gt: current.createdAt },
          // Depreciation (no document) always counts; another document counts
          // while it is posted — a cancelled one nets to zero on the asset.
          // Spelled out rather than NOT { capitalizationId: id }: in SQL that is
          // unknown, not true, for the NULL ids depreciation rows carry.
          OR: [
            { capitalizationId: null },
            {
              AND: [
                { capitalizationId: { not: id } },
                { capitalization: { status: Status.POSTED } },
              ],
            },
          ],
        },
        select: { asset: { select: { code: true } }, type: true },
        distinct: ['assetId'],
      });
      if (later.length) {
        throw new ConflictException(
          `${doc.number} cannot be cancelled: ${later.map((l) => l.asset.code).join(', ')} ` +
            `${later.length === 1 ? 'has' : 'have'} later movements (depreciation or another document). ` +
            (doc.kind === Kind.CAPITALIZATION
              ? 'Post a capitalization credit memo instead.'
              : 'Post a new capitalization instead.'),
        );
      }

      const date = await this.reversalDate(tx, companyId, doc.postingDate);
      let reversalId: string | null = null;
      if (doc.journalEntryId) {
        const reversal = await this.journals.reverseFromSource(
          tx,
          companyId,
          userId,
          doc.journalEntryId,
          {
            date: date.toISOString().slice(0, 10),
            reason:
              dto.reason?.trim() ||
              `Cancellation of ${LABEL[doc.kind].toLowerCase()} ${doc.number}`,
          },
        );
        reversalId = reversal.id;
      }

      const moves = await tx.fixedAssetTransaction.findMany({
        where: { companyId, capitalizationId: id },
      });
      const values = await tx.fixedAssetAreaValue.findMany({
        where: { companyId, assetId: { in: assetIds } },
      });
      for (const m of moves) {
        const v = values.find(
          (x) => x.assetId === m.assetId && x.areaId === m.areaId,
        );
        if (!v) continue;
        const apc = v.acquisitionCost.minus(m.amount);
        if (apc.lt(v.accumulatedDepreciation)) {
          throw new ConflictException(
            `${doc.number} cannot be cancelled: the asset's depreciation would exceed its cost.`,
          );
        }
        await tx.fixedAssetAreaValue.update({
          where: { id: v.id },
          data: {
            acquisitionCost: apc,
            netBookValue: apc.minus(v.accumulatedDepreciation),
          },
        });
        v.acquisitionCost = apc;
        await tx.fixedAssetTransaction.create({
          data: {
            companyId,
            assetId: m.assetId,
            areaId: m.areaId,
            type: m.type,
            postingDate: date,
            amount: m.amount.negated(),
            journalEntryId: m.journalEntryId ? reversalId : null,
            capitalizationId: id,
            capitalizationLineId: m.capitalizationLineId,
            remarks: `Cancellation of ${doc.number}`,
          },
        });
      }
      const sign = doc.kind === Kind.CREDIT_MEMO ? 1 : -1;
      for (const assetId of assetIds) {
        const qty = doc.lines
          .filter((l) => l.assetId === assetId)
          .reduce((s, l) => s + l.quantity, 0);
        // Undoing a credit memo that had taken the asset back to New puts it
        // in service again from the date it had before that memo.
        const valueDate =
          doc.kind === Kind.CREDIT_MEMO
            ? ((await this.capitalizationDateBefore(
                tx,
                companyId,
                assetId,
                current.createdAt,
              )) ?? doc.assetValueDate)
            : doc.assetValueDate;
        await this.refreshAssetState(tx, assetId, qty * sign, valueDate);
      }

      await tx.assetCapitalization.update({
        where: { id },
        data: {
          status: Status.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId,
          cancellationJournalEntryId: reversalId,
        },
      });
    }, TX_OPTIONS);

    return this.findOne(companyId, id);
  }

  // ── Lookups for the window ──────────────────────────────────────────────────
  async lookups(companyId: string, kind: Kind = Kind.CAPITALIZATION) {
    const isCredit = kind === Kind.CREDIT_MEMO;
    const loadBases = () =>
      this.prisma.assetCapitalization.findMany({
        where: {
          companyId,
          kind: Kind.CAPITALIZATION,
          status: Status.POSTED,
        },
        select: {
          id: true,
          number: true,
          postingDate: true,
          origin: true,
          apBillId: true,
          total: true,
          lines: {
            select: { assetId: true, amount: true, apBillLineId: true },
          },
        },
        orderBy: { postingDate: 'desc' },
        take: 500,
      });
    type BaseRow = Awaited<ReturnType<typeof loadBases>>[number];
    const [series, depreciationAreas, assets, classes, bills, bases, company] =
      await Promise.all([
        this.prisma.numberingSeries.findMany({
          where: { companyId, documentType: DOC_TYPE[kind], isLocked: false },
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
        this.prisma.depreciationArea.findMany({
          where: { companyId, isActive: true },
          select: { id: true, code: true, name: true, postsToGl: true },
          orderBy: [{ ordering: 'asc' }, { code: 'asc' }],
        }),
        this.prisma.fixedAsset.findMany({
          where: isCredit
            ? {
                companyId,
                isActive: true,
                status: FixedAssetStatus.CAPITALIZED,
              }
            : {
                companyId,
                isActive: true,
                status: {
                  in: [FixedAssetStatus.NEW, FixedAssetStatus.CAPITALIZED],
                },
              },
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            purchaseCost: true,
            quantity: true,
            assetClass: {
              select: {
                id: true,
                code: true,
                name: true,
                assetAccount: REF,
                clearingAccount: REF,
              },
            },
            areaValues: {
              select: {
                areaId: true,
                acquisitionCost: true,
                accumulatedDepreciation: true,
                netBookValue: true,
              },
            },
          },
          orderBy: { code: 'asc' },
          take: 5000,
        }),
        this.prisma.assetClass.findMany({
          where: { companyId },
          select: { clearingAccountId: true },
        }),
        this.prisma.aPBill.findMany({
          where: { companyId, status: { in: POSTED_BILL_STATUSES } },
          select: {
            id: true,
            number: true,
            issueDate: true,
            total: true,
            bp: { select: { id: true, cardCode: true, cardName: true } },
            lines: {
              select: {
                id: true,
                description: true,
                lineTotal: true,
                accountId: true,
                account: REF,
              },
            },
          },
          orderBy: { issueDate: 'desc' },
          take: 500,
        }),
        isCredit ? loadBases() : Promise.resolve([] as BaseRow[]),
        this.prisma.company.findUnique({
          where: { id: companyId },
          select: { currency: true },
        }),
      ]);

    // Only lines booked to an asset clearing account can be capitalized, and
    // only up to what is not capitalized yet.
    const clearing = new Set(classes.map((c) => c.clearingAccountId));
    const lineIds = bills.flatMap((b) =>
      b.lines
        .filter((l) => l.accountId && clearing.has(l.accountId))
        .map((l) => l.id),
    );
    const capitalized = await this.netCapitalizedByBillLine(
      this.prisma,
      lineIds,
    );
    const apBills = bills
      .map((b) => ({
        id: b.id,
        number: b.number,
        issueDate: b.issueDate,
        total: b.total,
        bp: b.bp,
        lines: b.lines
          .filter((l) => l.accountId && clearing.has(l.accountId))
          .map((l) => ({
            id: l.id,
            description: l.description,
            lineTotal: l.lineTotal,
            accountId: l.accountId,
            account: l.account,
            capitalized: (capitalized.get(l.id) ?? ZERO).toFixed(2),
          })),
      }))
      .filter((b) => b.lines.length);

    const credited = new Map<string, Map<string, Prisma.Decimal>>();
    for (const b of bases)
      credited.set(b.id, await this.creditedAgainstBase(this.prisma, b.id));
    const baseDocuments = bases.map((b) => ({
      ...b,
      lines: b.lines.map((l) => ({
        ...l,
        credited: (credited.get(b.id)?.get(l.assetId) ?? ZERO).toFixed(2),
      })),
    }));

    return {
      series,
      depreciationAreas,
      assets,
      apBills,
      baseDocuments,
      currency: company?.currency ?? null,
      journalRemark: LABEL[kind],
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private async requireBase(
    companyId: string,
    baseId: string,
    isCredit: boolean,
  ) {
    if (!isCredit)
      throw new BadRequestException(
        'Only a credit memo can be based on another document.',
      );
    const base = await this.prisma.assetCapitalization.findFirst({
      where: { id: baseId, companyId },
      include: { lines: { select: { assetId: true, amount: true } } },
    });
    if (!base || base.kind !== Kind.CAPITALIZATION) {
      throw new BadRequestException(
        'The base document is not a capitalization of this company.',
      );
    }
    if (base.status !== Status.POSTED)
      throw new ConflictException(
        `${base.number} is cancelled and cannot be credited.`,
      );
    return base;
  }

  /** The areas a line changes: one chosen area, or every active area the asset has. */
  private affectedAreas(asset: LoadedAsset, areaId: string | null) {
    if (areaId) {
      const v = asset.areaValues.find((x) => x.areaId === areaId);
      if (!v) {
        throw new BadRequestException(
          `Asset ${asset.code} has no values in that depreciation area (the area was added after the asset was capitalized).`,
        );
      }
      return [v];
    }
    return asset.areaValues.filter((v) => v.area.isActive);
  }

  private checkLine(
    kind: Kind,
    asset: LoadedAsset,
    amount: Prisma.Decimal,
    quantity: number,
    areas: LoadedAsset['areaValues'],
    n: number,
    depreciatedTo: Date | undefined,
  ) {
    if (
      asset.status === FixedAssetStatus.RETIRED ||
      asset.status === FixedAssetStatus.SOLD
    ) {
      throw new ConflictException(
        `Line ${n}: asset ${asset.code} is ${asset.status.toLowerCase()}.`,
      );
    }
    if (!areas.length)
      throw new BadRequestException(
        `Line ${n}: asset ${asset.code} has no active depreciation area.`,
      );
    if (depreciatedTo) {
      // FA-D6: the run computes a cumulative target from the current APC, so a
      // change of APC after depreciation started would book a hidden catch-up
      // for every past month. Refused until the depreciation rework.
      throw new ConflictException(
        `Asset ${asset.code} already has depreciation posted (to ${shown(depreciatedTo)}). ` +
          'Additions and credit memos after depreciation starts arrive with the depreciation rework (FA-2).',
      );
    }
    if (kind === Kind.CAPITALIZATION) {
      if (!asset.isActive)
        throw new ConflictException(
          `Line ${n}: asset ${asset.code} is inactive.`,
        );
      if (!asset.assetClass.isActive) {
        throw new ConflictException(
          `Line ${n}: asset class ${asset.assetClass.code} of ${asset.code} is inactive.`,
        );
      }
      if (asset.quantity === 0 && quantity < 1) {
        throw new BadRequestException(
          `Line ${n}: this is the first capitalization of ${asset.code}, so its quantity must be at least 1.`,
        );
      }
      return;
    }
    if (asset.status !== FixedAssetStatus.CAPITALIZED) {
      throw new ConflictException(
        `Line ${n}: asset ${asset.code} is not capitalized, so there is nothing to credit.`,
      );
    }
    for (const v of areas) {
      if (amount.gt(v.acquisitionCost)) {
        throw new ConflictException(
          `Line ${n}: ${amount.toFixed(2)} exceeds the acquisition cost of ${asset.code} in area ${v.area.code} ` +
            `(${v.acquisitionCost.toFixed(2)}).`,
        );
      }
    }
    if (quantity > asset.quantity) {
      throw new ConflictException(
        `Line ${n}: ${asset.code} has a quantity of ${asset.quantity}; ${quantity} cannot be credited.`,
      );
    }
  }

  /** The latest depreciation posting per asset, if any. */
  private async lastDepreciation(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetIds: string[],
  ) {
    const rows = await tx.fixedAssetTransaction.groupBy({
      by: ['assetId'],
      where: {
        companyId,
        assetId: { in: assetIds },
        type: {
          in: [
            AssetTransactionType.DEPRECIATION,
            AssetTransactionType.MANUAL_DEPRECIATION,
          ],
        },
      },
      _max: { postingDate: true },
    });
    const out = new Map<string, Date>();
    for (const r of rows)
      if (r._max.postingDate) out.set(r.assetId, r._max.postingDate);
    return out;
  }

  /**
   * The class's APC and clearing accounts must still be postable now, not only
   * when the class was saved. A refusal names the asset, the class and the
   * window where it is fixed (QA FA-1 B2) instead of letting the ledger answer.
   */
  private async assertClassCanPost(
    tx: Prisma.TransactionClient,
    companyId: string,
    asset: LoadedAsset,
  ) {
    const cls = asset.assetClass;
    const where = ` of asset class ${cls.code} (${CLASS_WINDOW})`;
    try {
      await requireClassAccount(
        tx,
        companyId,
        cls.assetAccountId,
        `APC account${where}`,
        [AccountType.ASSET],
        AccountSubtype.FIXED_ASSET,
      );
      await requireClassAccount(
        tx,
        companyId,
        cls.clearingAccountId,
        `Acquisition clearing account${where}`,
        [AccountType.LIABILITY, AccountType.ASSET],
      );
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw new BadRequestException(`Asset ${asset.code}: ${e.message}`);
      }
      throw e;
    }
  }

  /**
   * A duplicate under the same idempotency key is a retry that got past the
   * replay cache. The unique index refused it inside the transaction, so
   * nothing was posted twice; the caller is told which document holds it.
   */
  private async duplicateKey(
    e: unknown,
    companyId: string,
    key: string | undefined,
  ) {
    if (
      key &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      String(e.meta?.target ?? '').includes('idempotencyKey')
    ) {
      const existing = await this.prisma.assetCapitalization.findFirst({
        where: { companyId, idempotencyKey: key },
        select: { number: true },
      });
      throw new ConflictException(
        `${existing ? `Document ${existing.number}` : 'A document'} was already posted under this idempotency key. ` +
          'It was not posted again.',
      );
    }
  }

  /** Net capitalized per A/P invoice line over posted documents: capitalizations less credit memos. */
  private async netCapitalizedByBillLine(
    db: Prisma.TransactionClient | PrismaService,
    lineIds: string[],
  ) {
    const out = new Map<string, Prisma.Decimal>();
    if (!lineIds.length) return out;
    const rows = await db.assetCapitalizationLine.findMany({
      where: {
        apBillLineId: { in: lineIds },
        capitalization: { status: Status.POSTED },
      },
      select: {
        apBillLineId: true,
        amount: true,
        capitalization: { select: { kind: true } },
      },
    });
    for (const r of rows) {
      const signed =
        r.capitalization.kind === Kind.CREDIT_MEMO
          ? r.amount.negated()
          : r.amount;
      out.set(r.apBillLineId!, (out.get(r.apBillLineId!) ?? ZERO).plus(signed));
    }
    return out;
  }

  /** What posted credit memos based on a capitalization have credited, per asset. */
  private async creditedAgainstBase(
    db: Prisma.TransactionClient | PrismaService,
    baseId: string,
  ) {
    const rows = await db.assetCapitalizationLine.findMany({
      where: {
        capitalization: { baseCapitalizationId: baseId, status: Status.POSTED },
      },
      select: { assetId: true, amount: true },
    });
    const out = new Map<string, Prisma.Decimal>();
    for (const r of rows)
      out.set(r.assetId, (out.get(r.assetId) ?? ZERO).plus(r.amount));
    return out;
  }

  /**
   * Status, capitalization date and quantity follow the asset's values. When
   * credit memos or a cancellation bring the asset back to New, the
   * capitalization date is cleared, and so is a depreciation start date that
   * came from it, so the next capitalization's value date applies (FA-D6/D7).
   */
  private async refreshAssetState(
    tx: Prisma.TransactionClient,
    assetId: string,
    quantityDelta: number,
    valueDate: Date,
  ) {
    const asset = await tx.fixedAsset.findUniqueOrThrow({
      where: { id: assetId },
      select: {
        capitalizedAt: true,
        quantity: true,
        areaValues: {
          select: {
            id: true,
            acquisitionCost: true,
            depreciationStartDate: true,
          },
        },
      },
    });
    const status = statusFromValues(asset.areaValues);
    const quantity = Math.max(0, asset.quantity + quantityDelta);
    const capitalizedAt = asset.capitalizedAt;
    if (status === FixedAssetStatus.NEW && capitalizedAt) {
      const derived = asset.areaValues.filter(
        (v) => v.depreciationStartDate?.getTime() === capitalizedAt.getTime(),
      );
      if (derived.length) {
        await tx.fixedAssetAreaValue.updateMany({
          where: { id: { in: derived.map((v) => v.id) } },
          data: { depreciationStartDate: null },
        });
      }
    }
    if (status !== FixedAssetStatus.NEW && !capitalizedAt) {
      // Back in service: every area holding value starts depreciating from
      // the capitalization date unless it has a start date of its own.
      const unstarted = asset.areaValues.filter(
        (v) => v.acquisitionCost.gt(ZERO) && !v.depreciationStartDate,
      );
      if (unstarted.length) {
        await tx.fixedAssetAreaValue.updateMany({
          where: { id: { in: unstarted.map((v) => v.id) } },
          data: { depreciationStartDate: valueDate },
        });
      }
    }
    await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        status,
        quantity,
        capitalizedAt:
          status === FixedAssetStatus.NEW ? null : (capitalizedAt ?? valueDate),
      },
    });
  }

  /**
   * The capitalization date the asset had just before `before`: the asset
   * value date of the capitalization that last took it from no value to some,
   * replayed from its own history.
   */
  private async capitalizationDateBefore(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
    before: Date,
  ): Promise<Date | null> {
    const first = await tx.fixedAssetTransaction.findFirst({
      where: { companyId, assetId, capitalizationId: { not: null } },
      select: { areaId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!first) return null;
    const rows = await tx.fixedAssetTransaction.findMany({
      where: {
        companyId,
        assetId,
        areaId: first.areaId,
        createdAt: { lt: before },
        type: {
          in: [
            AssetTransactionType.CAPITALIZATION,
            AssetTransactionType.CAPITALIZATION_CREDIT_MEMO,
          ],
        },
      },
      select: {
        amount: true,
        capitalization: { select: { kind: true, assetValueDate: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    let apc = ZERO;
    let date: Date | null = null;
    for (const r of rows) {
      const next = apc.plus(r.amount);
      if (
        apc.lte(ZERO) &&
        next.gt(ZERO) &&
        r.capitalization?.kind === Kind.CAPITALIZATION
      ) {
        date = r.capitalization.assetValueDate;
      }
      apc = next;
    }
    return date;
  }

  /**
   * A cancellation posts on the original date while that period is still open
   * (so the period's figures are corrected where they were made), otherwise
   * on today's date, which must itself be open.
   */
  private async reversalDate(
    tx: Prisma.TransactionClient,
    companyId: string,
    original: Date,
  ): Promise<Date> {
    try {
      await this.periods.resolveOpenPeriod(companyId, original, 'general', tx);
      return original;
    } catch {
      const today = new Date();
      await this.periods.resolveOpenPeriod(companyId, today, 'general', tx);
      return today;
    }
  }
}
