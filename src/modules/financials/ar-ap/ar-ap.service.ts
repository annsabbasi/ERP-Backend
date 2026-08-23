import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { APBillStatus, ARInvoiceStatus, BpCardType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../../administration/numbering/numbering.service';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalLineDto } from '../journal-entries/dto/journal-entry.dto';
import { AccountDeterminationService } from '../setup/setup.services';
import { ListQuery } from '../../../common/crud/tenant-crud.service';
import {
  APBillLineDto,
  ARInvoiceLineDto,
  CreateAPBillDto,
  CreateARInvoiceDto,
  RecordPaymentDto,
  UpdateAPBillDto,
  UpdateARInvoiceDto,
  VoidDocumentDto,
} from './ar-ap.dto';

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);
const ZERO = new Prisma.Decimal(0);

/**
 * Money is rounded to two places at the point it is computed, not at the point
 * it is displayed. The columns hold four, but a line total that keeps four
 * places and a header that keeps two will disagree by fractions of a cent, and
 * the posted-entry balance guard treats any disagreement as corruption. Rounding
 * once, early, keeps the line sum and the header identical by construction.
 */
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Journal amounts cross into the journal DTO, which is typed in plain numbers. */
const num = (v: Prisma.Decimal) => Number(v.toFixed(2));

/**
 * Which G/L account each side of a posting lands on. These are keys into
 * Administration → Setup → Financials → G/L Account Determination, not
 * hard-coded account codes: a company decides for itself which account is its
 * receivables control.
 */
const DETERMINATION = {
  receivables: { area: 'SALES', key: 'domestic_ar' },
  revenue: { area: 'SALES', key: 'revenue' },
  salesTax: { area: 'SALES', key: 'tax_payable' },
  payables: { area: 'PURCHASING', key: 'domestic_ap' },
  expense: { area: 'PURCHASING', key: 'expense' },
  purchaseTax: { area: 'PURCHASING', key: 'tax_receivable' },
  cash: { area: 'GENERAL', key: 'cash' },
} as const;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const AR_INCLUDE = {
  lines: {
    orderBy: { ordering: 'asc' as const },
    include: { account: { select: { id: true, code: true, name: true } } },
  },
  payments: { orderBy: { receivedAt: 'desc' as const } },
  bp: { select: { id: true, cardCode: true, cardName: true, cardType: true } },
  journalEntry: { select: { id: true, number: true, status: true } },
  paymentTerms: { select: { id: true, code: true, name: true, netDays: true } },
};

const AP_INCLUDE = {
  lines: {
    orderBy: { ordering: 'asc' as const },
    include: { account: { select: { id: true, code: true, name: true } } },
  },
  payments: { orderBy: { paidAt: 'desc' as const } },
  bp: { select: { id: true, cardCode: true, cardName: true, cardType: true } },
  journalEntry: { select: { id: true, number: true, status: true } },
  paymentTerms: { select: { id: true, code: true, name: true, netDays: true } },
};

/**
 * Shared behaviour between the two subledgers.
 *
 * The rule both of them follow, and the reason they are written together: a
 * subledger never writes to the ledger itself. Every posting goes through
 * `JournalEntriesService.postFromSource` and every unposting through
 * `reverseFromSource`, so the balance, immutability and period rules enforced
 * there apply to invoices and bills exactly as they apply to a hand-keyed
 * journal. There is deliberately no second route from AR/AP to journal_lines.
 */
