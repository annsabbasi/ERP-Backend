import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  PeriodEndClosingStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalEntriesService } from '../../financials/journal-entries/journal-entries.service';
import { ledgerStatusWhere } from '../../financials/ledger-status';
import { NumberingService } from '../numbering/numbering.service';

const ZERO = new Prisma.Decimal(0);

export interface ClosingLine {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
  /** Net movement over the range: positive = credit balance (income-like). */
  balance: string;
}

/**
 * The Utilities folder.
 *
 * Period-End Closing is the only one of these with real accounting weight, so
 * it is written as preview-then-execute against a stored run: the operator sees
 * exactly what will post, and the row that showed them survives so the
 * "Previous Report" button has something truthful to reprint.
 */
@Injectable()
export class UtilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalEntriesService,
    private readonly numbering: NumberingService,
  ) {}

  // ── PERIOD-END CLOSING ─────────────────────────────────────────────────────

  /**
   * Works out what a closing would post, without posting it.
   *
   * Only P&L accounts are closed. Balance-sheet accounts carry forward by
   * definition, and sweeping them into retained earnings would zero the
   * company's assets — the classic way to destroy a ledger with one click.
   */
  async previewPeriodEndClosing(
    companyId: string,
    dto: {
      fromPeriodId: string;
      toPeriodId: string;
      retainedEarningsAccountId: string;
      closingAccountId?: string;
      usePrimaryClosingAccount?: boolean;
    },
  ) {
    const { from, to } = await this.resolveRange(companyId, dto.fromPeriodId, dto.toPeriodId);
    const retained = await this.requireAccount(companyId, dto.retainedEarningsAccountId, 'Retained earnings');
    if (dto.closingAccountId) {
      await this.requireAccount(companyId, dto.closingAccountId, 'Period-end closing');
    }

    // Grouped in the database; the ledger is never pulled into Node.
    //
    // The status clause comes from `ledgerStatusWhere` and must never be
    // hand-written as `status: POSTED`. Reversing an entry does not remove it:
    // it posts a mirror entry and both rows stay, so filtering on POSTED alone
    // drops the original while keeping its reversal and every balance shifts by
    // the reversal amount in the wrong direction.
    //
    // That is worse here than in a report. `executePeriodEndClosing` recomputes
    // this and posts the result as retained earnings, and the entry still
    // passes its balance check — because `netResult` is derived from the same
    // corrupted sums, so both sides are wrong by the same amount. Preview and
    // Execute would agree with each other and disagree with the ledger.
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        companyId,
        entry: {
          companyId,
          ...ledgerStatusWhere(),
          date: { gte: from.startDate, lte: to.endDate },
        },
        account: { type: { in: [AccountType.INCOME, AccountType.EXPENSE] } },
      },
      _sum: { debit: true, credit: true },
    });

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) }, companyId },
      select: { id: true, code: true, name: true, type: true, isTitle: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const lines: ClosingLine[] = [];
    let netDebit = ZERO;
    let netCredit = ZERO;

    for (const r of rows) {
      const account = byId.get(r.accountId);
      if (!account || account.isTitle) continue;

      const debit = r._sum.debit ?? ZERO;
      const credit = r._sum.credit ?? ZERO;
      const balance = credit.minus(debit); // credit-positive

      // A P&L account with no net movement has nothing to close. Including it
      // would put a zero line in the journal and make the report unreadable.
      if (balance.isZero()) continue;

      // The closing entry reverses each account's balance: an account carrying
      // a credit balance is debited to bring it to nil, and vice versa.
      if (balance.gt(0)) netDebit = netDebit.plus(balance);
      else netCredit = netCredit.plus(balance.abs());

      lines.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        balance: balance.toFixed(2),
      });
    }

    lines.sort((a, b) => a.code.localeCompare(b.code));

    // The difference between the two sides is the profit (or loss) that goes to
    // retained earnings, which is what makes the whole entry balance.
    const result = netDebit.minus(netCredit);

    return {
      from: { id: from.id, name: from.name, startDate: from.startDate },
      to: { id: to.id, name: to.name, endDate: to.endDate },
      retainedEarnings: { id: retained.id, code: retained.code, name: retained.name },
      lines,
      totalDebit: netDebit.toFixed(2),
      totalCredit: netCredit.toFixed(2),
      /** Positive = profit credited to retained earnings. */
      netResult: result.toFixed(2),
      willPost: lines.length > 0,
    };
  }

  /**
   * Posts the closing.
   *
   * The preview is recomputed here rather than trusted from the client: the
   * ledger can move between the operator pressing Preview and pressing Execute,
   * and posting numbers the database no longer agrees with is how a closing
   * ends up out of balance.
   */
  async executePeriodEndClosing(
    companyId: string,
    userId: string,
    dto: {
      fromPeriodId: string;
      toPeriodId: string;
      retainedEarningsAccountId: string;
      closingAccountId?: string;
      usePrimaryClosingAccount?: boolean;
      postingDate?: string;
    },
  ) {
    const preview = await this.previewPeriodEndClosing(companyId, dto);

    if (!preview.willPost) {
      throw new BadRequestException(
        'There is nothing to close: no posted profit-and-loss movement in that period range.',
      );
    }

    const postingDate = dto.postingDate ? new Date(dto.postingDate) : preview.to.endDate;
    const net = new Prisma.Decimal(preview.netResult);

    // Each P&L account is taken to nil, and the net goes to retained earnings.
    const journalLines: { accountId: string; debit?: number; credit?: number; description?: string }[] =
      preview.lines.map((l) => {
        const balance = new Prisma.Decimal(l.balance);
        return balance.gt(0)
          ? { accountId: l.accountId, debit: Number(balance.toFixed(2)), description: `Period-end closing — ${l.code}` }
          : { accountId: l.accountId, credit: Number(balance.abs().toFixed(2)), description: `Period-end closing — ${l.code}` };
      });

    if (net.isZero()) {
      throw new BadRequestException(
        'The period nets to zero, so a closing entry would post nothing. Nothing was posted.',
      );
    }

    journalLines.push(
      net.gt(0)
        ? {
            accountId: dto.retainedEarningsAccountId,
            credit: Number(net.toFixed(2)),
            description: 'Period-end closing — net profit to retained earnings',
          }
        : {
            accountId: dto.retainedEarningsAccountId,
            debit: Number(net.abs().toFixed(2)),
            description: 'Period-end closing — net loss to retained earnings',
          },
    );

    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.periodEndClosingRun.create({
          data: {
            companyId,
            fromPeriodId: dto.fromPeriodId,
            toPeriodId: dto.toPeriodId,
            retainedEarningsAccountId: dto.retainedEarningsAccountId,
            closingAccountId: dto.closingAccountId ?? null,
            usePrimaryClosingAccount: dto.usePrimaryClosingAccount ?? true,
            status: PeriodEndClosingStatus.PREVIEW,
            lines: preview.lines as unknown as Prisma.InputJsonValue,
            totalDebit: new Prisma.Decimal(preview.totalDebit),
            totalCredit: new Prisma.Decimal(preview.totalCredit),
            executedById: userId,
          },
        });

        // Goes through the same posting path as every other module, so the
        // closing gets the same balance checks, period resolution and numbering
        // as a hand-keyed entry rather than a private route to the ledger.
        const entry = await this.journals.postFromSource(tx, companyId, userId, {
          date: postingDate,
          source: 'period_end_closing',
          sourceId: run.id,
          description: `Period-end closing ${preview.from.name} → ${preview.to.name}`,
          reference: run.id,
          area: 'general',
          lines: journalLines as never,
        });

        return tx.periodEndClosingRun.update({
          where: { id: run.id },
          data: {
            status: PeriodEndClosingStatus.EXECUTED,
            journalEntryId: entry.id,
            executedAt: new Date(),
          },
        });
      },
      // Default is 5s. Against the cross-region pooled connection this app
      // runs against, three round trips (create, numbering allocation +
      // journal post, update) routinely exceed that — see the identical fix
      // in SettingsService.saveCompanyDetails. Without this, Execute silently
      // rolls back with a P2028 after the preview already succeeded, which
      // looks to the operator like the button does nothing.
      { timeout: 15_000, maxWait: 10_000 },
    );
  }

  /** "Previous Report" — the runs already made, newest first. */
  listPeriodEndClosingRuns(companyId: string, take = 50) {
    return this.prisma.periodEndClosingRun.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 200),
      include: { executedBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async getPeriodEndClosingRun(companyId: string, id: string) {
    const run = await this.prisma.periodEndClosingRun.findFirst({
      where: { id, companyId },
      include: { executedBy: { select: { id: true, name: true, email: true } } },
    });
    if (!run) throw new NotFoundException('Closing run not found.');
    return run;
  }

  // ── CHECK DOCUMENT NUMBERING ───────────────────────────────────────────────

  /**
   * The Check Document Numbering window.
   *
   * Reports two different faults, because they have different causes: a series
   * whose configuration is broken (checked by the numbering service), and a
   * document range with gaps or duplicates, which means numbers were allocated
   * and the documents then deleted.
   */
  async checkDocumentNumbering(
    companyId: string,
    filters: { documentTypes?: string[]; from?: Date; to?: Date } = {},
  ) {
    const seriesIssues = await this.numbering.check(companyId);

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        companyId,
        ...(filters.from || filters.to
          ? {
              date: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      select: { id: true, number: true, date: true, status: true, seriesId: true },
      orderBy: { number: 'asc' },
    });

    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    for (const e of entries) {
      const n = (seen.get(e.number) ?? 0) + 1;
      seen.set(e.number, n);
      if (n === 2) duplicates.push(e.number);
    }

    // Gaps are found on the numeric tail so a prefix change does not read as a
    // gap. A gap is reported, never repaired: silently renumbering posted
    // documents would rewrite history to make a report look tidy.
    const numeric = entries
      .map((e) => Number(e.number.replace(/\D+/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    const gaps: { after: number; before: number; missing: number }[] = [];
    for (let i = 1; i < numeric.length; i++) {
      const diff = numeric[i] - numeric[i - 1];
      if (diff > 1) {
        gaps.push({ after: numeric[i - 1], before: numeric[i], missing: diff - 1 });
      }
    }

    return {
      checkedDocuments: entries.length,
      seriesIssues: seriesIssues.issues,
      duplicates,
      gaps,
      isClean: seriesIssues.issueCount === 0 && duplicates.length === 0 && gaps.length === 0,
    };
  }

  // ── CHANGE LOGS CLEANUP ────────────────────────────────────────────────────

  /** How much history a cleanup would remove, before it removes any. */
  async previewChangeLogCleanup(companyId: string, olderThan: Date) {
    const [activity, audit] = await Promise.all([
      this.prisma.activityLog.count({ where: { companyId, createdAt: { lt: olderThan } } }),
      this.prisma.auditEvent.count({ where: { companyId, at: { lt: olderThan } } }),
    ]);
    return { olderThan, activityLogs: activity, auditEvents: audit, total: activity + audit };
  }

  /**
   * Deletes change history older than a cut-off.
   *
   * Audit events are kept: they are the record of who did what, which is
   * exactly what a cleanup must not be able to erase. Only the activity log —
   * the noisy, reconstructable half — is removed.
   */
  async runChangeLogCleanup(companyId: string, userId: string, olderThan: Date) {
    if (olderThan > new Date()) {
      throw new BadRequestException('The cut-off date is in the future — that would delete everything.');
    }

    const removed = await this.prisma.activityLog.deleteMany({
      where: { companyId, createdAt: { lt: olderThan } },
    });

    await this.prisma.supportUserLogEntry.create({
      data: {
        companyId,
        userId,
        action: 'CHANGE_LOG_CLEANUP',
        detail: `Removed ${removed.count} activity log row(s) older than ${olderThan.toISOString().slice(0, 10)}.`,
      },
    });

    return {
      removedActivityLogs: removed.count,
      keptAuditEvents: true,
      message:
        `Removed ${removed.count} activity log row(s). Audit events were kept — they are the ` +
        'record of who changed what and are not eligible for cleanup.',
    };
  }

  // ── CONNECTED CLIENTS ──────────────────────────────────────────────────────

  /**
   * Who is signed in right now, derived from live refresh tokens.
   *
   * There is no session table, and adding one would be a second source of truth
   * for "is this user signed in". An unrevoked, unexpired refresh token is that
   * fact already.
   */
  async connectedClients(companyId: string) {
    const rows = await this.prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { companyId, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        ip: true,
        userAgent: true,
        user: { select: { id: true, name: true, email: true, roleType: true, lastLoginAt: true } },
      },
    });

    // One row per user: a user with three devices is one connected client in
    // the sense the window means, with a device count beside them.
    const byUser = new Map<string, { user: (typeof rows)[number]['user']; sessions: typeof rows }>();
    for (const r of rows) {
      const bucket = byUser.get(r.user.id) ?? { user: r.user, sessions: [] as typeof rows };
      bucket.sessions.push(r);
      byUser.set(r.user.id, bucket);
    }

    return [...byUser.values()].map((b) => ({
      user: b.user,
      sessionCount: b.sessions.length,
      lastSeenAt: b.sessions[0].createdAt,
      sessions: b.sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        ipAddress: s.ip,
        userAgent: s.userAgent,
      })),
    }));
  }

  /** Signs a user out everywhere by revoking their live refresh tokens. */
  async disconnectClient(companyId: string, actorId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found in this company.');

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.prisma.supportUserLogEntry.create({
      data: {
        companyId,
        userId: actorId,
        action: 'CLIENT_DISCONNECTED',
        detail: `Signed ${user.email} out of ${revoked.count} session(s).`,
      },
    });

    return { userId, revokedSessions: revoked.count, message: `${user.email} signed out.` };
  }

  // ── MASTER DATA CLEANUP ────────────────────────────────────────────────────

  /**
   * Finds master data that is inactive and unreferenced.
   *
   * Reports only — nothing is deleted here. A "cleanup wizard" that deletes on
   * a single click is how a company loses a business partner that turned out to
   * be referenced by a document the query did not think to check.
   */
  async masterDataCleanupCandidates(companyId: string) {
    const [partners, products, texts] = await Promise.all([
      this.prisma.businessPartner.findMany({
        where: {
          companyId,
          isActive: false,
          arInvoices: { none: {} },
          apBills: { none: {} },
        },
        select: { id: true, cardCode: true, cardName: true, cardType: true, updatedAt: true },
        take: 500,
      }),
      this.prisma.product.findMany({
        where: { companyId, isActive: false, orderItems: { none: {} } },
        select: { id: true, sku: true, name: true, updatedAt: true },
        take: 500,
      }),
      this.prisma.predefinedText.findMany({
        where: { companyId, isActive: false },
        select: { id: true, code: true, name: true, updatedAt: true },
        take: 500,
      }),
    ]);

    return {
      businessPartners: partners,
      products,
      predefinedTexts: texts,
      total: partners.length + products.length + texts.length,
      note:
        'These rows are inactive and carry no referencing documents. Review before deleting — ' +
        'this report does not delete anything.',
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async resolveRange(companyId: string, fromId: string, toId: string) {
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: { companyId, id: { in: [fromId, toId] } },
      select: { id: true, name: true, startDate: true, endDate: true, status: true },
    });

    const from = periods.find((p) => p.id === fromId);
    const to = periods.find((p) => p.id === toId);
    if (!from || !to) throw new NotFoundException('One or both posting periods were not found.');
    if (to.endDate < from.startDate) {
      throw new BadRequestException('The "to" period ends before the "from" period begins.');
    }
    return { from, to };
  }

  private async requireAccount(companyId: string, accountId: string, label: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId },
      select: { id: true, code: true, name: true, type: true, isTitle: true },
    });
    if (!account) throw new NotFoundException(`${label} account not found in this company.`);
    if (account.isTitle) {
      throw new BadRequestException(
        `${label} account ${account.code} is a title account and cannot be posted to.`,
      );
    }
    return account;
  }
}
