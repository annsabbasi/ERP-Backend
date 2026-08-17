import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';

/** Document types the platform allocates numbers for. Extend as modules land. */
export const NUMBERED_DOCUMENT_TYPES = [
  'journal_entry',
  'ar_invoice',
  'ar_credit_memo',
  'ar_down_payment',
  'ap_bill',
  'ap_credit_memo',
  'sales_order',
  'delivery',
  'return',
  'purchase_order',
  'purchase_request',
  'goods_receipt_po',
  'incoming_payment',
  'outgoing_payment',
  'activity',
  'opportunity',
  'campaign',
  'business_partner',
  'fixed_asset',
] as const;

export type NumberedDocumentType = (typeof NUMBERED_DOCUMENT_TYPES)[number];

@Injectable()
export class NumberingService extends TenantCrudService {
  protected readonly modelName = 'numberingSeries';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Numbering series',
    orderBy: [{ documentType: 'asc' }, { name: 'asc' }],
    searchFields: ['name', 'documentType', 'prefix'],
    filterableFields: ['documentType', 'isDefault', 'isLocked'],
    uniqueBy: ['documentType', 'name'],
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const created = await super.create(cid, {
      ...dto,
      // A fresh series starts handing out numbers at `firstNumber`.
      nextNumber: dto.nextNumber ?? dto.firstNumber ?? 1,
    });
    if (dto.isDefault) {
      await this.setDefault(cid, (created as { id: string }).id);
    }
    return created;
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const existing = (await this.findOne(cid, id)) as {
      nextNumber: number;
      firstNumber: number;
      documentType: string;
    };

    // Rewinding a series would re-issue numbers that already exist on documents.
    if (
      dto.nextNumber !== undefined &&
      Number(dto.nextNumber) < existing.nextNumber
    ) {
      throw new ConflictException(
        `Cannot move the next number backwards (from ${existing.nextNumber} to ` +
          `${dto.nextNumber}) — those numbers may already be in use. Create a new series instead.`,
      );
    }

