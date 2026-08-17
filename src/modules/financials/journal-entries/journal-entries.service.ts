import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalEntryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../../administration/numbering/numbering.service';
import { AccountsService } from '../accounts/accounts.service';
import { FiscalPeriodsService, PostingArea } from '../fiscal-periods/fiscal-periods.service';
import {
  CreateJournalEntryDto,
  JournalLineDto,
  ReverseJournalEntryDto,
  UpdateJournalEntryDto,
} from './dto/journal-entry.dto';
import { ListQuery } from '../../../common/crud/tenant-crud.service';

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);
const ZERO = new Prisma.Decimal(0);

/**
 * Prisma's default interactive-transaction budget is 5s, measured from when the
 * callback starts. On a serverless host the first request after a cold start
 * pays connection setup on top of cross-region round-trips, which pushed
 * posting past that limit and surfaced as an opaque 500 on roughly the first
 * call and never again. Posting must not be the operation that fails on a cold
 * invocation, so these give it real headroom.
 */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const DETAIL_INCLUDE = {
  lines: {
    orderBy: { ordering: 'asc' as const },
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
      bp: { select: { id: true, cardCode: true, cardName: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      distributionRule: { select: { id: true, code: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      taxCode: { select: { id: true, code: true, name: true, rate: true } },
    },
  },
  period: { select: { id: true, name: true, status: true } },
  series: { select: { id: true, name: true } },
  transactionCode: { select: { id: true, code: true, description: true } },
  project: { select: { id: true, code: true, name: true } },
  reversal: { select: { id: true, number: true } },
  reversalOf: { select: { id: true, number: true } },
};

/**
 * Double-entry journal.
 *
 * Design rules, in priority order:
 *   1. A POSTED entry is immutable. Corrections happen by reversal, never by
 *      editing history — that is what makes the ledger auditable.
 *   2. An entry can only reach POSTED if debits equal credits to the cent.
 *   3. Posting is always inside one transaction with its number allocation, so
 *      a failure cannot burn a document number or leave a half-written entry.
 */
@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly accounts: AccountsService,
    private readonly periods: FiscalPeriodsService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────
  async findAll(companyId: string, query: ListQuery = {}) {
    const where: Prisma.JournalEntryWhereInput = { companyId };

    if (query.status) where.status = query.status as JournalEntryStatus;
    if (query.periodId) where.periodId = String(query.periodId);
    if (query.source) where.source = String(query.source);
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(String(query.from)) } : {}),
        ...(query.to ? { lte: new Date(String(query.to)) } : {}),
      };
    }
    if (query.search) {
      const s = String(query.search);
      where.OR = [
        { number: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { reference: { contains: s, mode: 'insensitive' } },
      ];
    }
    // "Locate journal transaction by amount range" from the reports menu.
    if (query.minAmount || query.maxAmount) {
      where.totalDebit = {
        ...(query.minAmount ? { gte: D(query.minAmount) } : {}),
        ...(query.maxAmount ? { lte: D(query.maxAmount) } : {}),
      };
    }

    return this.prisma.journalEntry.findMany({
      where,
      include: DETAIL_INCLUDE,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      ...(query.skip !== undefined ? { skip: Number(query.skip) } : {}),
      take: query.take !== undefined ? Number(query.take) : 100,
    });
  }

  async findOne(companyId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: DETAIL_INCLUDE,
    });
    if (!entry) throw new NotFoundException(`Journal entry ${id} not found`);
    return entry;
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  async create(companyId: string, userId: string, dto: CreateJournalEntryDto) {
    const date = new Date(dto.date);
    const { totalDebit, totalCredit } = this.totals(dto.lines);

    // Draft entries are allowed to be unbalanced — that is the point of a draft.
    // Anything heading straight to POSTED must balance first.
    if (dto.post) this.assertBalanced(totalDebit, totalCredit);

    await this.validateLines(companyId, dto.lines);

    const period = await this.periods.resolveOpenPeriod(companyId, date, 'general');

    return this.prisma.$transaction(async (tx) => {
      const allocated = await this.numbering.allocate(
        tx,
        companyId,
        'journal_entry',
        dto.seriesId,
      );

      return tx.journalEntry.create({
        data: {
          companyId,
          periodId: period.id,
          number: allocated.number,
          seriesId: allocated.seriesId,
          date,
          docDate: dto.docDate ? new Date(dto.docDate) : date,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          description: dto.description ?? null,
          reference: dto.reference ?? null,
          currency: dto.currency ?? 'USD',
          transactionCodeId: dto.transactionCodeId ?? null,
          projectId: dto.projectId ?? null,
          templateId: dto.templateId ?? null,
          indicator: dto.indicator ?? null,
          ref1: dto.ref1 ?? null,
          ref2: dto.ref2 ?? null,
          ref3: dto.ref3 ?? null,
          isAdjustment: dto.isAdjustment ?? false,
          autoReverseDate: dto.autoReverseDate ? new Date(dto.autoReverseDate) : null,
          source: 'manual',
          createdById: userId,
          status: dto.post ? JournalEntryStatus.POSTED : JournalEntryStatus.DRAFT,
          postedAt: dto.post ? new Date() : null,
          postedById: dto.post ? userId : null,
          totalDebit,
          totalCredit,
          lines: { create: this.mapLines(dto.lines) },
        },
        include: DETAIL_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  // ── Update (drafts only) ───────────────────────────────────────────────────
  async update(companyId: string, id: string, userId: string, dto: UpdateJournalEntryDto) {
    const existing = await this.findOne(companyId, id);

    if (existing.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException(
        `Journal entry ${existing.number} is ${existing.status.toLowerCase()} and is immutable. ` +
          `Post a reversal instead of editing it.`,
      );
    }

    const date = dto.date ? new Date(dto.date) : existing.date;
    let periodId = existing.periodId;
    if (dto.date) {
      const period = await this.periods.resolveOpenPeriod(companyId, date, 'general');
      periodId = period.id;
    }

    let totals: { totalDebit: Prisma.Decimal; totalCredit: Prisma.Decimal } | null = null;
    if (dto.lines) {
      await this.validateLines(companyId, dto.lines);
      totals = this.totals(dto.lines);
      if (dto.post) this.assertBalanced(totals.totalDebit, totals.totalCredit);
    } else if (dto.post) {
      this.assertBalanced(existing.totalDebit, existing.totalCredit);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        // Lines are replaced wholesale: the grid posts its full state, and
        // diffing rows the client may have reordered is not worth the risk.
        await tx.journalLine.deleteMany({ where: { entryId: id } });
      }

      return tx.journalEntry.update({
        where: { id },
        data: {
          periodId,
          date,
          ...(dto.docDate !== undefined ? { docDate: dto.docDate ? new Date(dto.docDate) : null } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.transactionCodeId !== undefined ? { transactionCodeId: dto.transactionCodeId || null } : {}),
          ...(dto.projectId !== undefined ? { projectId: dto.projectId || null } : {}),
          ...(dto.indicator !== undefined ? { indicator: dto.indicator } : {}),
          ...(dto.ref1 !== undefined ? { ref1: dto.ref1 } : {}),
          ...(dto.ref2 !== undefined ? { ref2: dto.ref2 } : {}),
          ...(dto.ref3 !== undefined ? { ref3: dto.ref3 } : {}),
          ...(dto.isAdjustment !== undefined ? { isAdjustment: dto.isAdjustment } : {}),
          ...(totals ?? {}),
          ...(dto.lines ? { lines: { create: this.mapLines(dto.lines) } } : {}),
          ...(dto.post
            ? {
                status: JournalEntryStatus.POSTED,
                postedAt: new Date(),
                postedById: userId,
              }
            : {}),
        },
        include: DETAIL_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  // ── Post ───────────────────────────────────────────────────────────────────
  async post(companyId: string, id: string, userId: string) {
    const entry = await this.findOne(companyId, id);

    if (entry.status === JournalEntryStatus.POSTED) {
      throw new ConflictException(`Journal entry ${entry.number} is already posted.`);
    }
    if (entry.status === JournalEntryStatus.REVERSED) {
      throw new ConflictException(`Journal entry ${entry.number} has been reversed and cannot be posted.`);
    }
    if (entry.lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two lines.');
    }

    this.assertBalanced(entry.totalDebit, entry.totalCredit);
    // Re-check the period at post time: it may have been closed since the draft
    // was written.
    await this.periods.resolveOpenPeriod(companyId, entry.date, 'general');

    return this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: JournalEntryStatus.POSTED,
        postedAt: new Date(),
        postedById: userId,
      },
      include: DETAIL_INCLUDE,
    });
  }

  // ── Reverse ────────────────────────────────────────────────────────────────
  /**
   * Creates a mirror entry with debits and credits swapped, links the two, and
   * marks the original REVERSED. The original's rows are never touched.
   */
  async reverse(companyId: string, id: string, userId: string, dto: ReverseJournalEntryDto = {}) {
    const original = await this.findOne(companyId, id);

    if (original.status !== JournalEntryStatus.POSTED) {
      throw new ConflictException(
        `Only posted entries can be reversed; ${original.number} is ${original.status.toLowerCase()}.`,
      );
    }
    if (original.reversal) {
      throw new ConflictException(
        `Journal entry ${original.number} was already reversed by ${original.reversal.number}.`,
      );
    }

    const date = dto.date ? new Date(dto.date) : new Date();
    const period = await this.periods.resolveOpenPeriod(companyId, date, 'general');

    return this.prisma.$transaction(async (tx) => {
      const allocated = await this.numbering.allocate(tx, companyId, 'journal_entry');

      const reversal = await tx.journalEntry.create({
        data: {
          companyId,
          periodId: period.id,
          number: allocated.number,
          seriesId: allocated.seriesId,
          date,
          docDate: date,
          description:
            dto.reason ?? `Reversal of ${original.number}${original.description ? ` — ${original.description}` : ''}`,
          reference: original.number,
          currency: original.currency,
          projectId: original.projectId,
          transactionCodeId: original.transactionCodeId,
          source: 'reversal',
          sourceId: original.id,
          createdById: userId,
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
          postedById: userId,
          // Swapped, so the pair nets to zero on every account.
          totalDebit: original.totalCredit,
          totalCredit: original.totalDebit,
          reversalOfId: original.id,
          lines: {
            create: original.lines.map((l, i) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: l.description,
              bpId: l.bpId,
              costCenterId: l.costCenterId,
              distributionRuleId: l.distributionRuleId,
              projectId: l.projectId,
              taxCodeId: l.taxCodeId,
              taxAmount: l.taxAmount ? new Prisma.Decimal(l.taxAmount).negated() : null,
              ordering: i,
            })),
          },
        },
        include: DETAIL_INCLUDE,
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: JournalEntryStatus.REVERSED },
      });

      return reversal;
    }, TX_OPTIONS);
  }

  // ── Delete (drafts only) ───────────────────────────────────────────────────
  async remove(companyId: string, id: string) {
    const entry = await this.findOne(companyId, id);
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException(
        `Journal entry ${entry.number} is ${entry.status.toLowerCase()} and cannot be deleted. ` +
          `Posted entries are reversed, not removed.`,
      );
    }
    await this.prisma.journalEntry.delete({ where: { id } });
    return { id, message: `Draft journal entry ${entry.number} deleted` };
  }

  /**
   * Posts a journal on behalf of another module (AR invoice, AP bill, payment).
   * Exposed so subledger code never hand-rolls its own GL writes.
   */
  async postFromSource(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string | null,
    input: {
      date: Date;
      source: string;
      sourceId: string;
      description?: string;
      reference?: string;
      currency?: string;
      area?: PostingArea;
      lines: JournalLineDto[];
    },
  ) {
    const { totalDebit, totalCredit } = this.totals(input.lines);
    this.assertBalanced(totalDebit, totalCredit);

    const period = await this.periods.resolveOpenPeriod(
      companyId,
      input.date,
      input.area ?? 'general',
      tx,
    );
    const allocated = await this.numbering.allocate(tx, companyId, 'journal_entry');

    return tx.journalEntry.create({
      data: {
        companyId,
        periodId: period.id,
        number: allocated.number,
        seriesId: allocated.seriesId,
        date: input.date,
        docDate: input.date,
        description: input.description ?? null,
        reference: input.reference ?? null,
        currency: input.currency ?? 'USD',
        source: input.source,
        sourceId: input.sourceId,
        createdById: userId,
        status: JournalEntryStatus.POSTED,
        postedAt: new Date(),
        postedById: userId,
        totalDebit,
        totalCredit,
        lines: { create: this.mapLines(input.lines) },
      },
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private totals(lines: JournalLineDto[]) {
    return lines.reduce(
      (acc, l) => ({
        totalDebit: acc.totalDebit.plus(D(l.debit)),
        totalCredit: acc.totalCredit.plus(D(l.credit)),
      }),
      { totalDebit: ZERO, totalCredit: ZERO },
    );
  }

  private assertBalanced(totalDebit: Prisma.Decimal, totalCredit: Prisma.Decimal) {
    if (!totalDebit.equals(totalCredit)) {
      const diff = totalDebit.minus(totalCredit);
      throw new BadRequestException(
        `Journal entry is out of balance by ${diff.abs().toFixed(2)} ` +
          `(debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}). ` +
          `Debits and credits must be equal before posting.`,
      );
    }
    if (totalDebit.equals(ZERO)) {
      throw new BadRequestException('A journal entry cannot post with a zero total.');
    }
  }

  private async validateLines(companyId: string, lines: JournalLineDto[]) {
    for (const [i, l] of lines.entries()) {
      const debit = D(l.debit);
      const credit = D(l.credit);

      // A line is one side or the other. Allowing both invites entries that
      // balance line-by-line but hide the real movement.
      if (debit.gt(0) && credit.gt(0)) {
        throw new BadRequestException(
          `Line ${i + 1}: put an amount in either debit or credit, not both.`,
        );
      }
      if (debit.eq(0) && credit.eq(0)) {
        throw new BadRequestException(`Line ${i + 1}: debit and credit are both zero.`);
      }

      const account = await this.accounts.assertPostable(companyId, l.accountId);

      if (account.isControl && !l.bpId) {
        throw new BadRequestException(
          `Line ${i + 1}: account ${account.code} is a control account and requires a business partner.`,
        );
      }
      if (l.bpId) {
        const bp = await this.prisma.businessPartner.findFirst({
          where: { id: l.bpId, companyId },
          select: { id: true },
        });
        if (!bp) {
          throw new BadRequestException(`Line ${i + 1}: business partner not found in this company.`);
        }
      }
      if (l.costCenterId && l.distributionRuleId) {
        throw new BadRequestException(
          `Line ${i + 1}: set either a cost center or a distribution rule, not both.`,
        );
      }
    }
  }

  private mapLines(lines: JournalLineDto[]): Prisma.JournalLineCreateWithoutEntryInput[] {
    return lines.map((l, i) => ({
      account: { connect: { id: l.accountId } },
      debit: D(l.debit),
      credit: D(l.credit),
      description: l.description ?? null,
      ordering: l.ordering ?? i,
      ...(l.bpId ? { bp: { connect: { id: l.bpId } } } : {}),
      ...(l.costCenterId ? { costCenter: { connect: { id: l.costCenterId } } } : {}),
      ...(l.distributionRuleId ? { distributionRule: { connect: { id: l.distributionRuleId } } } : {}),
      ...(l.projectId ? { project: { connect: { id: l.projectId } } } : {}),
      ...(l.taxCodeId ? { taxCode: { connect: { id: l.taxCodeId } } } : {}),
      ...(l.taxAmount !== undefined ? { taxAmount: D(l.taxAmount) } : {}),
      ...(l.dueDate ? { dueDate: new Date(l.dueDate) } : {}),
      ref1: l.ref1 ?? null,
      ref2: l.ref2 ?? null,
      ref3: l.ref3 ?? null,
    }));
  }
}