abstract class SubledgerService {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly journals: JournalEntriesService,
    protected readonly determinations: AccountDeterminationService,
    protected readonly numbering: NumberingService,
  ) {}

  /** Totals are always derived from the lines, never taken from the payload. */
  protected priceLines<T extends ARInvoiceLineDto | APBillLineDto>(lines: T[]) {
    const priced = lines.map((l, i) => {
      const quantity = D(l.quantity ?? 1);
      const unitPrice = D(l.unitPrice);
      const lineTotal = money(quantity.times(unitPrice));
      const tax = money(lineTotal.times(D(l.taxPercent ?? 0)).dividedBy(100));
      return {
        ordering: i,
        description: l.description,
        quantity,
        unitPrice,
        lineTotal,
        taxPercent: l.taxPercent === undefined ? null : D(l.taxPercent),
        tax,
        accountId: l.accountId ?? null,
        // A/P bill lines have no product column, so the key is omitted rather
        // than sent as undefined — Prisma rejects arguments a model does not have.
        ...('productId' in l ? { productId: (l as ARInvoiceLineDto).productId ?? null } : {}),
      };
    });

    const subtotal = priced.reduce((a, l) => a.plus(l.lineTotal), ZERO);
    const tax = priced.reduce((a, l) => a.plus(l.tax), ZERO);
    return { priced, subtotal, tax, total: subtotal.plus(tax) };
  }

  protected async requirePartner(companyId: string, bpId: string, cardType: BpCardType) {
    const bp = await this.prisma.businessPartner.findFirst({
      where: { id: bpId, companyId },
      select: { id: true, cardName: true, cardType: true, isActive: true },
    });
    if (!bp) throw new NotFoundException('Business partner not found in this company');
    if (bp.cardType !== cardType) {
      throw new BadRequestException(
        `${bp.cardName} is a ${bp.cardType.toLowerCase()}, not a ${cardType.toLowerCase()}.`,
      );
    }
    if (!bp.isActive) {
      throw new BadRequestException(`${bp.cardName} is inactive.`);
    }
    return bp;
  }

  protected resolve(companyId: string, which: keyof typeof DETERMINATION) {
    const d = DETERMINATION[which];
    return this.determinations.resolve(companyId, d.area, d.key);
  }

  /**
   * Collapses the lines onto their G/L accounts so a ten-line invoice against
   * one revenue account posts one journal line, not ten. The ledger records the
   * accounting effect; the line detail already lives on the document.
   */
  protected groupByAccount(
    lines: { accountId: string | null; lineTotal: Prisma.Decimal }[],
    fallbackAccountId: string,
  ) {
    const byAccount = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      const key = l.accountId ?? fallbackAccountId;
      byAccount.set(key, (byAccount.get(key) ?? ZERO).plus(l.lineTotal));
    }
    return [...byAccount.entries()].filter(([, amount]) => !amount.isZero());
  }


  /**
   * A duplicate under the same idempotency key is a retry that got past the
   * replay cache — the record was lost, or this is a reclaimed stale key. The
   * unique index refused it inside the transaction, so nothing was written
   * twice; the caller only needs to be told why.
   */
  protected duplicateKey(e: unknown, key: string | undefined): never | void {
    if (
      key &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      String(e.meta?.target ?? '').includes('idempotencyKey')
    ) {
      throw new ConflictException(
        `A payment was already recorded under idempotency key "${key}". It was not applied again.`,
      );
    }
  }

  protected async dueDateFor(
    companyId: string,
    issueDate: Date,
    explicit: string | undefined,
    paymentTermsId: string | null | undefined,
  ) {
    if (explicit) return new Date(explicit);
    if (!paymentTermsId) return null;
    const terms = await this.prisma.paymentTerms.findFirst({
      where: { id: paymentTermsId, companyId },
      select: { netDays: true },
    });
    if (!terms?.netDays) return null;
    const due = new Date(issueDate);
    due.setDate(due.getDate() + terms.netDays);
    return due;
  }
}

// ─── ACCOUNTS RECEIVABLE ──────────────────────────────────────────────────────
@Injectable()
export class ARInvoicesService extends SubledgerService {
  constructor(
    prisma: PrismaService,
    journals: JournalEntriesService,
    determinations: AccountDeterminationService,
    numbering: NumberingService,
  ) {
    super(prisma, journals, determinations, numbering);
  }

