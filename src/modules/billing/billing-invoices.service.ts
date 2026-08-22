import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingInvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateBillingInvoiceDto,
  RecordPaymentDto,
} from './dto/billing.dto';

interface AuditContext {
  actorId: string | null;
  ip?: string;
}

/**
 * Lightweight, manual billing invoices. Stripe / payment-processor integration
 * is deferred per spec; this module exists so subscription cycles can produce
 * recordable line items and payment-received events for audit and reporting.
 */
@Injectable()
export class BillingInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string) {
    return this.prisma.billingInvoice.findMany({
      where: { companyId },
      include: { payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const inv = await this.prisma.billingInvoice.findFirst({
      where: { id, companyId },
      include: { payments: true, subscription: { include: { plan: true } } },
    });
    if (!inv) throw new NotFoundException(`Invoice ${id} not found`);
    return inv;
  }

  async create(companyId: string, dto: CreateBillingInvoiceDto, audit: AuditContext) {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) throw new BadRequestException('Company has no subscription');

    const number = await this.nextInvoiceNumber(companyId);
    const inv = await this.prisma.billingInvoice.create({
      data: {
        companyId,
        subscriptionId: sub.id,
        number,
        status: BillingInvoiceStatus.ISSUED,
        amount: dto.amount,
        currency: dto.currency ?? 'USD',
        periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        issuedAt: new Date(),
        notes: dto.notes,
      },
    });
    await this.recordActivity(companyId, audit, 'billing.invoice.issued', {
      invoiceId: inv.id,
      number: inv.number,
      amount: inv.amount,
    });
    return inv;
  }

  async recordPayment(
    companyId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    audit: AuditContext,
  ) {
    const inv = await this.findOne(companyId, invoiceId);
    if (inv.status === BillingInvoiceStatus.VOID) {
      throw new BadRequestException('Cannot record payment on a void invoice');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.billingPayment.create({
        data: {
          invoiceId: inv.id,
          amount: dto.amount,
          currency: dto.currency ?? inv.currency,
          method: dto.method ?? 'manual',
          reference: dto.reference,
        },
      });
      const totalPaid = await tx.billingPayment.aggregate({
        where: { invoiceId: inv.id },
        _sum: { amount: true },
      });
      // Decimal comparison: `>=` on Prisma.Decimal objects compares references.
      const paidNow = new Prisma.Decimal(totalPaid._sum.amount ?? 0).greaterThanOrEqualTo(inv.amount);
      if (paidNow && inv.status !== BillingInvoiceStatus.PAID) {
        await tx.billingInvoice.update({
          where: { id: inv.id },
          data: { status: BillingInvoiceStatus.PAID, paidAt: new Date() },
        });
      }
      return { payment, paidInFull: paidNow };
    });

    await this.recordActivity(companyId, audit, 'billing.payment.recorded', {
      invoiceId: inv.id,
      paymentId: result.payment.id,
      amount: result.payment.amount,
      paidInFull: result.paidInFull,
    });
    return this.findOne(companyId, inv.id);
  }

  async voidInvoice(companyId: string, id: string, audit: AuditContext) {
    const inv = await this.findOne(companyId, id);
    if (inv.status === BillingInvoiceStatus.PAID) {
      throw new BadRequestException('Cannot void a paid invoice — refund instead');
    }
    await this.prisma.billingInvoice.update({
      where: { id },
      data: { status: BillingInvoiceStatus.VOID },
    });
    await this.recordActivity(companyId, audit, 'billing.invoice.voided', {
      invoiceId: id,
      number: inv.number,
    });
    return this.findOne(companyId, id);
  }

  // Sequential per-company invoice number — "INV-<companyId-prefix>-NNNN".
  private async nextInvoiceNumber(companyId: string): Promise<string> {
    const count = await this.prisma.billingInvoice.count({ where: { companyId } });
    const prefix = companyId.slice(0, 8);
    return `INV-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }

  private async recordActivity(
    companyId: string,
    audit: AuditContext,
    action: string,
    details: Prisma.InputJsonValue,
  ) {
    const refId = (details as any)?.invoiceId as string | undefined;
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action,
      refType: 'billing_invoice',
      refId,
      after: details,
      ip: audit.ip,
      module: 'billing',
      details,
    });
  }
}