    const updated = await super.update(cid, id, dto);
    if (dto.isDefault) await this.setDefault(cid, id);
    return updated;
  }

  /**
   * Allocates the next number in a series, inside the caller's transaction.
   *
   * Taking the row with an atomic `update ... increment` (rather than read-then-
   * write) is what keeps two concurrent saves from being handed the same number.
   * The caller must pass its transaction client so the allocation rolls back
   * with the document if the save fails — otherwise a failed save would burn a
   * number and leave a gap, which auditors flag.
   */
  async allocate(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: NumberedDocumentType | string,
    seriesId?: string | null,
  ): Promise<{ number: string; numeric: number; seriesId: string }> {
    const series = seriesId
      ? await tx.numberingSeries.findFirst({ where: { id: seriesId, companyId } })
      : await tx.numberingSeries.findFirst({
          where: { companyId, documentType, isDefault: true, isLocked: false },
        });

    const resolved =
      series ??
      (await tx.numberingSeries.findFirst({
        where: { companyId, documentType, isLocked: false },
        orderBy: { createdAt: 'asc' },
      }));

    if (!resolved) {
      throw new BadRequestException(
        `No numbering series is configured for "${documentType}". ` +
          `Set one up under Administration → System Initialization → Document Numbering.`,
      );
    }
    if (resolved.isLocked) {
      throw new BadRequestException(`Numbering series "${resolved.name}" is locked.`);
    }
    if (resolved.lastNumber !== null && resolved.nextNumber > resolved.lastNumber) {
      throw new ConflictException(
        `Numbering series "${resolved.name}" is exhausted (reached its last number ` +
          `${resolved.lastNumber}). Extend it or add a new series.`,
      );
    }
    const now = new Date();
    if (resolved.effectiveFrom && now < resolved.effectiveFrom) {
      throw new BadRequestException(
        `Numbering series "${resolved.name}" is not effective until ${resolved.effectiveFrom.toISOString().slice(0, 10)}.`,
      );
    }
    if (resolved.effectiveTo && now > resolved.effectiveTo) {
      throw new BadRequestException(
        `Numbering series "${resolved.name}" expired on ${resolved.effectiveTo.toISOString().slice(0, 10)}.`,
      );
    }

    const bumped = await tx.numberingSeries.update({
      where: { id: resolved.id },
      data: { nextNumber: { increment: 1 } },
      select: { nextNumber: true, prefix: true, suffix: true, digits: true },
    });

    // `update` returns the post-increment value, so the number just handed out
    // is one below it.
    const numeric = bumped.nextNumber - 1;
    const body = bumped.digits > 0 ? String(numeric).padStart(bumped.digits, '0') : String(numeric);

    return {
      number: `${bumped.prefix ?? ''}${body}${bumped.suffix ?? ''}`,
      numeric,
      seriesId: resolved.id,
    };
  }

  /** Exactly one default per (company, documentType). */
  async setDefault(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const series = await this.prisma.numberingSeries.findFirst({
      where: { id, companyId: cid },
    });
    if (!series) throw new BadRequestException('Numbering series not found');

    await this.prisma.$transaction([
      this.prisma.numberingSeries.updateMany({
        where: { companyId: cid, documentType: series.documentType, NOT: { id } },
        data: { isDefault: false },
      }),
      this.prisma.numberingSeries.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.findOne(cid, id);
  }

  /**
   * Administration → Utilities → Check Document Numbering. Reports series whose
   * allocation state looks wrong: exhausted, locked-but-default, overlapping
   * ranges within a document type, or a nextNumber below firstNumber.
   */
  async check(companyId: string) {
    const cid = this.requireCompany(companyId);
    const all = await this.prisma.numberingSeries.findMany({
      where: { companyId: cid },
      orderBy: [{ documentType: 'asc' }, { firstNumber: 'asc' }],
    });

    const issues: { seriesId: string; name: string; documentType: string; issue: string }[] = [];
    const byType = new Map<string, typeof all>();

    for (const s of all) {
      if (!byType.has(s.documentType)) byType.set(s.documentType, []);
      byType.get(s.documentType)!.push(s);

      if (s.nextNumber < s.firstNumber) {
        issues.push({ ...ref(s), issue: `nextNumber (${s.nextNumber}) is below firstNumber (${s.firstNumber})` });
      }
      if (s.lastNumber !== null && s.nextNumber > s.lastNumber) {
        issues.push({ ...ref(s), issue: `series is exhausted (next ${s.nextNumber} > last ${s.lastNumber})` });
      }
      if (s.lastNumber !== null && s.lastNumber < s.firstNumber) {
        issues.push({ ...ref(s), issue: `lastNumber (${s.lastNumber}) is below firstNumber (${s.firstNumber})` });
      }
      if (s.isDefault && s.isLocked) {
        issues.push({ ...ref(s), issue: 'series is the default for its document type but is locked' });
      }
    }

    for (const [documentType, list] of byType) {
      if (!list.some((s) => s.isDefault)) {
        issues.push({
          seriesId: '',
          name: '—',
          documentType,
          issue: 'no default series is set for this document type',
        });
      }
      // Overlap check: ranges sharing a prefix must not intersect, or two
      // documents can end up with identical numbers.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if ((a.prefix ?? '') !== (b.prefix ?? '')) continue;
          const aEnd = a.lastNumber ?? Number.MAX_SAFE_INTEGER;
          const bEnd = b.lastNumber ?? Number.MAX_SAFE_INTEGER;
          if (a.firstNumber <= bEnd && b.firstNumber <= aEnd) {
            issues.push({
              ...ref(a),
              issue: `range overlaps series "${b.name}" (same prefix "${a.prefix ?? ''}")`,
            });
          }
        }
      }
    }

    return { checked: all.length, issueCount: issues.length, issues };
  }

  /** The document types the UI can offer, with how many series each already has. */
  async documentTypes(companyId: string) {
    const cid = this.requireCompany(companyId);
    const counts = await this.prisma.numberingSeries.groupBy({
      by: ['documentType'],
      where: { companyId: cid },
      _count: { _all: true },
    });
    const byType = new Map(counts.map((c) => [c.documentType, c._count._all]));
    return NUMBERED_DOCUMENT_TYPES.map((t) => ({
      documentType: t,
      seriesCount: byType.get(t) ?? 0,
    }));
  }
}

function ref(s: { id: string; name: string; documentType: string }) {
  return { seriesId: s.id, name: s.name, documentType: s.documentType };
}
