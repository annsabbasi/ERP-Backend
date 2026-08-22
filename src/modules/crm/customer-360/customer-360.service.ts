import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerStatusWhere } from '../../financials/ledger-status';

const ZERO = new Prisma.Decimal(0);

/**
 * Customer 360.
 *
 * One aggregate read that answers "everything we know about this partner":
 * master data, open receivables/payables, aging, recent activity, the open
 * pipeline and ledger movement. The window renders panels from a single call
 * rather than firing a dozen requests and stitching them client-side.
 */
@Injectable()
export class Customer360Service {
  constructor(private readonly prisma: PrismaService) {}

  async overview(companyId: string, bpId: string) {
    const bp = await this.prisma.businessPartner.findFirst({
      where: { id: bpId, companyId },
      include: {
        group: { select: { id: true, code: true, name: true } },
        territory: { select: { id: true, name: true } },
        salesEmployee: { select: { id: true, code: true, name: true, email: true } },
        paymentTerms: { select: { id: true, code: true, name: true, netDays: true } },
        contacts: { orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] },
        addresses: { orderBy: [{ isDefault: 'desc' }] },
        bankAccounts: true,
      },
    });
    if (!bp) throw new NotFoundException('Business partner not found');

    const now = new Date();

    const [
      arInvoices,
      apBills,
      activities,
      opportunities,
      oppTotals,
      ledger,
      lastActivity,
    ] = await Promise.all([
      this.prisma.aRInvoice.findMany({
        where: { companyId, bpId, status: { notIn: ['VOID', 'DRAFT'] } },
        orderBy: { issueDate: 'desc' },
        take: 25,
        select: {
          id: true, number: true, issueDate: true, dueDate: true, status: true,
          currency: true, total: true, paid: true,
        },
      }),
      this.prisma.aPBill.findMany({
        where: { companyId, bpId, status: { notIn: ['VOID', 'DRAFT'] } },
        orderBy: { issueDate: 'desc' },
        take: 25,
        select: {
          id: true, number: true, issueDate: true, dueDate: true, status: true,
          currency: true, total: true, paid: true,
        },
      }),
      this.prisma.activity.findMany({
        where: { companyId, bpId },
        orderBy: { startDate: 'desc' },
        take: 20,
        include: {
          assignedTo: { select: { id: true, name: true } },
          contactPerson: { select: { id: true, name: true } },
        },
      }),
      this.prisma.opportunity.findMany({
        where: { companyId, bpId },
        orderBy: { startDate: 'desc' },
        take: 20,
        include: {
          currentStage: { select: { id: true, stageNo: true, name: true } },
          salesEmployee: { select: { id: true, name: true } },
        },
      }),
      this.prisma.opportunity.groupBy({
        by: ['status'],
        where: { companyId, bpId },
        _sum: { potentialAmount: true, weightedAmount: true },
        _count: { _all: true },
      }),
      this.prisma.journalLine.aggregate({
        where: { bpId, entry: { companyId, ...ledgerStatusWhere() } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.activity.findFirst({
        where: { companyId, bpId },
        orderBy: { startDate: 'desc' },
        select: { startDate: true, subject: true },
      }),
    ]);

    // Open balances and aging, computed from the same document set the window
    // shows so the totals always reconcile with the rows beneath them.
    const openAr = sumOpen(arInvoices);
    const openAp = sumOpen(apBills);
    const aging = bucketize(arInvoices, now);

    const debit = ledger._sum.debit ?? ZERO;
    const credit = ledger._sum.credit ?? ZERO;

    const oppByStatus = Object.fromEntries(
      oppTotals.map((t) => [
        t.status,
        {
          count: t._count._all,
          potential: (t._sum.potentialAmount ?? ZERO).toFixed(2),
          weighted: (t._sum.weightedAmount ?? ZERO).toFixed(2),
        },
      ]),
    );

    const creditLimit = bp.creditLimit ?? null;
    const overCreditLimit =
      creditLimit !== null && new Prisma.Decimal(openAr).greaterThan(creditLimit);

    return {
      partner: bp,
      summary: {
        currency: bp.currency,
        openReceivables: openAr.toFixed(2),
        openPayables: openAp.toFixed(2),
        creditLimit: creditLimit ? creditLimit.toFixed(2) : null,
        creditAvailable: creditLimit ? creditLimit.minus(openAr).toFixed(2) : null,
        overCreditLimit,
        ledgerDebit: debit.toFixed(2),
        ledgerCredit: credit.toFixed(2),
        ledgerBalance: debit.minus(credit).toFixed(2),
        openOpportunities: oppByStatus.OPEN?.count ?? 0,
        openOpportunityValue: oppByStatus.OPEN?.potential ?? '0.00',
        wonOpportunities: oppByStatus.WON?.count ?? 0,
        lostOpportunities: oppByStatus.LOST?.count ?? 0,
        openActivities: activities.filter((a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS').length,
        lastActivityAt: lastActivity?.startDate ?? null,
        lastActivitySubject: lastActivity?.subject ?? null,
      },
      aging,
      arInvoices: arInvoices.map(withOutstanding),
      apBills: apBills.map(withOutstanding),
      activities,
      opportunities,
      opportunityTotals: oppByStatus,
    };
  }

  /** Inactive Customers report — partners with no activity since a cutoff. */
  async inactiveCustomers(companyId: string, sinceDays = 90) {
    const cutoff = new Date(Date.now() - sinceDays * 86_400_000);

    const partners = await this.prisma.businessPartner.findMany({
      where: {
        companyId,
        cardType: { in: ['CUSTOMER', 'LEAD'] },
        isActive: true,
        // No activity and no invoice raised inside the window.
        activities: { none: { startDate: { gte: cutoff } } },
        arInvoices: { none: { issueDate: { gte: cutoff } } },
      },
      select: {
        id: true, cardCode: true, cardName: true, email: true, phone1: true,
        accountBalance: true, currency: true,
        salesEmployee: { select: { id: true, name: true } },
        activities: {
          orderBy: { startDate: 'desc' },
          take: 1,
          select: { startDate: true, subject: true },
        },
        arInvoices: {
          orderBy: { issueDate: 'desc' },
          take: 1,
          select: { issueDate: true, number: true },
        },
      },
      orderBy: { cardName: 'asc' },
    });

    return {
      sinceDays,
      cutoff: cutoff.toISOString().slice(0, 10),
      count: partners.length,
      rows: partners.map((p) => ({
        id: p.id,
        cardCode: p.cardCode,
        cardName: p.cardName,
        email: p.email,
        phone: p.phone1,
        currency: p.currency,
        balance: p.accountBalance.toFixed(2),
        salesEmployee: p.salesEmployee,
        lastActivityAt: p.activities[0]?.startDate ?? null,
        lastInvoiceAt: p.arInvoices[0]?.issueDate ?? null,
      })),
    };
  }

  /** Customers Credit Limit Deviation — anyone over their limit. */
  async creditLimitDeviation(companyId: string) {
    const partners = await this.prisma.businessPartner.findMany({
      where: { companyId, cardType: 'CUSTOMER', isActive: true, creditLimit: { not: null } },
      select: {
        id: true, cardCode: true, cardName: true, currency: true, creditLimit: true,
        arInvoices: {
          where: { status: { notIn: ['VOID', 'DRAFT', 'PAID'] } },
          select: { total: true, paid: true },
        },
      },
    });

    const rows = partners
      .map((p) => {
        const open = sumOpen(p.arInvoices);
        const limit = p.creditLimit!;
        const deviation = open.minus(limit);
        return {
          id: p.id,
          cardCode: p.cardCode,
          cardName: p.cardName,
          currency: p.currency,
          creditLimit: limit.toFixed(2),
          openBalance: open.toFixed(2),
          deviation: deviation.toFixed(2),
          overLimit: deviation.greaterThan(0),
        };
      })
      .filter((r) => r.overLimit)
      .sort((a, b) => Number(b.deviation) - Number(a.deviation));

    return { count: rows.length, rows };
  }
}

interface DocLike {
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  dueDate?: Date | null;
  issueDate?: Date;
}

function sumOpen(docs: DocLike[]): Prisma.Decimal {
  // Amounts are Decimal(19,4) in major units — no conversion, and no float
  // arithmetic anywhere on the path.
  return docs.reduce(
    (acc, d) => acc.plus(new Prisma.Decimal(d.total).minus(d.paid)),
    new Prisma.Decimal(0),
  );
}

function withOutstanding<T extends DocLike>(d: T) {
  return {
    ...d,
    total: new Prisma.Decimal(d.total).toFixed(2),
    paid: new Prisma.Decimal(d.paid).toFixed(2),
    outstanding: new Prisma.Decimal(d.total).minus(d.paid).toFixed(2),
  };
}

function bucketize(docs: DocLike[], asOf: Date) {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const d of docs) {
    const outstanding = Number(new Prisma.Decimal(d.total).minus(d.paid));
    if (outstanding <= 0) continue;
    const due = d.dueDate ?? d.issueDate ?? asOf;
    const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
    if (days <= 0) buckets.current += outstanding;
    else if (days <= 30) buckets.d1_30 += outstanding;
    else if (days <= 60) buckets.d31_60 += outstanding;
    else if (days <= 90) buckets.d61_90 += outstanding;
    else buckets.d90plus += outstanding;
  }
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toFixed(2)]));
}
