import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BpCardType, Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SETTINGS_DEFAULTS } from '../../administration/settings/settings.service';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import {
  DocumentPrintingSearchDto,
  EmailDocumentsDto,
  OutputKind,
  PrintableDocumentType,
  PropertyMode,
} from './document-printing.dto';

interface TypeDef {
  label: string;
  /** Viewing the document is what printing it needs. */
  permission: string;
  /** Which partners the document carries; journal entries can carry either. */
  side: BpCardType | 'ANY';
}

export const DOCUMENT_TYPE_DEFS: Record<PrintableDocumentType, TypeDef> = {
  journal_entry: {
    label: 'Journal Entry',
    permission: 'financials.journal.view',
    side: 'ANY',
  },
  ar_invoice: {
    label: 'A/R Invoice',
    permission: 'financials.ar.view',
    side: 'CUSTOMER',
  },
  incoming_payment: {
    label: 'Incoming Payment',
    permission: 'financials.ar.view',
    side: 'CUSTOMER',
  },
  ap_invoice: {
    label: 'A/P Invoice',
    permission: 'financials.ap.view',
    side: 'VENDOR',
  },
  outgoing_payment: {
    label: 'Outgoing Payment',
    permission: 'financials.ap.view',
    side: 'VENDOR',
  },
};

/** More than this and the window is asked to narrow the selection. */
const MAX_RESULTS = 1000;
/**
 * Rows read before the internal-number and printed/e-mailed filters, which
 * run in memory. Hitting it also counts as truncated.
 */
const MAX_LOADED = 5000;

const PRINT_PREFERENCES_GROUP = 'print_preferences';

/** One row of the results list. */
export interface PrintListRow {
  id: string;
  number: string;
  internalNumber: number | null;
  postingDate: Date;
  bpCode: string | null;
  bpName: string | null;
  total: string;
  currency: string;
  status: string;
  isCancelled: boolean;
  printed: boolean;
  printCount: number;
  lastPrintedAt: Date | null;
  emailed: boolean;
  emailCount: number;
  lastEmailedAt: Date | null;
}

/** Everything the window needs to lay one document out on paper. */
export interface PrintableDocument {
  id: string;
  documentType: PrintableDocumentType;
  title: string;
  number: string;
  postingDate: Date;
  dueDate: Date | null;
  reference: string | null;
  remarks: string | null;
  currency: string;
  status: string;
  isDraft: boolean;
  isCancelled: boolean;
  printCount: number;
  partner: {
    code: string;
    name: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
    address: string | null;
  } | null;
  /** Column headers, then one string per column per line. */
  columns: string[];
  lines: string[][];
  totals: { label: string; value: string }[];
}

/** A document row as loaded, before it is shaped for the list. */
interface Candidate {
  id: string;
  number: string;
  postingDate: Date;
  bpCode: string | null;
  bpName: string | null;
  total: Prisma.Decimal;
  currency: string;
  status: string;
  isCancelled: boolean;
}

/**
 * Financials → Document Printing.
 *
 * Finds posted documents of one type by the Selection Criteria window's
 * filters, hands back what is needed to print them, and records SAP's
 * Printed / E-Mailed flags once the user confirms the output went out.
 * Drafts are never offered: SAP prints a draft from the draft itself.
 */
@Injectable()
export class DocumentPrintingService {
  private readonly logger = new Logger(DocumentPrintingService.name);
  private transporter?: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ── Lookups ────────────────────────────────────────────────────────────────

