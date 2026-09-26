import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerStatusWhere } from '../ledger-status';
import {
  ListQuery,
  TenantCrudService,
  TenantCrudOptions,
} from '../../../common/crud/tenant-crud.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

export interface AccountNode {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isTitle: boolean;
  isControl: boolean;
  isActive: boolean;
  level: number;
  balance?: string;
  children: AccountNode[];
}

/**
 * Chart of Accounts.
 *
 * Two invariants are enforced here rather than in the DB, because both depend
 * on rows the constraint system cannot see:
 *   1. A Title account can never carry journal lines (it is a grouping node).
 *   2. The parent chain must stay acyclic and same-company.
 */
@Injectable()
export class AccountsService extends TenantCrudService {
  protected readonly modelName = 'account';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Account',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['type', 'subtype', 'isActive', 'isTitle', 'isControl', 'parentId'],
    uniqueBy: ['code'],
    include: {
      parent: { select: { id: true, code: true, name: true } },
      _count: { select: { children: true, lines: true } },
    },
  };

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ── Tree ───────────────────────────────────────────────────────────────────
  /**
   * Returns the CoA as a forest, one root per AccountType when no parent is set.
   * The window renders drawers per type, so results are grouped that way.
   */
  async tree(companyId: string, query: { type?: AccountType; includeInactive?: boolean } = {}) {
    const cid = this.requireCompany(companyId);
    const rows = await this.prisma.account.findMany({
      where: {
        companyId: cid,
        ...(query.type ? { type: query.type } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });

    const byId = new Map<string, AccountNode>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        isTitle: r.isTitle,
        isControl: r.isControl,
        isActive: r.isActive,
        level: r.level,
        children: [],
      });
    }

    const roots: AccountNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      // A parent filtered out by `type` leaves its child orphaned; promote it to
      // a root rather than dropping it from the tree entirely.
      const parent = r.parentId ? byId.get(r.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /**
   * Per-account balances over a date range, computed from posted journal lines.
   * Grouped in SQL so the whole ledger never has to be pulled into memory.
   */
  async balances(
    companyId: string,
    opts: { from?: Date; to?: Date; includeUnposted?: boolean } = {},
  ) {
    const cid = this.requireCompany(companyId);
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          companyId: cid,
          ...ledgerStatusWhere(opts.includeUnposted),
          ...(opts.from || opts.to
            ? { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
            : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    return grouped.map((g) => {
      const debit = g._sum.debit ?? new Prisma.Decimal(0);
      const credit = g._sum.credit ?? new Prisma.Decimal(0);
      return {
        accountId: g.accountId,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        // Signed the natural way for the account's side; the report layer
        // decides presentation.
        balance: debit.minus(credit).toFixed(2),
      };
    });
  }

  // ── Writes ─────────────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateAccountDto) {
    const cid = this.requireCompany(companyId);
    const level = await this.resolveLevel(cid, dto.parentId);
    await this.assertParentValid(cid, dto.parentId, null);
    return super.create(cid, { ...dto, level } as unknown as Record<string, unknown>);
  }

  async update(companyId: string, id: string, dto: UpdateAccountDto) {
    const cid = this.requireCompany(companyId);
    const existing = await this.prisma.account.findFirst({
      where: { id, companyId: cid },
      include: { _count: { select: { lines: true, children: true } } },
    });
    if (!existing) return super.update(cid, id, dto as Record<string, unknown>); // throws 404

    // Turning a posted account into a Title node would strand its journal lines
    // on a node that is not supposed to hold any.
    if (dto.isTitle === true && existing._count.lines > 0) {
      throw new ConflictException(
        `Account ${existing.code} has ${existing._count.lines} journal line(s) and ` +
          `cannot be converted to a Title account. Reclassify those postings first.`,
      );
    }

    if (dto.parentId !== undefined) {
      await this.assertParentValid(cid, dto.parentId ?? undefined, id);
    }

    const level =
      dto.parentId !== undefined
        ? await this.resolveLevel(cid, dto.parentId ?? undefined)
        : undefined;

    const updated = await super.update(cid, id, {
      ...dto,
      ...(level !== undefined ? { level } : {}),
    } as Record<string, unknown>);

    // Depth changed → the whole subtree shifts with it.
    if (level !== undefined) await this.recomputeSubtreeLevels(cid, id, level);
    return updated;
  }

  async remove(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    const acc = await this.prisma.account.findFirst({
      where: { id, companyId: cid },
      include: { _count: { select: { lines: true, children: true } } },
    });
    if (!acc) return super.remove(cid, id); // throws 404

    if (acc._count.lines > 0) {
      throw new ConflictException(
        `Account ${acc.code} carries ${acc._count.lines} journal line(s). ` +
          `Accounts with history are deactivated, never deleted, so the ledger stays auditable.`,
      );
    }
    if (acc._count.children > 0) {
      throw new ConflictException(
        `Account ${acc.code} has ${acc._count.children} child account(s). Remove or re-parent them first.`,
      );
    }
    return super.remove(cid, id);
  }

  /** Used by posting routines to reject invalid targets early with a clear reason. */
  async assertPostable(companyId: string, accountId: string) {
    const acc = await this.prisma.account.findFirst({
      where: { id: accountId, companyId },
      select: { id: true, code: true, name: true, isTitle: true, isActive: true, isControl: true },
    });
    if (!acc) {
      throw new BadRequestException(`Account ${accountId} does not exist in this company`);
    }
    if (acc.isTitle) {
      throw new BadRequestException(
        `Account ${acc.code} (${acc.name}) is a Title account and cannot be posted to directly.`,
      );
    }
    if (!acc.isActive) {
      throw new BadRequestException(`Account ${acc.code} (${acc.name}) is inactive.`);
    }
    return acc;
  }

  /**
   * assertPostable for several accounts in one query — same rules, same
   * messages, checked in the order given. A journal with five lines used to
   * make five sequential round trips here, which on the hosted database is
   * several seconds of a posting.
   */
  async assertPostableMany(companyId: string, accountIds: string[]) {
    const rows = await this.prisma.account.findMany({
      where: { id: { in: [...new Set(accountIds)] }, companyId },
      select: { id: true, code: true, name: true, isTitle: true, isActive: true, isControl: true },
    });
    const byId = new Map(rows.map((a) => [a.id, a]));
    for (const id of accountIds) {
      const acc = byId.get(id);
      if (!acc) throw new BadRequestException(`Account ${id} does not exist in this company`);
      if (acc.isTitle) {
        throw new BadRequestException(`Account ${acc.code} (${acc.name}) is a Title account and cannot be posted to directly.`);
      }
      if (!acc.isActive) throw new BadRequestException(`Account ${acc.code} (${acc.name}) is inactive.`);
    }
    return byId;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private async resolveLevel(companyId: string, parentId?: string | null): Promise<number> {
    if (!parentId) return 1;
    const parent = await this.prisma.account.findFirst({
      where: { id: parentId, companyId },
      select: { level: true },
    });
    return (parent?.level ?? 0) + 1;
  }

  /**
   * Rejects a parent that is missing, in another company, or inside this
   * account's own subtree (which would create a cycle the tree builder would
   * silently drop).
   */
  private async assertParentValid(
    companyId: string,
    parentId: string | undefined,
    selfId: string | null,
  ) {
    if (!parentId) return;
    if (parentId === selfId) {
      throw new BadRequestException('An account cannot be its own parent');
    }
    const parent = await this.prisma.account.findFirst({
      where: { id: parentId, companyId },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      throw new BadRequestException('Parent account not found in this company');
    }
    if (!selfId) return;

    let cursor: string | null = parent.parentId;
    const seen = new Set<string>([parent.id]);
    while (cursor) {
      if (cursor === selfId) {
        throw new BadRequestException(
          'That parent sits inside this account’s own subtree, which would create a cycle',
        );
      }
      if (seen.has(cursor)) break; // pre-existing cycle; don't spin
      seen.add(cursor);
      const next: { parentId: string | null } | null =
        await this.prisma.account.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = next?.parentId ?? null;
    }
  }

  private async recomputeSubtreeLevels(companyId: string, rootId: string, rootLevel: number) {
    let frontier = [{ id: rootId, level: rootLevel }];
    while (frontier.length) {
      const children = await this.prisma.account.findMany({
        where: { companyId, parentId: { in: frontier.map((f) => f.id) } },
        select: { id: true, parentId: true },
      });
      if (!children.length) return;
      const levelByParent = new Map(frontier.map((f) => [f.id, f.level]));
      const next: { id: string; level: number }[] = [];
      for (const c of children) {
        const level = (levelByParent.get(c.parentId!) ?? 1) + 1;
        await this.prisma.account.update({ where: { id: c.id }, data: { level } });
        next.push({ id: c.id, level });
      }
      frontier = next;
    }
  }

  /** Overridden so `?type=` and friends coerce to the right shapes. */
  async findAll(companyId: string, query: ListQuery = {}) {
    return super.findAll(companyId, query);
  }
}
