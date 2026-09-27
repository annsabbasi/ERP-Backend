import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PutPaymentDetailsDto } from './payment-details.dto';
import { ibanProblem, maskTail, normalizeAccountNo, normalizeIban } from './bank-account';

interface AuditMeta { actorId: string | null; ip?: string }

const DETAIL_SELECT = {
  employeeId: true,
  accountTitle: true,
  accountNo: true,
  iban: true,
  bankDetailsChangedAt: true,
  updatedAt: true,
  updatedById: true,
  paymentMethod: { select: { id: true, code: true, description: true, paymentMeans: true } },
  bank: { select: { id: true, code: true, name: true } },
} as const;

/**
 * Where an employee's pay goes (QA R-d). The table's trigger checks the
 * tenant, stamps bankDetailsChangedAt and writes the masked history; this
 * service validates what a person types and tells the trigger who they are.
 */
@Injectable()
export class PaymentDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** In full — the route requires hr.employee_bank.view. */
  async get(companyId: string, employeeId: string) {
    await this.requireEmployee(companyId, employeeId);
    const row = await this.prisma.employeePaymentDetail.findUnique({
      where: { employeeId },
      select: DETAIL_SELECT,
    });
    return row ?? this.emptyDetails(employeeId);
  }

  /** Masked history, newest first. */
  async history(companyId: string, employeeId: string) {
    await this.requireEmployee(companyId, employeeId);
    return this.prisma.employeePaymentDetailChange.findMany({
      where: { companyId, employeeId },
      orderBy: { changedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Replaces the details. Answers masked: the route needs only
   * hr.employee_bank.update, and changing a destination must not also reveal
   * the one it replaced.
   */
  async put(companyId: string, employeeId: string, dto: PutPaymentDetailsDto, meta: AuditMeta) {
    await this.requireEmployee(companyId, employeeId);

    const iban = dto.iban?.trim() ? normalizeIban(dto.iban) : null;
    const accountNo = dto.accountNo?.trim() ? normalizeAccountNo(dto.accountNo) : null;
    const accountTitle = dto.accountTitle?.trim() || null;
    const bankId = dto.bankId || null;
    const paymentMethodId = dto.paymentMethodId || null;

    if (iban) {
      const problem = ibanProblem(iban);
      if (problem) throw new BadRequestException(problem);
    }
    if (accountNo && !/^[0-9A-Za-z-]{4,34}$/.test(accountNo)) {
      throw new BadRequestException('An account number is 4–34 letters, digits or dashes.');
    }

    const [method, bank] = await Promise.all([
      paymentMethodId
        ? this.prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, companyId } })
        : null,
      bankId ? this.prisma.bank.findFirst({ where: { id: bankId, companyId } }) : null,
    ]);
    if (paymentMethodId && !method) throw new BadRequestException('That payment method does not exist in this company.');
    if (bankId && !bank) throw new BadRequestException('That bank does not exist in this company.');
    if (method && method.direction !== 'OUTGOING') {
      throw new BadRequestException(`${method.code} is an incoming method; an employee is paid with an outgoing one.`);
    }
    if (method && !method.isActive) throw new BadRequestException(`Payment method ${method.code} is inactive.`);

    // What each method needs to be usable on payday.
    const means = method?.paymentMeans ?? 'cash';
    if (means === 'loan' || means === 'advance') {
      throw new BadRequestException(
        `${method!.code} settles a salary against a loan or advance at payment time; it cannot be an employee's default method.`,
      );
    }
    if (means === 'ibft' && !iban) {
      throw new BadRequestException(`${method!.code} (inter-bank transfer) needs the employee's IBAN.`);
    }
    if (means === 'online' && (!bank || (!accountNo && !iban))) {
      throw new BadRequestException(`${method!.code} (online transfer) needs the employee's bank and an account number or IBAN.`);
    }
    if ((accountNo || iban) && !bank) {
      throw new BadRequestException('Choose the bank the account number or IBAN belongs to.');
    }

    const data = { paymentMethodId, bankId, accountTitle, accountNo, iban };
    const before = await this.prisma.employeePaymentDetail.findUnique({ where: { employeeId }, select: DETAIL_SELECT });

    await this.prisma.$transaction(async (tx) => {
      // Read by the table's trigger for the history's changedById. Local to
      // this transaction, so it cannot leak onto the next request's connection.
      await tx.$queryRaw`SELECT set_config('erp.actor_id', ${meta.actorId ?? ''}, true)`;
      await tx.employeePaymentDetail.upsert({
        where: { employeeId },
        create: { companyId, employeeId, ...data },
        update: data,
      });
    });

    const after = await this.prisma.employeePaymentDetail.findUniqueOrThrow({ where: { employeeId }, select: DETAIL_SELECT });
    // The history table is the record that cannot be skipped; this is the
    // company-wide audit trail, masked the same way.
    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.employee.payment_details.changed',
      refType: 'employee',
      refId: employeeId,
      before: before ? this.masked(before) : null,
      after: this.masked(after),
      ip: meta.ip,
    });
    return this.masked(after);
  }

  private masked<T extends { accountNo: string | null; iban: string | null }>(row: T): T {
    return { ...row, accountNo: maskTail(row.accountNo), iban: maskTail(row.iban) };
  }

  private emptyDetails(employeeId: string) {
    return {
      employeeId,
      accountTitle: null,
      accountNo: null,
      iban: null,
      bankDetailsChangedAt: null,
      updatedAt: null,
      updatedById: null,
      paymentMethod: null,
      bank: null,
    };
  }

  private async requireEmployee(companyId: string, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId, deletedAt: null }, select: { id: true } });
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`);
  }
}
