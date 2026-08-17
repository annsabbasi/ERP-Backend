import { Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerStatusWhere } from '../ledger-status';

const ZERO = new Prisma.Decimal(0);

/** Types whose balances close out to retained earnings at year end. */
const P_AND_L_TYPES: AccountType[] = [AccountType.INCOME, AccountType.EXPENSE];
const BALANCE_SHEET_TYPES: AccountType[] = [
  AccountType.ASSET,
  AccountType.LIABILITY,
  AccountType.EQUITY,
];

/**
 * A debit increases assets and expenses but decreases liabilities, equity and
 * income. Reports present every figure as a positive number in its natural
 * direction, so the sign is normalised per type rather than left raw.
 */
function naturalBalance(type: AccountType, debit: Prisma.Decimal, credit: Prisma.Decimal) {
  return type === AccountType.ASSET || type === AccountType.EXPENSE
    ? debit.minus(credit)
    : credit.minus(debit);
}

export interface ReportRange {
  from?: Date;
  to?: Date;
  includeUnposted?: boolean;
  includeZeroBalances?: boolean;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isTitle: boolean;
  level: number;
}

/** A rolled-up node as it appears in a report payload. */
export interface ReportNode {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isTitle: boolean;
  level: number;
  amount: string;
  children: ReportNode[];
}