  async findAll(companyId: string, query: ListQuery = {}) {
    const where: Prisma.ARInvoiceWhereInput = { companyId };
    if (query.status) where.status = String(query.status) as ARInvoiceStatus;
    if (query.bpId) where.bpId = String(query.bpId);
    if (query.from || query.to) {
      where.issueDate = {
        ...(query.from ? { gte: new Date(String(query.from)) } : {}),
        ...(query.to ? { lte: new Date(String(query.to)) } : {}),
      };
    }
    if (query.search) {
      const s = String(query.search);
      where.OR = [
        { number: { contains: s, mode: 'insensitive' } },
        { bp: { cardName: { contains: s, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.aRInvoice.findMany({
      where,
      include: AR_INCLUDE,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      ...(query.skip !== undefined ? { skip: Number(query.skip) } : {}),
      take: query.take !== undefined ? Number(query.take) : 100,
    });
  }

  async findOne(companyId: string, id: string) {
    const inv = await this.prisma.aRInvoice.findFirst({
      where: { id, companyId },
      include: AR_INCLUDE,
    });
    if (!inv) throw new NotFoundException(`A/R invoice ${id} not found`);
    return inv;
  }

  async create(companyId: string, dto: CreateARInvoiceDto) {
    const bp = await this.requirePartner(companyId, dto.bpId, BpCardType.CUSTOMER);
    const { priced, subtotal, tax, total } = this.priceLines(dto.lines);
    const issueDate = new Date(dto.issueDate);
    const dueDate = await this.dueDateFor(companyId, issueDate, dto.dueDate, dto.paymentTermsId);

    if (dto.orderId) await this.requireOrder(companyId, dto.orderId, bp.id);

    return this.prisma.$transaction(async (tx) => {
      const allocated = await this.numbering.allocate(tx, companyId, 'ar_invoice');
      return tx.aRInvoice.create({
        data: {
          companyId,
          bpId: bp.id,
          // The stored card type is what lets the foreign key pin the partner to
          // CUSTOMER. It is taken from the partner, never from the payload.
          bpCardType: bp.cardType,
          number: allocated.number,
          issueDate,
          dueDate,
          currency: dto.currency ?? 'USD',
          paymentTermsId: dto.paymentTermsId ?? null,
          orderId: dto.orderId ?? null,
          notes: dto.notes ?? null,
          subtotal,
          tax,
          total,
          status: ARInvoiceStatus.DRAFT,
          lines: { create: priced },
        },
        include: AR_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  async update(companyId: string, id: string, dto: UpdateARInvoiceDto) {
    const inv = await this.findOne(companyId, id);
    this.assertDraft(inv.status, inv.number);

    const bp = dto.bpId
      ? await this.requirePartner(companyId, dto.bpId, BpCardType.CUSTOMER)
      : null;
    if (dto.orderId) await this.requireOrder(companyId, dto.orderId, bp?.id ?? inv.bpId);

    const repriced = dto.lines ? this.priceLines(dto.lines) : null;
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : inv.issueDate;

    return this.prisma.$transaction(async (tx) => {
      if (repriced) await tx.aRInvoiceLine.deleteMany({ where: { invoiceId: id } });
      return tx.aRInvoice.update({
        where: { id },
        data: {
          ...(bp ? { bpId: bp.id, bpCardType: bp.cardType } : {}),
          ...(dto.issueDate ? { issueDate } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.paymentTermsId !== undefined ? { paymentTermsId: dto.paymentTermsId || null } : {}),
          ...(dto.orderId !== undefined ? { orderId: dto.orderId || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
          ...(repriced
            ? {
                subtotal: repriced.subtotal,
                tax: repriced.tax,
                total: repriced.total,
                lines: { create: repriced.priced },
              }
            : {}),
        },
        include: AR_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  /**
   * Issues the invoice and posts it:
   *   Dr  Receivables control   total     (carrying the partner, so the
   *   Cr  Revenue               subtotal   subledger reconciles to the GL)
   *   Cr  Tax payable           tax
   */
  async post(companyId: string, id: string, userId: string) {
    const inv = await this.findOne(companyId, id);
    this.assertDraft(inv.status, inv.number);
    if (inv.total.lte(ZERO)) {
      throw new BadRequestException(`A/R invoice ${inv.number} has a zero total and cannot be issued.`);
    }

    const [receivables, revenueFallback, taxAccount] = await Promise.all([
      this.resolve(companyId, 'receivables'),
      this.resolve(companyId, 'revenue'),
      inv.tax.gt(ZERO) ? this.resolve(companyId, 'salesTax') : Promise.resolve(null),
    ]);

    const lines: JournalLineDto[] = [
      { accountId: receivables, debit: num(inv.total), bpId: inv.bpId, description: `A/R ${inv.number}` },
      ...this.groupByAccount(inv.lines, revenueFallback).map(([accountId, amount]) => ({
        accountId,
        credit: num(amount),
        description: `Revenue — ${inv.number}`,
      })),
    ];
    if (taxAccount) {
      lines.push({ accountId: taxAccount, credit: num(inv.tax), description: `Output tax — ${inv.number}` });
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await this.journals.postFromSource(tx, companyId, userId, {
        date: inv.issueDate,
        source: 'ar_invoice',
        sourceId: inv.id,
        description: `A/R invoice ${inv.number}`,
        reference: inv.number,
        currency: inv.currency,
        area: 'sales',
        lines,
      });

      return tx.aRInvoice.update({
        where: { id },
        data: { status: ARInvoiceStatus.ISSUED, journalEntryId: entry.id },
        include: AR_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  /**
   * Receives money against the invoice:
   *   Dr  Cash / bank    amount
   *   Cr  Receivables    amount
   */
  async recordPayment(
    companyId: string,
    id: string,
    userId: string,
    dto: RecordPaymentDto,
    idempotencyKey?: string,
  ) {
    const inv = await this.findOne(companyId, id);
    const amount = money(D(dto.amount));
    this.assertPayable(inv.status, inv.number, 'A/R invoice');

    const open = inv.total.minus(inv.paid);
    if (amount.gt(open)) {
      throw new BadRequestException(
        `${amount.toFixed(2)} exceeds the ${open.toFixed(2)} still open on ${inv.number}. ` +
          `Record the open amount, or raise a credit memo for the difference.`,
      );
    }

    const [cash, receivables] = await Promise.all([
      dto.accountId
        ? this.requireAccount(companyId, dto.accountId)
        : this.resolve(companyId, 'cash'),
      this.resolve(companyId, 'receivables'),
    ]);
    const receivedAt = dto.date ? new Date(dto.date) : new Date();
    const paid = inv.paid.plus(amount);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const payment = await tx.aRPayment.create({
        data: {
          companyId,
          invoiceId: inv.id,
          amount,
          currency: inv.currency,
          method: dto.method ?? null,
          reference: dto.reference ?? null,
          receivedAt,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      const entry = await this.journals.postFromSource(tx, companyId, userId, {
        date: receivedAt,
        source: 'ar_payment',
        sourceId: payment.id,
        description: `Payment received on ${inv.number}`,
        reference: dto.reference ?? inv.number,
        currency: inv.currency,
        area: 'general',
        lines: [
          { accountId: cash, debit: num(amount), description: `Receipt — ${inv.number}` },
          {
            accountId: receivables,
            credit: num(amount),
            bpId: inv.bpId,
            description: `A/R settled — ${inv.number}`,
          },
        ],
      });

      await tx.aRPayment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });

      return tx.aRInvoice.update({
        where: { id },
        data: {
          paid,
          status: paid.gte(inv.total) ? ARInvoiceStatus.PAID : ARInvoiceStatus.PARTIALLY_PAID,
        },
        include: AR_INCLUDE,
      });
      }, TX_OPTIONS);
    } catch (e) {
      this.duplicateKey(e, idempotencyKey);
      throw e;
    }
  }

  /**
   * Voids an issued invoice by reversing its journal in the same transaction
   * that marks the document void. Both happen or neither does — a voided
   * invoice whose posting is still in the ledger would misstate revenue.
   */
  async void(companyId: string, id: string, userId: string, dto: VoidDocumentDto = {}) {
    const inv = await this.findOne(companyId, id);
    if (inv.status === ARInvoiceStatus.VOID) {
      throw new ConflictException(`A/R invoice ${inv.number} is already void.`);
    }
    if (inv.status === ARInvoiceStatus.DRAFT) {
      throw new ConflictException(
        `A/R invoice ${inv.number} is still a draft — delete it instead of voiding it.`,
      );
    }
    if (inv.payments.length > 0) {
      throw new ConflictException(
        `A/R invoice ${inv.number} has ${inv.payments.length} payment(s) against it. ` +
          `Reverse the payments first, or issue a credit memo.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (inv.journalEntryId) {
        await this.journals.reverseFromSource(tx, companyId, userId, inv.journalEntryId, {
          reason: dto.reason ?? `Void of A/R invoice ${inv.number}`,
        });
      }
      return tx.aRInvoice.update({
        where: { id },
        data: { status: ARInvoiceStatus.VOID, voidedAt: new Date(), voidedById: userId },
        include: AR_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  async remove(companyId: string, id: string) {
    const inv = await this.findOne(companyId, id);
    this.assertDraft(inv.status, inv.number, 'deleted');
    await this.prisma.aRInvoice.delete({ where: { id } });
    return { id, message: `Draft A/R invoice ${inv.number} deleted` };
  }

  /** Open receivables by age — the standard collections view. */
  async ageing(companyId: string, asOf?: string) {
    const on = asOf ? new Date(asOf) : new Date();
    const open = await this.prisma.aRInvoice.findMany({
      where: {
        companyId,
        status: { in: [ARInvoiceStatus.ISSUED, ARInvoiceStatus.PARTIALLY_PAID, ARInvoiceStatus.OVERDUE] },
      },
      include: { bp: { select: { id: true, cardCode: true, cardName: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
    const byPartner = new Map<string, Record<string, unknown>>();

    for (const inv of open) {
      const outstanding = inv.total.minus(inv.paid);
      if (outstanding.lte(ZERO)) continue;
      const daysLate = inv.dueDate
        ? Math.floor((on.getTime() - inv.dueDate.getTime()) / 86_400_000)
        : 0;
      const bucket =
        daysLate <= 0 ? 'current'
        : daysLate <= 30 ? 'd1_30'
        : daysLate <= 60 ? 'd31_60'
        : daysLate <= 90 ? 'd61_90'
        : 'd90_plus';

      const row =
        byPartner.get(inv.bpId) ??
        ({ bp: inv.bp, total: ZERO, ...Object.fromEntries(buckets.map((b) => [b, ZERO])) } as Record<
          string,
          unknown
        >);
      row[bucket] = (row[bucket] as Prisma.Decimal).plus(outstanding);
      row.total = (row.total as Prisma.Decimal).plus(outstanding);
      byPartner.set(inv.bpId, row);
    }

    return { asOf: on, buckets, rows: [...byPartner.values()] };
  }

  private assertDraft(status: ARInvoiceStatus, number: string, verb = 'changed') {
    if (status !== ARInvoiceStatus.DRAFT) {
      throw new ConflictException(
        `A/R invoice ${number} is ${status.toLowerCase()} and can no longer be ${verb}. ` +
          `Issued invoices are corrected by credit memo or void.`,
      );
    }
  }

  private assertPayable(status: ARInvoiceStatus, number: string, label: string) {
    const payable: ARInvoiceStatus[] = [
      ARInvoiceStatus.ISSUED,
      ARInvoiceStatus.PARTIALLY_PAID,
      ARInvoiceStatus.OVERDUE,
    ];
    if (!payable.includes(status)) {
      throw new ConflictException(
        `${label} ${number} is ${status.toLowerCase()}; only an issued document can take a payment.`,
      );
    }
  }

  /**
   * An order can only be invoiced if it has a customer, and it has to be the
   * same customer the invoice is for.
   *
   * `bpId` on an order is optional so a quotation can be started before the
   * customer is settled. That flexibility has to stop here: an invoice raised
   * from a customerless order would leave the chain
   * customer -> order -> invoice -> payment broken at its first joint, with
   * the receivable pointing at an order that names nobody. Requiring it at
   * invoice time keeps early drafts workable while making the finished chain
   * unbreakable.
   */
  private async requireOrder(companyId: string, orderId: string, bpId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, bpId: true },
    });
    if (!order) throw new NotFoundException('Sales order not found in this company');

    if (!order.bpId) {
      throw new BadRequestException(
        `Sales order ${orderId} has no customer, so it cannot be invoiced. ` +
          `Set the customer on the order first.`,
      );
    }
    if (order.bpId !== bpId) {
      throw new BadRequestException(
        `Sales order ${orderId} belongs to a different customer than this invoice. ` +
          `An invoice cannot be raised against another partner's order.`,
      );
    }
    return order;
  }

  private async requireAccount(companyId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId },
      select: { id: true, isTitle: true, code: true },
    });
    if (!account) throw new NotFoundException('Account not found in this company');
    if (account.isTitle) {
      throw new BadRequestException(`Account ${account.code} is a Title account and cannot be posted to.`);
    }
    return account.id;
  }
}

// ─── ACCOUNTS PAYABLE ─────────────────────────────────────────────────────────
@Injectable()
export class APBillsService extends SubledgerService {
  constructor(
    prisma: PrismaService,
    journals: JournalEntriesService,
    determinations: AccountDeterminationService,
    numbering: NumberingService,
  ) {
    super(prisma, journals, determinations, numbering);
  }

  async findAll(companyId: string, query: ListQuery = {}) {
    const where: Prisma.APBillWhereInput = { companyId };
    if (query.status) where.status = String(query.status) as APBillStatus;
    if (query.bpId) where.bpId = String(query.bpId);
    if (query.from || query.to) {
      where.issueDate = {
        ...(query.from ? { gte: new Date(String(query.from)) } : {}),
        ...(query.to ? { lte: new Date(String(query.to)) } : {}),
      };
    }
    if (query.search) {
      const s = String(query.search);
      where.OR = [
        { number: { contains: s, mode: 'insensitive' } },
        { bp: { cardName: { contains: s, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.aPBill.findMany({
      where,
      include: AP_INCLUDE,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      ...(query.skip !== undefined ? { skip: Number(query.skip) } : {}),
      take: query.take !== undefined ? Number(query.take) : 100,
    });
  }

  async findOne(companyId: string, id: string) {
    const bill = await this.prisma.aPBill.findFirst({ where: { id, companyId }, include: AP_INCLUDE });
    if (!bill) throw new NotFoundException(`A/P bill ${id} not found`);
    return bill;
  }

  async create(companyId: string, dto: CreateAPBillDto) {
    const bp = await this.requirePartner(companyId, dto.bpId, BpCardType.VENDOR);
    const { priced, subtotal, tax, total } = this.priceLines(dto.lines);
    const issueDate = new Date(dto.issueDate);
    const dueDate = await this.dueDateFor(companyId, issueDate, dto.dueDate, dto.paymentTermsId);

    // The number comes from the vendor, so the same vendor cannot send it twice.
    const clash = await this.prisma.aPBill.findFirst({
      where: { companyId, bpId: bp.id, number: dto.number },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`${bp.cardName} already has a bill numbered ${dto.number}.`);
    }

    return this.prisma.aPBill.create({
      data: {
        companyId,
        bpId: bp.id,
        bpCardType: bp.cardType,
        number: dto.number,
        issueDate,
        dueDate,
        currency: dto.currency ?? 'USD',
        paymentTermsId: dto.paymentTermsId ?? null,
        notes: dto.notes ?? null,
        subtotal,
        tax,
        total,
        status: APBillStatus.DRAFT,
        lines: { create: priced },
      },
      include: AP_INCLUDE,
    });
  }

  async update(companyId: string, id: string, dto: UpdateAPBillDto) {
    const bill = await this.findOne(companyId, id);
    this.assertDraft(bill.status, bill.number);

    const bp = dto.bpId ? await this.requirePartner(companyId, dto.bpId, BpCardType.VENDOR) : null;
    const repriced = dto.lines ? this.priceLines(dto.lines) : null;

    return this.prisma.$transaction(async (tx) => {
      if (repriced) await tx.aPBillLine.deleteMany({ where: { billId: id } });
      return tx.aPBill.update({
        where: { id },
        data: {
          ...(bp ? { bpId: bp.id, bpCardType: bp.cardType } : {}),
          ...(dto.number ? { number: dto.number } : {}),
          ...(dto.issueDate ? { issueDate: new Date(dto.issueDate) } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.paymentTermsId !== undefined ? { paymentTermsId: dto.paymentTermsId || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
          ...(repriced
            ? {
                subtotal: repriced.subtotal,
                tax: repriced.tax,
                total: repriced.total,
                lines: { create: repriced.priced },
              }
            : {}),
        },
        include: AP_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  /**
   * Approves the bill and posts it — the mirror of an A/R invoice:
   *   Dr  Expense          subtotal
   *   Dr  Tax receivable   tax
   *   Cr  Payables control total     (carrying the partner)
   */
  async post(companyId: string, id: string, userId: string) {
    const bill = await this.findOne(companyId, id);
    this.assertDraft(bill.status, bill.number);
    if (bill.total.lte(ZERO)) {
      throw new BadRequestException(`A/P bill ${bill.number} has a zero total and cannot be approved.`);
    }

    const [payables, expenseFallback, taxAccount] = await Promise.all([
      this.resolve(companyId, 'payables'),
      this.resolve(companyId, 'expense'),
      bill.tax.gt(ZERO) ? this.resolve(companyId, 'purchaseTax') : Promise.resolve(null),
    ]);

    const lines: JournalLineDto[] = this.groupByAccount(bill.lines, expenseFallback).map(
      ([accountId, amount]) => ({
        accountId,
        debit: num(amount),
        description: `Expense — ${bill.number}`,
      }),
    );
    if (taxAccount) {
      lines.push({ accountId: taxAccount, debit: num(bill.tax), description: `Input tax — ${bill.number}` });
    }
    lines.push({
      accountId: payables,
      credit: num(bill.total),
      bpId: bill.bpId,
      description: `A/P ${bill.number}`,
    });

    return this.prisma.$transaction(async (tx) => {
      const entry = await this.journals.postFromSource(tx, companyId, userId, {
        date: bill.issueDate,
        source: 'ap_bill',
        sourceId: bill.id,
        description: `A/P bill ${bill.number}`,
        reference: bill.number,
        currency: bill.currency,
        area: 'purchasing',
        lines,
      });

      return tx.aPBill.update({
        where: { id },
        data: { status: APBillStatus.APPROVED, journalEntryId: entry.id },
        include: AP_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  /**
   * Pays the vendor:
   *   Dr  Payables     amount
   *   Cr  Cash / bank  amount
   */
  async recordPayment(
    companyId: string,
    id: string,
    userId: string,
    dto: RecordPaymentDto,
    idempotencyKey?: string,
  ) {
    const bill = await this.findOne(companyId, id);
    const amount = money(D(dto.amount));
    this.assertPayable(bill.status, bill.number);

    const open = bill.total.minus(bill.paid);
    if (amount.gt(open)) {
      throw new BadRequestException(
        `${amount.toFixed(2)} exceeds the ${open.toFixed(2)} still open on ${bill.number}.`,
      );
    }

    const [cash, payables] = await Promise.all([
      dto.accountId ? this.requireAccount(companyId, dto.accountId) : this.resolve(companyId, 'cash'),
      this.resolve(companyId, 'payables'),
    ]);
    const paidAt = dto.date ? new Date(dto.date) : new Date();
    const paid = bill.paid.plus(amount);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const payment = await tx.aPPayment.create({
        data: {
          companyId,
          billId: bill.id,
          amount,
          currency: bill.currency,
          method: dto.method ?? null,
          reference: dto.reference ?? null,
          paidAt,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      const entry = await this.journals.postFromSource(tx, companyId, userId, {
        date: paidAt,
        source: 'ap_payment',
        sourceId: payment.id,
        description: `Payment made on ${bill.number}`,
        reference: dto.reference ?? bill.number,
        currency: bill.currency,
        area: 'general',
        lines: [
          {
            accountId: payables,
            debit: num(amount),
            bpId: bill.bpId,
            description: `A/P settled — ${bill.number}`,
          },
          { accountId: cash, credit: num(amount), description: `Disbursement — ${bill.number}` },
        ],
      });

      await tx.aPPayment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });

      return tx.aPBill.update({
        where: { id },
        data: {
          paid,
          status: paid.gte(bill.total) ? APBillStatus.PAID : APBillStatus.PARTIALLY_PAID,
        },
        include: AP_INCLUDE,
      });
      }, TX_OPTIONS);
    } catch (e) {
      this.duplicateKey(e, idempotencyKey);
      throw e;
    }
  }

  async void(companyId: string, id: string, userId: string, dto: VoidDocumentDto = {}) {
    const bill = await this.findOne(companyId, id);
    if (bill.status === APBillStatus.VOID) {
      throw new ConflictException(`A/P bill ${bill.number} is already void.`);
    }
    if (bill.status === APBillStatus.DRAFT) {
      throw new ConflictException(
        `A/P bill ${bill.number} is still a draft — delete it instead of voiding it.`,
      );
    }
    if (bill.payments.length > 0) {
      throw new ConflictException(
        `A/P bill ${bill.number} has ${bill.payments.length} payment(s) against it. ` +
          `Reverse the payments first.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (bill.journalEntryId) {
        await this.journals.reverseFromSource(tx, companyId, userId, bill.journalEntryId, {
          reason: dto.reason ?? `Void of A/P bill ${bill.number}`,
        });
      }
      return tx.aPBill.update({
        where: { id },
        data: { status: APBillStatus.VOID, voidedAt: new Date(), voidedById: userId },
        include: AP_INCLUDE,
      });
    }, TX_OPTIONS);
  }

  async remove(companyId: string, id: string) {
    const bill = await this.findOne(companyId, id);
    this.assertDraft(bill.status, bill.number, 'deleted');
    await this.prisma.aPBill.delete({ where: { id } });
    return { id, message: `Draft A/P bill ${bill.number} deleted` };
  }

  /** What is owed, by how late it is — the payment-run planning view. */
  async ageing(companyId: string, asOf?: string) {
    const on = asOf ? new Date(asOf) : new Date();
    const open = await this.prisma.aPBill.findMany({
      where: {
        companyId,
        status: { in: [APBillStatus.APPROVED, APBillStatus.PARTIALLY_PAID, APBillStatus.OVERDUE] },
      },
      include: { bp: { select: { id: true, cardCode: true, cardName: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
    const byPartner = new Map<string, Record<string, unknown>>();

    for (const bill of open) {
      const outstanding = bill.total.minus(bill.paid);
      if (outstanding.lte(ZERO)) continue;
      const daysLate = bill.dueDate
        ? Math.floor((on.getTime() - bill.dueDate.getTime()) / 86_400_000)
        : 0;
      const bucket =
        daysLate <= 0 ? 'current'
        : daysLate <= 30 ? 'd1_30'
        : daysLate <= 60 ? 'd31_60'
        : daysLate <= 90 ? 'd61_90'
        : 'd90_plus';

      const row =
        byPartner.get(bill.bpId) ??
        ({ bp: bill.bp, total: ZERO, ...Object.fromEntries(buckets.map((b) => [b, ZERO])) } as Record<
          string,
          unknown
        >);
      row[bucket] = (row[bucket] as Prisma.Decimal).plus(outstanding);
      row.total = (row.total as Prisma.Decimal).plus(outstanding);
      byPartner.set(bill.bpId, row);
    }

    return { asOf: on, buckets, rows: [...byPartner.values()] };
  }

  private assertDraft(status: APBillStatus, number: string, verb = 'changed') {
    if (status !== APBillStatus.DRAFT) {
      throw new ConflictException(
        `A/P bill ${number} is ${status.toLowerCase()} and can no longer be ${verb}.`,
      );
    }
  }

  private assertPayable(status: APBillStatus, number: string) {
    const payable: APBillStatus[] = [
      APBillStatus.APPROVED,
      APBillStatus.PARTIALLY_PAID,
      APBillStatus.OVERDUE,
    ];
    if (!payable.includes(status)) {
      throw new ConflictException(
        `A/P bill ${number} is ${status.toLowerCase()}; only an approved bill can be paid.`,
      );
    }
  }

  private async requireAccount(companyId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId },
      select: { id: true, isTitle: true, code: true },
    });
    if (!account) throw new NotFoundException('Account not found in this company');
    if (account.isTitle) {
      throw new BadRequestException(`Account ${account.code} is a Title account and cannot be posted to.`);
    }
    return account.id;
  }
}