  async lookups(user: AuthedUser) {
    const companyId = this.company(user);
    const [company, series, groups, prefsRow] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      }),
      this.prisma.numberingSeries.findMany({
        where: { companyId, documentType: 'journal_entry' },
        select: { id: true, name: true, isDefault: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.businessPartnerGroup.findMany({
        where: { companyId, isActive: true },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.companySetting.findMany({
        where: { companyId, group: PRINT_PREFERENCES_GROUP },
      }),
    ]);

    return {
      companyName: company?.name ?? '',
      documentTypes: (
        Object.keys(DOCUMENT_TYPE_DEFS) as PrintableDocumentType[]
      ).map((key) => ({
        key,
        label: DOCUMENT_TYPE_DEFS[key].label,
        allowed: this.holds(user, DOCUMENT_TYPE_DEFS[key].permission),
      })),
      series,
      customerGroups: groups.filter((g) => g.type === BpCardType.CUSTOMER),
      vendorGroups: groups.filter((g) => g.type === BpCardType.VENDOR),
      printPreferences: this.mergePreferences(prefsRow),
      emailConfigured: !!this.config.get<string>('notifications.smtp.host'),
    };
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async search(user: AuthedUser, dto: DocumentPrintingSearchDto) {
    const companyId = this.company(user);
    this.authorize(user, dto.documentType);
    this.validateRanges(dto);

    const bpIds = await this.partnerFilter(companyId, dto);
    // A BP filter that matches no partner matches no document either.
    if (bpIds && bpIds.length === 0) return { rows: [], truncated: false };

    const candidates = await this.loadCandidates(companyId, dto, bpIds);

    let rows = candidates.map((c) => ({
      ...c,
      internalNumber: internalNumberOf(c.number),
    }));
    if (
      dto.internalNumberFrom !== undefined ||
      dto.internalNumberTo !== undefined
    ) {
      rows = rows.filter(
        (r) =>
          r.internalNumber !== null &&
          (dto.internalNumberFrom === undefined ||
            r.internalNumber >= dto.internalNumberFrom) &&
          (dto.internalNumberTo === undefined ||
            r.internalNumber <= dto.internalNumberTo),
      );
    }

    const statuses = await this.statusMap(
      companyId,
      dto.documentType,
      rows.map((r) => r.id),
    );
    let out: PrintListRow[] = rows.map((r) => {
      const s = statuses.get(r.id);
      return {
        id: r.id,
        number: r.number,
        internalNumber: r.internalNumber,
        postingDate: r.postingDate,
        bpCode: r.bpCode,
        bpName: r.bpName,
        total: r.total.toFixed(2),
        currency: r.currency,
        status: r.status,
        isCancelled: r.isCancelled,
        printed: (s?.printCount ?? 0) > 0,
        printCount: s?.printCount ?? 0,
        lastPrintedAt: s?.lastPrintedAt ?? null,
        emailed: (s?.emailCount ?? 0) > 0,
        emailCount: s?.emailCount ?? 0,
        lastEmailedAt: s?.lastEmailedAt ?? null,
      };
    });
    if (dto.onlyNotPrinted) out = out.filter((r) => !r.printed);
    if (dto.onlyNotEmailed) out = out.filter((r) => !r.emailed);

    out.sort(
      (a, b) =>
        a.postingDate.getTime() - b.postingDate.getTime() ||
        (a.internalNumber ?? 0) - (b.internalNumber ?? 0) ||
        a.number.localeCompare(b.number),
    );
    return {
      rows: out.slice(0, MAX_RESULTS),
      truncated: out.length > MAX_RESULTS || candidates.length >= MAX_LOADED,
    };
  }

  // ── Documents for output ───────────────────────────────────────────────────

  async documents(
    user: AuthedUser,
    documentType: PrintableDocumentType,
    ids: string[],
  ) {
    const companyId = this.company(user);
    this.authorize(user, documentType);
    const docs = await this.loadPrintable(companyId, documentType, unique(ids));
    if (docs.length !== unique(ids).length) {
      throw new NotFoundException(
        'One or more selected documents no longer exist',
      );
    }
    const statuses = await this.statusMap(
      companyId,
      documentType,
      docs.map((d) => d.id),
    );
    for (const d of docs) d.printCount = statuses.get(d.id)?.printCount ?? 0;
    // Keep the order the user selected them in.
    const order = new Map(ids.map((id, i) => [id, i]));
    return docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  // ── Printed / E-Mailed flags ───────────────────────────────────────────────

  async mark(
    user: AuthedUser,
    documentType: PrintableDocumentType,
    ids: string[],
    output: OutputKind,
  ) {
    const companyId = this.company(user);
    this.authorize(user, documentType);
    const wanted = unique(ids);
    const found = await this.existingIds(companyId, documentType, wanted);
    if (found.length !== wanted.length) {
      throw new NotFoundException(
        'One or more selected documents no longer exist',
      );
    }

    await this.recordOutput(companyId, user.sub, documentType, found, output);
    return { documentType, output, marked: found.length };
  }

  async email(user: AuthedUser, dto: EmailDocumentsDto) {
    const companyId = this.company(user);
    this.authorize(user, dto.documentType);
    if (!this.config.get<string>('notifications.smtp.host')) {
      throw new ServiceUnavailableException(
        'E-mail is not configured on the server (SMTP_HOST is empty)',
      );
    }

    const docs = await this.loadPrintable(
      companyId,
      dto.documentType,
      unique(dto.documents.map((d) => d.id)),
    );
    const byId = new Map(docs.map((d) => [d.id, d]));
    const from = this.config.get<string>(
      'notifications.smtp.from',
      'noreply@erp.local',
    );
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });

    const results: {
      id: string;
      number: string | null;
      ok: boolean;
      to?: string;
      error?: string;
    }[] = [];
    const sent: string[] = [];
    for (const item of dto.documents) {
      const doc = byId.get(item.id);
      if (!doc) {
        results.push({
          id: item.id,
          number: null,
          ok: false,
          error: 'Document not found',
        });
        continue;
      }
      const to = doc.partner?.email;
      if (!to) {
        results.push({
          id: doc.id,
          number: doc.number,
          ok: false,
          error: 'Business partner has no e-mail address',
        });
        continue;
      }
      try {
        await this.transport().sendMail({
          from,
          to,
          subject: `${company?.name ? `${company.name} — ` : ''}${doc.title} ${doc.number}`,
          html: item.html,
        });
        results.push({ id: doc.id, number: doc.number, ok: true, to });
        sent.push(doc.id);
      } catch (e) {
        const msg = (e as Error).message;
        this.logger.warn(
          `[document-printing/email] ${doc.number} to=${to}: ${msg}`,
        );
        results.push({
          id: doc.id,
          number: doc.number,
          ok: false,
          to,
          error: msg,
        });
      }
    }

    // A sent mail is the confirmation: unlike paper, there is no "did it come
    // out right?" question to ask, so the flag is set straight away.
    if (sent.length)
      await this.recordOutput(
        companyId,
        user.sub,
        dto.documentType,
        sent,
        'email',
      );
    return { sent: sent.length, failed: results.length - sent.length, results };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private company(user: AuthedUser): string {
    if (!user.companyId) throw new BadRequestException('No company selected');
    return user.companyId;
  }

  private holds(user: AuthedUser, key: string): boolean {
    if (user.isSuperAdmin) return true;
    return (user.permissions ?? []).some((p) => {
      const k = p.split(':')[0];
      return k === '*' || k === key;
    });
  }

  /** The route only needs the module; each type needs its own view right. */
  private authorize(user: AuthedUser, type: PrintableDocumentType) {
    const key = DOCUMENT_TYPE_DEFS[type].permission;
    if (!this.holds(user, key))
      throw new ForbiddenException(`Missing permission: ${key}`);
  }

  private validateRanges(dto: DocumentPrintingSearchDto) {
    const bad = (label: string) => {
      throw new BadRequestException(`${label} "From" must not be after "To"`);
    };
    if (
      dto.postingDateFrom &&
      dto.postingDateTo &&
      dto.postingDateFrom > dto.postingDateTo
    )
      bad('Posting Date');
    if (dto.accountFrom && dto.accountTo && dto.accountFrom > dto.accountTo)
      bad('Account');
    if (dto.bpCodeFrom && dto.bpCodeTo && dto.bpCodeFrom > dto.bpCodeTo)
      bad('BP Code');
    if (
      dto.internalNumberFrom !== undefined &&
      dto.internalNumberTo !== undefined &&
      dto.internalNumberFrom > dto.internalNumberTo
    )
      bad('Internal Number');
    if (dto.seriesId && dto.documentType !== 'journal_entry') {
      throw new BadRequestException(
        'Series can only be chosen for journal entries',
      );
    }
  }

  private mergePreferences(rows: { key: string; value: unknown }[]) {
    const out: Record<string, unknown> = {
      ...(SETTINGS_DEFAULTS[PRINT_PREFERENCES_GROUP] ?? {}),
    };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /**
   * Partner ids allowed by the BP code range, the customer / vendor group and
   * the properties, or null when none of those filters is set.
   */
  private async partnerFilter(
    companyId: string,
    dto: DocumentPrintingSearchDto,
  ): Promise<string[] | null> {
    const side = DOCUMENT_TYPE_DEFS[dto.documentType].side;
    const customerGroupId =
      side === BpCardType.VENDOR ? undefined : dto.customerGroupId;
    const vendorGroupId =
      side === BpCardType.CUSTOMER ? undefined : dto.vendorGroupId;
    const mode: PropertyMode = dto.properties?.length
      ? (dto.propertiesMode ?? 'ignore')
      : 'ignore';

    if (
      !dto.bpCodeFrom &&
      !dto.bpCodeTo &&
      !customerGroupId &&
      !vendorGroupId &&
      mode === 'ignore'
    ) {
      return null;
    }

    const cardCode: Prisma.StringFilter = {};
    if (dto.bpCodeFrom) cardCode.gte = dto.bpCodeFrom;
    if (dto.bpCodeTo) cardCode.lte = dto.bpCodeTo;

    const where: Prisma.BusinessPartnerWhereInput = { companyId };
    if (dto.bpCodeFrom || dto.bpCodeTo) where.cardCode = cardCode;
    if (side !== 'ANY') where.cardType = side;

    // A group belongs to one side, so it only narrows partners of that side.
    // On a journal entry, which can carry either, a customer must be in the
    // customer group and a vendor in the vendor group.
    if (customerGroupId || vendorGroupId) {
      where.OR = [
        {
          cardType: BpCardType.CUSTOMER,
          ...(customerGroupId ? { groupId: customerGroupId } : {}),
        },
        {
          cardType: BpCardType.VENDOR,
          ...(vendorGroupId ? { groupId: vendorGroupId } : {}),
        },
      ];
    }

    const partners = await this.prisma.businessPartner.findMany({
      where,
      select: { id: true, properties: true },
    });

    if (mode === 'ignore') return partners.map((p) => p.id);
    const wanted = dto.properties ?? [];
    return partners
      .filter((p) => {
        const held = propertySet(p.properties);
        return mode === 'and'
          ? wanted.every((n) => held.has(n))
          : wanted.some((n) => held.has(n));
      })
      .map((p) => p.id);
  }

  private dateRange(
    dto: DocumentPrintingSearchDto,
  ): Prisma.DateTimeFilter | undefined {
    if (!dto.postingDateFrom && !dto.postingDateTo) return undefined;
    const f: Prisma.DateTimeFilter = {};
    if (dto.postingDateFrom) f.gte = startOfDay(dto.postingDateFrom);
    if (dto.postingDateTo) f.lte = endOfDay(dto.postingDateTo);
    return f;
  }

  /** "Some line of the journal entry posts to an account in the range." */
  private accountLines(
    dto: DocumentPrintingSearchDto,
  ): Prisma.JournalLineListRelationFilter | undefined {
    if (!dto.accountFrom && !dto.accountTo) return undefined;
    const code: Prisma.StringFilter = {};
    if (dto.accountFrom) code.gte = dto.accountFrom;
    if (dto.accountTo) code.lte = dto.accountTo;
    return { some: { account: { code } } };
  }

  private async loadCandidates(
    companyId: string,
    dto: DocumentPrintingSearchDto,
    bpIds: string[] | null,
  ): Promise<Candidate[]> {
    const date = this.dateRange(dto);
    const lines = this.accountLines(dto);
    const take = MAX_LOADED;

    switch (dto.documentType) {
      case 'journal_entry': {
        const lineFilters: Prisma.JournalEntryWhereInput[] = [];
        if (lines) lineFilters.push({ lines: lines });
        if (bpIds)
          lineFilters.push({ lines: { some: { bpId: { in: bpIds } } } });
        const rows = await this.prisma.journalEntry.findMany({
          where: {
            companyId,
            status: { not: 'DRAFT' },
            ...(date ? { date } : {}),
            ...(dto.seriesId ? { seriesId: dto.seriesId } : {}),
            ...(lineFilters.length ? { AND: lineFilters } : {}),
          },
          select: {
            id: true,
            number: true,
            date: true,
            totalDebit: true,
            currency: true,
            status: true,
            lines: {
              where: { bpId: { not: null } },
              select: { bp: { select: { cardCode: true, cardName: true } } },
              take: 1,
              orderBy: { ordering: 'asc' },
            },
          },
          take,
        });
        return rows.map((r) => ({
          id: r.id,
          number: r.number,
          postingDate: r.date,
          bpCode: r.lines[0]?.bp?.cardCode ?? null,
          bpName: r.lines[0]?.bp?.cardName ?? null,
          total: r.totalDebit,
          currency: r.currency,
          status: r.status,
          isCancelled: r.status === 'REVERSED',
        }));
      }

      case 'ar_invoice': {
        const rows = await this.prisma.aRInvoice.findMany({
          where: {
            companyId,
            status: { not: 'DRAFT' },
            ...(date ? { issueDate: date } : {}),
            ...(bpIds ? { bpId: { in: bpIds } } : {}),
            ...(lines ? { journalEntry: { lines } } : {}),
          },
          select: {
            id: true,
            number: true,
            issueDate: true,
            total: true,
            currency: true,
            status: true,
            bp: { select: { cardCode: true, cardName: true } },
          },
          take,
        });
        return rows.map((r) => ({
          id: r.id,
          number: r.number,
          postingDate: r.issueDate,
          bpCode: r.bp.cardCode,
          bpName: r.bp.cardName,
          total: r.total,
          currency: r.currency,
          status: r.status,
          isCancelled: r.status === 'VOID',
        }));
      }

      case 'ap_invoice': {
        const rows = await this.prisma.aPBill.findMany({
          where: {
            companyId,
            status: { not: 'DRAFT' },
            ...(date ? { issueDate: date } : {}),
            ...(bpIds ? { bpId: { in: bpIds } } : {}),
            ...(lines ? { journalEntry: { lines } } : {}),
          },
          select: {
            id: true,
            number: true,
            issueDate: true,
            total: true,
            currency: true,
            status: true,
            bp: { select: { cardCode: true, cardName: true } },
          },
          take,
        });
        return rows.map((r) => ({
          id: r.id,
          number: r.number,
          postingDate: r.issueDate,
          bpCode: r.bp.cardCode,
          bpName: r.bp.cardName,
          total: r.total,
          currency: r.currency,
          status: r.status,
          isCancelled: r.status === 'VOID',
        }));
      }

      case 'incoming_payment': {
        const rows = await this.prisma.aRPayment.findMany({
          where: {
            companyId,
            ...(date ? { receivedAt: date } : {}),
            ...(bpIds ? { invoice: { bpId: { in: bpIds } } } : {}),
            ...(lines ? { journalEntry: { lines } } : {}),
          },
          select: {
            id: true,
            amount: true,
            currency: true,
            receivedAt: true,
            journalEntry: { select: { number: true, status: true } },
            invoice: {
              select: {
                number: true,
                bp: { select: { cardCode: true, cardName: true } },
              },
            },
          },
          take,
        });
        return rows.map((r) => ({
          id: r.id,
          number: paymentNumber(r.id, r.journalEntry?.number),
          postingDate: r.receivedAt,
          bpCode: r.invoice.bp.cardCode,
          bpName: r.invoice.bp.cardName,
          total: r.amount,
          currency: r.currency,
          status: r.journalEntry?.status ?? 'POSTED',
          isCancelled: r.journalEntry?.status === 'REVERSED',
        }));
      }

      case 'outgoing_payment': {
        const rows = await this.prisma.aPPayment.findMany({
          where: {
            companyId,
            ...(date ? { paidAt: date } : {}),
            ...(bpIds ? { bill: { bpId: { in: bpIds } } } : {}),
            ...(lines ? { journalEntry: { lines } } : {}),
          },
          select: {
            id: true,
            amount: true,
            currency: true,
            paidAt: true,
            journalEntry: { select: { number: true, status: true } },
            bill: {
              select: {
                number: true,
                bp: { select: { cardCode: true, cardName: true } },
              },
            },
          },
          take,
        });
        return rows.map((r) => ({
          id: r.id,
          number: paymentNumber(r.id, r.journalEntry?.number),
          postingDate: r.paidAt,
          bpCode: r.bill.bp.cardCode,
          bpName: r.bill.bp.cardName,
          total: r.amount,
          currency: r.currency,
          status: r.journalEntry?.status ?? 'POSTED',
          isCancelled: r.journalEntry?.status === 'REVERSED',
        }));
      }
    }
  }

  private async existingIds(
    companyId: string,
    type: PrintableDocumentType,
    ids: string[],
  ): Promise<string[]> {
    const where = { companyId, id: { in: ids } };
    const select = { id: true } as const;
    switch (type) {
      case 'journal_entry':
        return (
          await this.prisma.journalEntry.findMany({
            where: { ...where, status: { not: 'DRAFT' } },
            select,
          })
        ).map((r) => r.id);
      case 'ar_invoice':
        return (
          await this.prisma.aRInvoice.findMany({
            where: { ...where, status: { not: 'DRAFT' } },
            select,
          })
        ).map((r) => r.id);
      case 'ap_invoice':
        return (
          await this.prisma.aPBill.findMany({
            where: { ...where, status: { not: 'DRAFT' } },
            select,
          })
        ).map((r) => r.id);
      case 'incoming_payment':
        return (await this.prisma.aRPayment.findMany({ where, select })).map(
          (r) => r.id,
        );
      case 'outgoing_payment':
        return (await this.prisma.aPPayment.findMany({ where, select })).map(
          (r) => r.id,
        );
    }
  }

  private async statusMap(
    companyId: string,
    documentType: string,
    ids: string[],
  ) {
    if (!ids.length)
      return new Map<
        string,
        {
          printCount: number;
          lastPrintedAt: Date | null;
          emailCount: number;
          lastEmailedAt: Date | null;
        }
      >();
    const rows = await this.prisma.documentOutputStatus.findMany({
      where: { companyId, documentType, documentId: { in: ids } },
      select: {
        documentId: true,
        printCount: true,
        lastPrintedAt: true,
        emailCount: true,
        lastEmailedAt: true,
      },
    });
    return new Map(rows.map((r) => [r.documentId, r]));
  }

  private async recordOutput(
    companyId: string,
    userId: string,
    documentType: PrintableDocumentType,
    ids: string[],
    output: OutputKind,
  ) {
    const now = new Date();
    const bump =
      output === 'print'
        ? {
            printCount: { increment: 1 },
            lastPrintedAt: now,
            lastPrintedById: userId,
          }
        : {
            emailCount: { increment: 1 },
            lastEmailedAt: now,
            lastEmailedById: userId,
          };
    const first =
      output === 'print'
        ? { printCount: 1, lastPrintedAt: now, lastPrintedById: userId }
        : { emailCount: 1, lastEmailedAt: now, lastEmailedById: userId };

    await this.prisma.$transaction(
      ids.map((documentId) =>
        this.prisma.documentOutputStatus.upsert({
          where: {
            companyId_documentType_documentId: {
              companyId,
              documentType,
              documentId,
            },
          },
          create: { companyId, documentType, documentId, ...first },
          update: bump,
        }),
      ),
    );

    await this.audit.record({
      companyId,
      actorId: userId,
      action: output === 'print' ? 'document.printed' : 'document.emailed',
      refType: documentType,
      refId: ids.length === 1 ? ids[0] : undefined,
      module: 'financials',
      details: { documentType, output, count: ids.length, documentIds: ids },
    });
  }

  private async loadPrintable(
    companyId: string,
    type: PrintableDocumentType,
    ids: string[],
  ): Promise<PrintableDocument[]> {
    const bpSelect = {
      cardCode: true,
      cardName: true,
      email: true,
      phone1: true,
      federalTaxId: true,
      addresses: {
        select: {
          street: true,
          streetNo: true,
          building: true,
          city: true,
          zipCode: true,
          state: true,
          country: true,
          isDefault: true,
        },
        orderBy: { isDefault: 'desc' as const },
        take: 1,
      },
    } satisfies Prisma.BusinessPartnerSelect;
    type BpRow = Prisma.BusinessPartnerGetPayload<{ select: typeof bpSelect }>;
    const partner = (
      bp: BpRow | null | undefined,
    ): PrintableDocument['partner'] =>
      bp
        ? {
            code: bp.cardCode,
            name: bp.cardName,
            email: bp.email,
            phone: bp.phone1,
            taxId: bp.federalTaxId,
            address: formatAddress(bp.addresses[0]),
          }
        : null;
    const base = (d: Partial<PrintableDocument>): PrintableDocument => ({
      id: '',
      documentType: type,
      title: DOCUMENT_TYPE_DEFS[type].label,
      number: '',
      postingDate: new Date(),
      dueDate: null,
      reference: null,
      remarks: null,
      currency: 'USD',
      status: '',
      isDraft: false,
      isCancelled: false,
      printCount: 0,
      partner: null,
      columns: [],
      lines: [],
      totals: [],
      ...d,
    });

    switch (type) {
      case 'journal_entry': {
        const rows = await this.prisma.journalEntry.findMany({
          where: { companyId, id: { in: ids }, status: { not: 'DRAFT' } },
          include: {
            lines: {
              orderBy: { ordering: 'asc' },
              include: {
                account: { select: { code: true, name: true } },
                bp: { select: { cardCode: true, cardName: true } },
              },
            },
          },
        });
        return rows.map((r) =>
          base({
            id: r.id,
            number: r.number,
            postingDate: r.date,
            dueDate: r.dueDate,
            reference:
              [r.ref1, r.ref2, r.reference].filter(Boolean).join(' / ') || null,
            remarks: r.description,
            currency: r.currency,
            status: r.status,
            isCancelled: r.status === 'REVERSED',
            columns: [
              'G/L Acct/BP Code',
              'G/L Acct/BP Name',
              'Remarks',
              'Debit',
              'Credit',
            ],
            lines: r.lines.map((l) => [
              l.bp?.cardCode ?? l.account.code,
              l.bp?.cardName ?? l.account.name,
              l.description ?? '',
              l.debit.isZero() ? '' : l.debit.toFixed(2),
              l.credit.isZero() ? '' : l.credit.toFixed(2),
            ]),
            totals: [
              { label: 'Total Debit', value: r.totalDebit.toFixed(2) },
              { label: 'Total Credit', value: r.totalCredit.toFixed(2) },
            ],
          }),
        );
      }

      case 'ar_invoice':
      case 'ap_invoice': {
        // A/R invoices and A/P bills share their printable shape; naming it
        // keeps the two result types from collapsing into a union.
        interface InvoiceRow {
          id: string;
          number: string;
          issueDate: Date;
          dueDate: Date | null;
          notes: string | null;
          currency: string;
          status: string;
          subtotal: Prisma.Decimal;
          tax: Prisma.Decimal;
          total: Prisma.Decimal;
          paid: Prisma.Decimal;
          bp: BpRow;
          lines: {
            description: string;
            quantity: Prisma.Decimal;
            unitPrice: Prisma.Decimal;
            taxPercent: Prisma.Decimal | null;
            tax: Prisma.Decimal;
            lineTotal: Prisma.Decimal;
          }[];
        }
        const rows: InvoiceRow[] =
          type === 'ar_invoice'
            ? await this.prisma.aRInvoice.findMany({
                where: { companyId, id: { in: ids }, status: { not: 'DRAFT' } },
                include: {
                  lines: { orderBy: { ordering: 'asc' } },
                  bp: { select: bpSelect },
                },
              })
            : await this.prisma.aPBill.findMany({
                where: { companyId, id: { in: ids }, status: { not: 'DRAFT' } },
                include: {
                  lines: { orderBy: { ordering: 'asc' } },
                  bp: { select: bpSelect },
                },
              });
        return rows.map((r) =>
          base({
            id: r.id,
            number: r.number,
            postingDate: r.issueDate,
            dueDate: r.dueDate,
            remarks: r.notes,
            currency: r.currency,
            status: r.status,
            isCancelled: r.status === 'VOID',
            partner: partner(r.bp),
            columns: [
              '#',
              'Description',
              'Quantity',
              'Unit Price',
              'Tax %',
              'Tax',
              'Total',
            ],
            lines: r.lines.map((l, i) => [
              String(i + 1),
              l.description,
              trimQty(l.quantity),
              l.unitPrice.toFixed(2),
              l.taxPercent ? l.taxPercent.toFixed(2) : '',
              l.tax.toFixed(2),
              l.lineTotal.toFixed(2),
            ]),
            totals: [
              { label: 'Total Before Tax', value: r.subtotal.toFixed(2) },
              { label: 'Tax', value: r.tax.toFixed(2) },
              { label: 'Total', value: r.total.toFixed(2) },
              { label: 'Paid to Date', value: r.paid.toFixed(2) },
              { label: 'Balance Due', value: r.total.minus(r.paid).toFixed(2) },
            ],
          }),
        );
      }

      case 'incoming_payment': {
        const rows = await this.prisma.aRPayment.findMany({
          where: { companyId, id: { in: ids } },
          include: {
            journalEntry: { select: { number: true, status: true } },
            invoice: {
              select: {
                number: true,
                issueDate: true,
                total: true,
                bp: { select: bpSelect },
              },
            },
          },
        });
        return rows.map((r) =>
          base({
            id: r.id,
            number: paymentNumber(r.id, r.journalEntry?.number),
            postingDate: r.receivedAt,
            reference: r.reference,
            currency: r.currency,
            status: r.journalEntry?.status ?? 'POSTED',
            isCancelled: r.journalEntry?.status === 'REVERSED',
            partner: partner(r.invoice.bp),
            columns: [
              'Document',
              'Invoice Date',
              'Invoice Total',
              'Payment Method',
              'Amount Paid',
            ],
            lines: [
              [
                `A/R Invoice ${r.invoice.number}`,
                isoDay(r.invoice.issueDate),
                r.invoice.total.toFixed(2),
                r.method ?? '',
                r.amount.toFixed(2),
              ],
            ],
            totals: [{ label: 'Total Received', value: r.amount.toFixed(2) }],
          }),
        );
      }

      case 'outgoing_payment': {
        const rows = await this.prisma.aPPayment.findMany({
          where: { companyId, id: { in: ids } },
          include: {
            journalEntry: { select: { number: true, status: true } },
            bill: {
              select: {
                number: true,
                issueDate: true,
                total: true,
                bp: { select: bpSelect },
              },
            },
          },
        });
        return rows.map((r) =>
          base({
            id: r.id,
            number: paymentNumber(r.id, r.journalEntry?.number),
            postingDate: r.paidAt,
            reference: r.reference,
            currency: r.currency,
            status: r.journalEntry?.status ?? 'POSTED',
            isCancelled: r.journalEntry?.status === 'REVERSED',
            partner: partner(r.bill.bp),
            columns: [
              'Document',
              'Invoice Date',
              'Invoice Total',
              'Payment Method',
              'Amount Paid',
            ],
            lines: [
              [
                `A/P Invoice ${r.bill.number}`,
                isoDay(r.bill.issueDate),
                r.bill.total.toFixed(2),
                r.method ?? '',
                r.amount.toFixed(2),
              ],
            ],
            totals: [{ label: 'Total Paid', value: r.amount.toFixed(2) }],
          }),
        );
      }
    }
  }

  private transport(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('notifications.smtp.host'),
      port: this.config.get<number>('notifications.smtp.port', 587),
      secure: this.config.get<boolean>('notifications.smtp.secure', false),
      auth: this.config.get<string>('notifications.smtp.user')
        ? {
            user: this.config.get<string>('notifications.smtp.user')!,
            pass: this.config.get<string>('notifications.smtp.pass')!,
          }
        : undefined,
    });
    return this.transporter;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * SAP's Internal Number is the document's sequence number. Ours live inside
 * the document number ("JE-000123", "INV-2026-0042"), so the last run of
 * digits is taken as it.
 */
export function internalNumberOf(number: string): number | null {
  const m = /(\d+)\D*$/.exec(number);
  return m ? Number(m[1]) : null;
}

/** Payments have no number of their own; the journal entry they posted does. */
function paymentNumber(
  id: string,
  journalNumber: string | null | undefined,
): string {
  return journalNumber ?? id.slice(0, 8).toUpperCase();
}

/** BP properties are stored as { "1": true, … } or as a list of numbers. */
export function propertySet(raw: Prisma.JsonValue | null): Set<number> {
  const out = new Set<number>();
  if (Array.isArray(raw)) {
    for (const v of raw)
      if (typeof v === 'number' || typeof v === 'string') out.add(Number(v));
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw))
      if (v === true || v === 'Y' || v === 1) out.add(Number(k));
  }
  return out;
}

function startOfDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function endOfDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T23:59:59.999Z`);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function trimQty(q: Prisma.Decimal): string {
  return q.toDecimalPlaces(4).toString();
}

function formatAddress(
  a:
    | {
        street: string | null;
        streetNo: string | null;
        building: string | null;
        city: string | null;
        zipCode: string | null;
        state: string | null;
        country: string | null;
      }
    | undefined,
): string | null {
  if (!a) return null;
  const street = [a.streetNo, a.street].filter(Boolean).join(' ');
  const city = [a.zipCode, a.city].filter(Boolean).join(' ');
  const parts = [a.building, street, city, a.state, a.country].filter(
    (p) => p && String(p).trim(),
  );
  return parts.length ? parts.join(', ') : null;
}
