import { Injectable } from '@nestjs/common';
import { uuidv7, type AuditEntry } from '@erp/contracts';
import { Prisma } from '@erp/db';
import { ClsService } from 'nestjs-cls';
import type { z } from 'zod';
import type { AuditQuerySchema } from '@erp/contracts';
import { PlatformDatabase } from './platform-database.service';
import type { StaffContext } from './staff-access.service';

// The platform audit log (Part 03 §3.17): append-only and hash-chained, written only through
// platform.append_audit in the same transaction as the change it records, read with the
// visibility of the §3.2.1 matrix (everything, own actions, billing events or ops events).

export type Tx = Prisma.TransactionClient;

export type AuditInput = {
  actor: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetTenantId?: string | null;
  before?: unknown;
  after?: unknown;
  reason: string;
  result?: 'success' | 'failure';
};

type Row = {
  seq: bigint;
  id: string;
  at: Date;
  actor_staff_id: string | null;
  actor_name: string | null;
  action: string;
  target_tenant_id: string | null;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  correlation_id: string | null;
  result: 'success' | 'failure';
};

const json = (value: unknown) =>
  value === undefined || value === null ? null : JSON.stringify(value);

@Injectable()
export class PlatformAuditService {
  constructor(
    private readonly platform: PlatformDatabase,
    private readonly cls: ClsService,
  ) {}

  /** Appends one entry inside `tx`, so the entry and the change commit together. */
  async write(tx: Tx, entry: AuditInput): Promise<void> {
    let correlation: string | null;
    try {
      correlation = this.cls.getId() ?? null;
    } catch {
      correlation = null; // outside a request (commands, tests)
    }
    await tx.$queryRaw`
      SELECT platform.append_audit(${uuidv7()}::uuid, ${entry.actor}::uuid, ${entry.action},
        ${entry.targetTenantId ?? null}::uuid, ${entry.targetType}, ${entry.targetId},
        ${json(entry.before)}::jsonb, ${json(entry.after)}::jsonb, ${entry.reason},
        ${correlation}, ${entry.result ?? 'success'})`;
  }

  async list(
    viewer: StaffContext,
    query: z.infer<typeof AuditQuerySchema>,
  ): Promise<{ data: AuditEntry[]; next_cursor: string | null }> {
    const rows = await this.rows(viewer, query, query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      data: page.map(toEntry),
      next_cursor: rows.length > query.limit ? String(page[page.length - 1]!.seq) : null,
    };
  }

  /** The export (Owner and Auditor): up to 10,000 entries as CSV. */
  async csv(viewer: StaffContext, query: z.infer<typeof AuditQuerySchema>): Promise<string> {
    const rows = await this.rows(viewer, query, 10_000);
    const header = [
      'seq',
      'at',
      'actor',
      'action',
      'target_type',
      'target_id',
      'target_tenant_id',
      'reason',
      'result',
      'before',
      'after',
      'correlation_id',
    ];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      // Quote everything; neutralise spreadsheet formulas (CSV injection).
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = rows.map((r) =>
      [
        r.seq.toString(),
        r.at.toISOString(),
        r.actor_name ?? r.actor_staff_id ?? 'system',
        r.action,
        r.target_type,
        r.target_id,
        r.target_tenant_id,
        r.reason,
        r.result,
        r.before,
        r.after,
        r.correlation_id,
      ]
        .map(cell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private async rows(
    viewer: StaffContext,
    q: z.infer<typeof AuditQuerySchema>,
    limit: number,
  ): Promise<Row[]> {
    const where: Prisma.Sql[] = [];
    // What this staff member may see (§3.2.1 last row).
    if (!viewer.permissions['audit.view']) {
      const scopes: Prisma.Sql[] = [];
      if (viewer.permissions['audit.view_own'])
        scopes.push(Prisma.sql`l.actor_staff_id = ${viewer.id}::uuid`);
      if (viewer.permissions['audit.view_billing'])
        scopes.push(Prisma.sql`l.action LIKE 'billing.%'`);
      if (viewer.permissions['audit.view_ops']) scopes.push(Prisma.sql`l.action LIKE 'ops.%'`);
      where.push(scopes.length ? Prisma.sql`(${Prisma.join(scopes, ' OR ')})` : Prisma.sql`false`);
    }
    if (q.cursor) where.push(Prisma.sql`l.seq < ${BigInt(q.cursor)}`);
    if (q.actor) where.push(Prisma.sql`l.actor_staff_id = ${q.actor}::uuid`);
    if (q.action)
      where.push(
        Prisma.sql`(l.action = ${q.action} OR l.action LIKE ${`${q.action.replace(/[%_\\]/g, '\\$&')}%`})`,
      );
    if (q.target_type) where.push(Prisma.sql`l.target_type = ${q.target_type}`);
    if (q.target_id) where.push(Prisma.sql`l.target_id = ${q.target_id}`);
    if (q.from) where.push(Prisma.sql`l.at >= ${new Date(q.from)}`);
    if (q.to) where.push(Prisma.sql`l.at < ${new Date(q.to)}`);
    const filter = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    return this.platform.db.$queryRaw<Row[]>`
      SELECT l.seq, l.id::text, l.at, l.actor_staff_id::text, s.name AS actor_name, l.action,
             l.target_tenant_id::text, l.target_type, l.target_id, l.before, l.after, l.reason,
             l.correlation_id, l.result
      FROM platform.platform_audit_log l
      LEFT JOIN platform.staff_users s ON s.id = l.actor_staff_id
      ${filter}
      ORDER BY l.seq DESC
      LIMIT ${limit}`;
  }
}

function toEntry(r: Row): AuditEntry {
  return {
    seq: r.seq.toString(),
    id: r.id,
    at: r.at.toISOString(),
    actor: r.actor_staff_id ? { id: r.actor_staff_id, name: r.actor_name ?? 'Unknown' } : null,
    action: r.action,
    target_tenant_id: r.target_tenant_id,
    target_type: r.target_type,
    target_id: r.target_id,
    before: r.before ?? null,
    after: r.after ?? null,
    reason: r.reason,
    correlation_id: r.correlation_id,
    result: r.result,
  };
}