@Injectable()
export class FinancialReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Movement per account for a range, keyed by accountId.
   * One grouped query — the ledger is never materialised in Node.
   */
  private async movements(companyId: string, range: ReportRange) {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          companyId,
          ...ledgerStatusWhere(range.includeUnposted),
          ...(range.from || range.to
            ? {
                date: {
                  ...(range.from ? { gte: range.from } : {}),
                  ...(range.to ? { lte: range.to } : {}),
                },
              }
            : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    const map = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const r of rows) {
      map.set(r.accountId, {
        debit: r._sum.debit ?? ZERO,
        credit: r._sum.credit ?? ZERO,
      });
    }
    return map;
  }

  private async accounts(companyId: string, types?: AccountType[]): Promise<AccountRow[]> {
    return this.prisma.account.findMany({
      where: { companyId, ...(types ? { type: { in: types } } : {}) },
      select: {
        id: true, code: true, name: true, type: true,
        parentId: true, isTitle: true, level: true,
      },
      orderBy: { code: 'asc' },
    });
  }

  // ── TRIAL BALANCE ──────────────────────────────────────────────────────────
  async trialBalance(companyId: string, range: ReportRange = {}) {
    const [accounts, moves] = await Promise.all([
      this.accounts(companyId),
      this.movements(companyId, range),
    ]);

    // Opening balance = everything strictly before `from`.
    const opening = range.from
      ? await this.movements(companyId, {
          to: new Date(range.from.getTime() - 1),
          includeUnposted: range.includeUnposted,
        })
      : new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();

    let totalDebit = ZERO;
    let totalCredit = ZERO;

    const rows = accounts
      .filter((a) => !a.isTitle)
      .map((a) => {
        const m = moves.get(a.id) ?? { debit: ZERO, credit: ZERO };
        const o = opening.get(a.id) ?? { debit: ZERO, credit: ZERO };
        const openingBalance = naturalBalance(a.type, o.debit, o.credit);
        const closing = naturalBalance(
          a.type,
          o.debit.plus(m.debit),
          o.credit.plus(m.credit),
        );
        totalDebit = totalDebit.plus(m.debit);
        totalCredit = totalCredit.plus(m.credit);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          opening: openingBalance.toFixed(2),
          debit: m.debit.toFixed(2),
          credit: m.credit.toFixed(2),
          closing: closing.toFixed(2),
        };
      })
      .filter((r) =>
        range.includeZeroBalances
          ? true
          : r.debit !== '0.00' || r.credit !== '0.00' || r.closing !== '0.00',
      );

    return {
      range: fmtRange(range),
      rows,
      totals: {
        debit: totalDebit.toFixed(2),
        credit: totalCredit.toFixed(2),
        // A non-zero difference means an unbalanced entry slipped through and
        // is worth surfacing rather than hiding.
        difference: totalDebit.minus(totalCredit).toFixed(2),
        balanced: totalDebit.equals(totalCredit),
      },
    };
  }

  // ── PROFIT & LOSS ──────────────────────────────────────────────────────────
  async profitAndLoss(companyId: string, range: ReportRange = {}) {
    const [accounts, moves] = await Promise.all([
      this.accounts(companyId, P_AND_L_TYPES),
      this.movements(companyId, range),
    ]);

    const tree = this.buildTree(accounts, moves);
    const income = tree.filter((n) => n.type === AccountType.INCOME);
    const expense = tree.filter((n) => n.type === AccountType.EXPENSE);

    const totalIncome = sum(income);
    const totalExpense = sum(expense);
    const net = totalIncome.minus(totalExpense);

    return {
      range: fmtRange(range),
      income: { sections: income, total: totalIncome.toFixed(2) },
      expenses: { sections: expense, total: totalExpense.toFixed(2) },
      grossProfit: totalIncome.toFixed(2),
      netProfit: net.toFixed(2),
      netProfitIsLoss: net.isNegative(),
    };
  }

  // ── BALANCE SHEET ──────────────────────────────────────────────────────────
  async balanceSheet(companyId: string, asOf: Date, opts: { includeUnposted?: boolean } = {}) {
    const range: ReportRange = { to: asOf, includeUnposted: opts.includeUnposted };
    const [accounts, moves] = await Promise.all([
      this.accounts(companyId, BALANCE_SHEET_TYPES),
      this.movements(companyId, range),
    ]);

    const tree = this.buildTree(accounts, moves);
    const assets = tree.filter((n) => n.type === AccountType.ASSET);
    const liabilities = tree.filter((n) => n.type === AccountType.LIABILITY);
    const equity = tree.filter((n) => n.type === AccountType.EQUITY);

    const totalAssets = sum(assets);
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity);

    // P&L accounts have not been closed to equity yet, so current-year profit
    // has to be folded in or the sheet will not balance.
    const pl = await this.profitAndLoss(companyId, range);
    const retained = new Prisma.Decimal(pl.netProfit);
    const equityWithResult = totalEquity.plus(retained);

    return {
      asOf: asOf.toISOString().slice(0, 10),
      assets: { sections: assets, total: totalAssets.toFixed(2) },
      liabilities: { sections: liabilities, total: totalLiabilities.toFixed(2) },
      equity: {
        sections: equity,
        currentYearResult: retained.toFixed(2),
        total: equityWithResult.toFixed(2),
      },
      totals: {
        assets: totalAssets.toFixed(2),
        liabilitiesAndEquity: totalLiabilities.plus(equityWithResult).toFixed(2),
        difference: totalAssets.minus(totalLiabilities.plus(equityWithResult)).toFixed(2),
        balanced: totalAssets.equals(totalLiabilities.plus(equityWithResult)),
      },
    };
  }

  // ── GENERAL LEDGER ─────────────────────────────────────────────────────────
  /** Running-balance detail per account — the drill-down behind every total. */
  async generalLedger(
    companyId: string,
    opts: ReportRange & { accountIds?: string[]; bpId?: string } = {},
  ) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        ...(opts.accountIds?.length ? { accountId: { in: opts.accountIds } } : {}),
        ...(opts.bpId ? { bpId: opts.bpId } : {}),
        entry: {
          companyId,
          ...ledgerStatusWhere(opts.includeUnposted),
          ...(opts.from || opts.to
            ? { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
            : {}),
        },
      },
      include: {
        account: { select: { id: true, code: true, name: true, type: true } },
        bp: { select: { id: true, cardCode: true, cardName: true } },
        entry: { select: { id: true, number: true, date: true, description: true, reference: true, status: true } },
      },
      orderBy: [{ account: { code: 'asc' } }, { entry: { date: 'asc' } }, { ordering: 'asc' }],
    });

    const opening = opts.from
      ? await this.movements(companyId, {
          to: new Date(opts.from.getTime() - 1),
          includeUnposted: opts.includeUnposted,
        })
      : new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();

    const groups = new Map<string, {
      account: { id: string; code: string; name: string; type: AccountType };
      opening: Prisma.Decimal;
      rows: unknown[];
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      closing: Prisma.Decimal;
    }>();

    for (const l of lines) {
      let g = groups.get(l.accountId);
      if (!g) {
        const o = opening.get(l.accountId) ?? { debit: ZERO, credit: ZERO };
        const openingBal = naturalBalance(l.account.type, o.debit, o.credit);
        g = {
          account: l.account,
          opening: openingBal,
          rows: [],
          debit: ZERO,
          credit: ZERO,
          closing: openingBal,
        };
        groups.set(l.accountId, g);
      }
      g.debit = g.debit.plus(l.debit);
      g.credit = g.credit.plus(l.credit);
      g.closing = g.closing.plus(naturalBalance(l.account.type, l.debit, l.credit));
      g.rows.push({
        lineId: l.id,
        entryId: l.entry.id,
        number: l.entry.number,
        date: l.entry.date,
        status: l.entry.status,
        description: l.description ?? l.entry.description,
        reference: l.entry.reference,
        businessPartner: l.bp ? { id: l.bp.id, cardCode: l.bp.cardCode, cardName: l.bp.cardName } : null,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        runningBalance: g.closing.toFixed(2),
      });
    }

    return {
      range: fmtRange(opts),
      accounts: [...groups.values()].map((g) => ({
        account: g.account,
        opening: g.opening.toFixed(2),
        debit: g.debit.toFixed(2),
        credit: g.credit.toFixed(2),
        closing: g.closing.toFixed(2),
        rows: g.rows,
      })),
    };
  }

  // ── AGING ──────────────────────────────────────────────────────────────────
  /**
   * Receivables or payables bucketed by how overdue they are.
   * Buckets follow the usual 0-30 / 31-60 / 61-90 / 90+ split.
   */
  async aging(
    companyId: string,
    kind: 'receivables' | 'payables',
    asOf: Date = new Date(),
  ) {
    const buckets = [
      { label: 'Current', min: -Infinity, max: 0 },
      { label: '1-30', min: 1, max: 30 },
      { label: '31-60', min: 31, max: 60 },
      { label: '61-90', min: 61, max: 90 },
      { label: '90+', min: 91, max: Infinity },
    ];

    const docs =
      kind === 'receivables'
        ? await this.prisma.aRInvoice.findMany({
            where: {
              companyId,
              status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
              issueDate: { lte: asOf },
            },
            include: { bp: { select: { id: true, cardCode: true, cardName: true } } },
          })
        : await this.prisma.aPBill.findMany({
            where: {
              companyId,
              status: { in: ['APPROVED', 'PARTIALLY_PAID', 'OVERDUE'] },
              issueDate: { lte: asOf },
            },
            include: { bp: { select: { id: true, cardCode: true, cardName: true } } },
          });

    const byPartner = new Map<string, {
      partner: { id: string; cardCode: string; cardName: string };
      buckets: Record<string, number>;
      total: number;
    }>();

    for (const d of docs) {
      // Amounts are stored in minor units; the report works in major units.
      const outstanding = (d.totalMinor - d.paidMinor) / 100;
      if (outstanding <= 0) continue;

      const due = d.dueDate ?? d.issueDate;
      const daysOverdue = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
      const bucket = buckets.find((b) => daysOverdue >= b.min && daysOverdue <= b.max) ?? buckets[0];

      let row = byPartner.get(d.bpId);
      if (!row) {
        row = {
          partner: d.bp,
          buckets: Object.fromEntries(buckets.map((b) => [b.label, 0])),
          total: 0,
        };
        byPartner.set(d.bpId, row);
      }
      row.buckets[bucket.label] += outstanding;
      row.total += outstanding;
    }

    const rows = [...byPartner.values()]
      .map((r) => ({
        partner: r.partner,
        buckets: Object.fromEntries(
          Object.entries(r.buckets).map(([k, v]) => [k, v.toFixed(2)]),
        ),
        total: r.total.toFixed(2),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total));

    const totals = Object.fromEntries(
      buckets.map((b) => [
        b.label,
        [...byPartner.values()].reduce((s, r) => s + r.buckets[b.label], 0).toFixed(2),
      ]),
    );

    return {
      kind,
      asOf: asOf.toISOString().slice(0, 10),
      bucketLabels: buckets.map((b) => b.label),
      rows,
      totals: {
        ...totals,
        grandTotal: [...byPartner.values()].reduce((s, r) => s + r.total, 0).toFixed(2),
      },
    };
  }

  // ── DOCUMENT JOURNAL ───────────────────────────────────────────────────────
  /** Chronological list of every posted entry with its lines — the audit view. */
  async documentJournal(companyId: string, range: ReportRange = {}) {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        companyId,
        ...ledgerStatusWhere(range.includeUnposted),
        ...(range.from || range.to
          ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
          : {}),
      },
      include: {
        lines: {
          orderBy: { ordering: 'asc' },
          include: { account: { select: { code: true, name: true } } },
        },
        period: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
    });

    return {
      range: fmtRange(range),
      count: entries.length,
      entries: entries.map((e) => ({
        id: e.id,
        number: e.number,
        date: e.date,
        period: e.period.name,
        status: e.status,
        source: e.source,
        description: e.description,
        reference: e.reference,
        totalDebit: e.totalDebit.toFixed(2),
        totalCredit: e.totalCredit.toFixed(2),
        lines: e.lines.map((l) => ({
          accountCode: l.account.code,
          accountName: l.account.name,
          description: l.description,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
        })),
      })),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  /**
   * Rolls leaf balances up through the CoA hierarchy so a Title account shows
   * the sum of everything beneath it.
   */
  private buildTree(
    accounts: AccountRow[],
    moves: Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>,
  ) {
    interface Node {
      id: string; code: string; name: string; type: AccountType;
      isTitle: boolean; level: number;
      amount: string; _raw: Prisma.Decimal; children: Node[];
    }

    const byId = new Map<string, Node>();
    for (const a of accounts) {
      const m = moves.get(a.id) ?? { debit: ZERO, credit: ZERO };
      byId.set(a.id, {
        id: a.id, code: a.code, name: a.name, type: a.type,
        isTitle: a.isTitle, level: a.level,
        _raw: naturalBalance(a.type, m.debit, m.credit),
        amount: '0.00',
        children: [],
      });
    }

    const roots: Node[] = [];
    for (const a of accounts) {
      const node = byId.get(a.id)!;
      const parent = a.parentId ? byId.get(a.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    // Post-order so a parent sees its children's totals already rolled up.
    const roll = (n: Node): Prisma.Decimal => {
      let total = n._raw;
      for (const c of n.children) total = total.plus(roll(c));
      n.amount = total.toFixed(2);
      n._raw = total;
      return total;
    };
    roots.forEach(roll);

    // `_raw` is a Decimal accumulator used only while rolling up; it is dropped
    // from the response so the payload carries fixed-precision strings only.
    const strip = (n: Node): ReportNode => ({
      id: n.id, code: n.code, name: n.name, type: n.type,
      isTitle: n.isTitle, level: n.level, amount: n.amount,
      children: n.children.map(strip),
    });

    return roots.map(strip);
  }
}

function sum(nodes: { amount: string }[]): Prisma.Decimal {
  return nodes.reduce((acc, n) => acc.plus(new Prisma.Decimal(n.amount)), ZERO);
}

function fmtRange(r: ReportRange) {
  return {
    from: r.from ? r.from.toISOString().slice(0, 10) : null,
    to: r.to ? r.to.toISOString().slice(0, 10) : null,
    includeUnposted: !!r.includeUnposted,
  };
}
