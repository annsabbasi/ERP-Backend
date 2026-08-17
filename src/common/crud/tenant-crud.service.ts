import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Shared tenant-scoped CRUD.
 *
 * The Administration / Financials / CRM surface carries ~40 setup catalogs
 * (territories, commission groups, tax codes, currencies, competitors, …) whose
 * only real difference is the Prisma model and a couple of options. Hand-writing
 * a service each would be 40 chances to forget the `companyId` filter — which is
 * the one mistake that breaks tenant isolation. Centralising it means the filter
 * is applied in exactly one place and cannot be skipped by a subclass.
 *
 * Anything with real domain behaviour (journal posting, approval routing,
 * opportunity stage transitions) does NOT use this — those get bespoke services.
 */
export interface TenantCrudOptions {
  /** Human-readable singular name, used in error messages. */
  entityName: string;
  /** Prisma `include` applied to every read. */
  include?: Record<string, unknown>;
  /** Prisma `select` applied to every read. Mutually exclusive with `include`. */
  select?: Record<string, unknown>;
  /** Default ordering for list queries. */
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  /** Fields matched (case-insensitive, contains) by the `?search=` param. */
  searchFields?: string[];
  /**
   * Fields that, together with companyId, must stay unique. Used only to turn
   * Prisma's P2002 into a readable message — the DB constraint is the real guard.
   */
  uniqueBy?: string[];
  /**
   * When set, list results can be narrowed by these query params
   * (e.g. ['isActive', 'cardType']). Values arrive as strings and are coerced.
   */
  filterableFields?: string[];
  /** Soft-delete instead of hard-delete when the model has an `isActive` flag. */
  softDelete?: boolean;
}

export interface ListQuery {
  search?: string;
  skip?: number;
  take?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  [key: string]: unknown;
}

export abstract class TenantCrudService<TEntity = Record<string, unknown>> {
  /** Key of the Prisma delegate, e.g. 'territory'. */
  protected abstract readonly modelName: string;
  protected abstract readonly options: TenantCrudOptions;

  constructor(protected readonly prisma: PrismaService) {}

  protected get delegate(): any {
    const d = (this.prisma as unknown as Record<string, unknown>)[this.modelName];
    if (!d) {
      throw new Error(
        `TenantCrudService: no Prisma delegate named "${this.modelName}". ` +
          `Check the model name and that \`prisma generate\` has run.`,
      );
    }
    return d;
  }

  /**
   * Shared read shape so list and detail never drift apart.
   *
   * Typed loosely on purpose: `include` and `select` are mutually exclusive in
   * Prisma's generated types, and spreading a union of the two into a delegate
   * call makes the compiler pick one arm and reject the other. The shape is
   * validated by the delegate at the call site instead.
   */
  protected readArgs(): Record<string, any> {
    const { include, select } = this.options;
    return select ? { select } : include ? { include } : {};
  }

  protected requireCompany(companyId: string | null | undefined): string {
    if (!companyId) {
      throw new ForbiddenException(
        'This endpoint is company-scoped; the current token carries no company. ' +
          'Log in as a company user rather than a platform super admin.',
      );
    }
    return companyId;
  }

  // ── READ ───────────────────────────────────────────────────────────────────
  async findAll(companyId: string, query: ListQuery = {}): Promise<TEntity[]> {
    const cid = this.requireCompany(companyId);
    const where: Record<string, unknown> = { companyId: cid };

    const { search, skip, take, orderBy, orderDir } = query;

    if (search && this.options.searchFields?.length) {
      where.OR = this.options.searchFields.map((f) => ({
        [f]: { contains: search, mode: 'insensitive' },
      }));
    }

    for (const field of this.options.filterableFields ?? []) {
      const raw = query[field];
      if (raw === undefined || raw === '' || raw === null) continue;
      where[field] = coerceFilter(raw);
    }

    return this.delegate.findMany({
      where,
      ...this.readArgs(),
      orderBy: orderBy ? { [orderBy]: orderDir ?? 'asc' } : this.options.orderBy,
      ...(skip !== undefined ? { skip: Number(skip) } : {}),
      ...(take !== undefined ? { take: Number(take) } : {}),
    });
  }

