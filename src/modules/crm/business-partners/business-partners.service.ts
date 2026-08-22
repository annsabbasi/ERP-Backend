import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { BpCardType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../../administration/numbering/numbering.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';
import {
  BpAddressDto,
  BpBankAccountDto,
  BpContactPersonDto,
  CreateBusinessPartnerDto,
  UpdateBusinessPartnerDto,
} from '../crm.dto';

/** Card-code prefixes so C/V/L records are distinguishable at a glance. */
const CODE_PREFIX: Record<BpCardType, string> = {
  CUSTOMER: 'C',
  VENDOR: 'V',
  LEAD: 'L',
};

@Injectable()
export class BusinessPartnersService extends TenantCrudService {
  protected readonly modelName = 'businessPartner';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Business partner',
    orderBy: { cardName: 'asc' },
    searchFields: ['cardCode', 'cardName', 'foreignName', 'email', 'phone1', 'federalTaxId'],
    filterableFields: ['cardType', 'groupId', 'isActive', 'territoryId', 'salesEmployeeId'],
    uniqueBy: ['cardCode'],
    include: {
      group: { select: { id: true, code: true, name: true, type: true } },
      territory: { select: { id: true, name: true } },
      salesEmployee: { select: { id: true, code: true, name: true } },
      paymentTerms: { select: { id: true, code: true, name: true, netDays: true } },
      paymentMethod: { select: { id: true, code: true, description: true } },
      dunningTerm: { select: { id: true, code: true, name: true } },
      contacts: { orderBy: [{ isDefault: 'desc' as const }, { name: 'asc' as const }] },
      addresses: { orderBy: [{ isDefault: 'desc' as const }, { addressName: 'asc' as const }] },
      bankAccounts: { orderBy: { isDefault: 'desc' as const } },
    },
  };

  constructor(
    prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {
    super(prisma);
  }

  async create(companyId: string, dto: CreateBusinessPartnerDto) {
    const cid = this.requireCompany(companyId);
    this.assertSingleDefaults(dto);

    return this.prisma.$transaction(async (tx) => {
      const cardCode = dto.cardCode?.trim() || (await this.nextCardCode(tx, cid, dto.cardType));

      const clash = await tx.businessPartner.findFirst({
        where: { companyId: cid, cardCode },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(`Card code "${cardCode}" is already in use.`);
      }

      return tx.businessPartner.create({
        data: {
          ...this.scalarFields(dto),
          companyId: cid,
          cardCode,
          cardName: dto.cardName,
          cardType: dto.cardType,
          contacts: { create: (dto.contacts ?? []).map(stripId) },
          addresses: { create: (dto.addresses ?? []).map(stripId) },
          bankAccounts: { create: (dto.bankAccounts ?? []).map(stripId) },
        },
        ...this.readArgs(),
      });
    });
  }

  async update(companyId: string, id: string, dto: UpdateBusinessPartnerDto) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    this.assertSingleDefaults(dto);

    return this.prisma.$transaction(async (tx) => {
      // The window submits each child grid in full, so replacing is the honest
      // interpretation of the payload: a row the user removed should disappear.
      if (dto.contacts) {
        await tx.bpContactPerson.deleteMany({ where: { bpId: id } });
      }
      if (dto.addresses) {
        await tx.bpAddress.deleteMany({ where: { bpId: id } });
      }
      if (dto.bankAccounts) {
        await tx.bpBankAccount.deleteMany({ where: { bpId: id } });
      }

      return tx.businessPartner.update({
        where: { id },
        data: {
          ...this.scalarFields(dto),
          ...(dto.cardName !== undefined ? { cardName: dto.cardName } : {}),
          ...(dto.cardType !== undefined ? { cardType: dto.cardType } : {}),
          ...(dto.cardCode !== undefined && dto.cardCode ? { cardCode: dto.cardCode } : {}),
          ...(dto.contacts ? { contacts: { create: dto.contacts.map(stripId) } } : {}),
          ...(dto.addresses ? { addresses: { create: dto.addresses.map(stripId) } } : {}),
          ...(dto.bankAccounts ? { bankAccounts: { create: dto.bankAccounts.map(stripId) } } : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  async remove(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const bp = await this.prisma.businessPartner.findFirst({
      where: { id, companyId: cid },
      include: {
        _count: {
          select: {
            arInvoices: true, apBills: true, activities: true,
            opportunities: true, journalLines: true,
          },
        },
      },
    });
    if (!bp) return super.remove(cid, id);

    const c = bp._count;
    const linked = c.arInvoices + c.apBills + c.journalLines;
    if (linked > 0) {
      throw new ConflictException(
        `${bp.cardName} has ${linked} financial document(s) or ledger line(s) and cannot be ` +
          `deleted — that would break the audit trail. Deactivate the partner instead.`,
      );
    }
    if (c.activities + c.opportunities > 0) {
      throw new ConflictException(
        `${bp.cardName} has ${c.activities} activit${c.activities === 1 ? 'y' : 'ies'} and ` +
          `${c.opportunities} opportunit${c.opportunities === 1 ? 'y' : 'ies'}. Remove or reassign them first.`,
      );
    }
    return super.remove(cid, id);
  }

  /** Lightweight lookup for pickers — the "Choose from list" dialog. */
  async lookup(companyId: string, query: { search?: string; cardType?: BpCardType; take?: number }) {
    const cid = this.requireCompany(companyId);
    return this.prisma.businessPartner.findMany({
      where: {
        companyId: cid,
        isActive: true,
        ...(query.cardType ? { cardType: query.cardType } : {}),
        ...(query.search
          ? {
              OR: [
                { cardCode: { contains: query.search, mode: 'insensitive' } },
                { cardName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true, cardCode: true, cardName: true, cardType: true,
        currency: true, accountBalance: true, phone1: true, email: true,
      },
      orderBy: { cardName: 'asc' },
      take: query.take ?? 50,
    });
  }

  /**
   * Recomputes the running balances shown on the General tab from the ledger.
   * Cheaper to recompute on demand than to keep six counters correct through
   * every posting path.
   */
  async refreshBalances(companyId: string, id: string) {
    const [ar, ap] = await Promise.all([
      this.prisma.aRInvoice.aggregate({
        where: { companyId, bpId: id, status: { notIn: ['VOID', 'DRAFT'] } },
        _sum: { total: true, paid: true },
      }),
      this.prisma.aPBill.aggregate({
        where: { companyId, bpId: id, status: { notIn: ['VOID', 'DRAFT'] } },
        _sum: { total: true, paid: true },
      }),
    ]);

    const openAr = new Prisma.Decimal(ar._sum.total ?? 0).minus(ar._sum.paid ?? 0);
    const openAp = new Prisma.Decimal(ap._sum.total ?? 0).minus(ap._sum.paid ?? 0);

    const opps = await this.prisma.opportunity.aggregate({
      where: { companyId, bpId: id, status: 'OPEN' },
      _sum: { potentialAmount: true },
    });

    return this.prisma.businessPartner.update({
      where: { id },
      data: {
        // A vendor's balance is what we owe; a customer's is what they owe us.
        accountBalance: openAr.greaterThan(0) ? openAr : openAp,
        opportunitiesAmount: opps._sum.potentialAmount ?? new Prisma.Decimal(0),
      },
      ...this.readArgs(),
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private async nextCardCode(
    tx: Prisma.TransactionClient,
    companyId: string,
    cardType: BpCardType,
  ): Promise<string> {
    try {
      const allocated = await this.numbering.allocate(tx, companyId, 'business_partner');
      return allocated.number;
    } catch {
      // No series configured yet — fall back to a prefix + sequence derived from
      // existing codes, so creating a partner is never blocked on setup.
      const prefix = CODE_PREFIX[cardType];
      const last = await tx.businessPartner.findFirst({
        where: { companyId, cardCode: { startsWith: prefix } },
        orderBy: { cardCode: 'desc' },
        select: { cardCode: true },
      });
      const n = last ? Number(last.cardCode.slice(prefix.length)) : 0;
      const next = Number.isFinite(n) ? n + 1 : 1;
      return `${prefix}${String(next).padStart(5, '0')}`;
    }
  }

  /** Only one contact / address / bank account may be flagged default. */
  private assertSingleDefaults(dto: Partial<CreateBusinessPartnerDto>) {
    const check = (rows: { isDefault?: boolean }[] | undefined, label: string) => {
      if (!rows) return;
      const defaults = rows.filter((r) => r.isDefault).length;
      if (defaults > 1) {
        throw new BadRequestException(`Only one ${label} can be marked as default (found ${defaults}).`);
      }
    };
    check(dto.contacts, 'contact person');
    check(dto.bankAccounts, 'bank account');

    // Addresses are default-per-type: one Bill To and one Ship To.
    if (dto.addresses) {
      for (const type of ['BILL_TO', 'SHIP_TO']) {
        const defaults = dto.addresses.filter((a) => a.isDefault && a.addressType === type).length;
        if (defaults > 1) {
          throw new BadRequestException(
            `Only one default ${type === 'BILL_TO' ? 'Bill To' : 'Ship To'} address is allowed (found ${defaults}).`,
          );
        }
      }
    }
  }

  /** Everything except the child collections and the identity fields. */
  private scalarFields(dto: Partial<CreateBusinessPartnerDto>) {
    const {
      contacts, addresses, bankAccounts, cardCode, cardName, cardType,
      validFrom, validTo, ...rest
    } = dto;
    void contacts; void addresses; void bankAccounts; void cardCode; void cardName; void cardType;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      out[k] = v === '' ? null : v;
    }
    if (validFrom !== undefined) out.validFrom = validFrom ? new Date(validFrom) : null;
    if (validTo !== undefined) out.validTo = validTo ? new Date(validTo) : null;
    return out;
  }
}

function stripId<T extends { id?: string }>(row: T): Omit<T, 'id'> {
  const { id, ...rest } = row;
  void id;
  return rest;
}