  async count(companyId: string, query: ListQuery = {}): Promise<number> {
    const cid = this.requireCompany(companyId);
    const where: Record<string, unknown> = { companyId: cid };
    for (const field of this.options.filterableFields ?? []) {
      const raw = query[field];
      if (raw === undefined || raw === '' || raw === null) continue;
      where[field] = coerceFilter(raw);
    }
    return this.delegate.count({ where });
  }

  async findOne(companyId: string, id: string): Promise<TEntity> {
    const cid = this.requireCompany(companyId);
    // findFirst (not findUnique) so companyId participates in the lookup —
    // a wrong-tenant id must read as "not found", never as someone else's row.
    const found = await this.delegate.findFirst({
      where: { id, companyId: cid },
      ...this.readArgs(),
    });
    if (!found) {
      throw new NotFoundException(`${this.options.entityName} ${id} not found`);
    }
    return found;
  }

  // ── WRITE ──────────────────────────────────────────────────────────────────
  // `dto` is intentionally `any` on the base: subclasses narrow it to their own
  // DTO class, which a stricter base signature would reject as an unsafe
  // override. Validation happens in the pipe before the service is reached.
  async create(companyId: string, dto: any): Promise<any> {
    const cid = this.requireCompany(companyId);
    try {
      return await this.delegate.create({
        // companyId comes from the JWT and is written last so a companyId in the
        // request body can never override it.
        data: { ...this.beforeWrite(dto), companyId: cid },
        ...this.readArgs(),
      });
    } catch (e) {
      throw this.translatePrismaError(e, dto);
    }
  }

  async update(companyId: string, id: string, dto: any): Promise<any> {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id); // tenant check
    const data = this.beforeWrite(dto);
    delete (data as Record<string, unknown>).companyId;
    try {
      return await this.delegate.update({
        where: { id },
        data,
        ...this.readArgs(),
      });
    } catch (e) {
      throw this.translatePrismaError(e, dto);
    }
  }

  async remove(companyId: string, id: string): Promise<{ id: string; message: string }> {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);

    if (this.options.softDelete) {
      await this.delegate.update({ where: { id }, data: { isActive: false } });
      return { id, message: `${this.options.entityName} deactivated` };
    }

    try {
      await this.delegate.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          `Cannot delete this ${this.options.entityName.toLowerCase()} — other ` +
            `records still reference it. Deactivate it instead.`,
        );
      }
      throw e;
    }
    return { id, message: `${this.options.entityName} deleted` };
  }

  /**
   * Hook for subclasses to normalise a DTO before it hits Prisma — date
   * coercion, derived fields, stripping empty foreign keys. Default converts
   * '' to null for optional relations, which is what HTML selects submit.
   */
  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      out[k] = v === '' ? null : v;
    }
    return out;
  }

  protected translatePrismaError(e: unknown, dto: Record<string, unknown>): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        const fields =
          (e.meta?.target as string[] | undefined)?.filter((f) => f !== 'companyId') ??
          this.options.uniqueBy ??
          [];
        const shown = fields.map((f) => `${f}="${dto[f] ?? ''}"`).join(', ');
        return new ConflictException(
          `A ${this.options.entityName.toLowerCase()} with ${shown || 'those values'} already exists.`,
        );
      }
      if (e.code === 'P2003') {
        return new BadRequestException(
          `A referenced record does not exist or belongs to another company ` +
            `(field: ${String(e.meta?.field_name ?? 'unknown')}).`,
        );
      }
      if (e.code === 'P2025') {
        return new NotFoundException(`${this.options.entityName} not found`);
      }
    }
    return e;
  }
}

/** Query params arrive as strings; turn the obvious ones back into real types. */
function coerceFilter(raw: unknown): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}
