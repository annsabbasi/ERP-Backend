import { Injectable } from '@nestjs/common';
import { LIMIT_POLICIES, type LimitKey } from '@erp/contracts';
import { ProblemException } from '../../common/problem';
import { DatabaseService } from '../database/database.service';

// Limits the platform sets per company (Part 02 §2.11.1, Part 04 §4.23 rule 5). The limit in
// force: a manual override when there is one, otherwise the larger of the plan's and the
// template's value plus every add-on. Callers check before they create.

export type LimitRow = { value: bigint | number; source: string; valid_to: Date | null };

/** The limit in force from a tenant's rows, or null when none is set (unlimited). */
export function effectiveLimit(rows: readonly LimitRow[], now: Date): number | null {
  const live = rows.filter((r) => !r.valid_to || r.valid_to > now);
  const of = (source: string) =>
    live.filter((r) => r.source === source).map((r) => Number(r.value));
  const manual = of('manual');
  if (manual.length) return Math.max(...manual);
  const base = [...of('plan'), ...of('template')];
  const addons = of('addon').reduce((sum, v) => sum + v, 0);
  if (!base.length && !addons) return null;
  return (base.length ? Math.max(...base) : 0) + addons;
}

export type LimitCheck = { used: number; limit: number | null; warn: boolean };

const MESSAGES: Partial<Record<LimitKey, (used: number, limit: number) => string>> = {
  'users.max': (u, l) => `Seat limit reached (${u}/${l}). Ask your Owner to add seats.`,
  'branches.max': (u, l) => `Branch limit reached (${u}/${l}). Ask your Owner to request more.`,
};

@Injectable()
export class LimitsService {
  constructor(private readonly db: DatabaseService) {}

  async limitOf(key: LimitKey): Promise<number | null> {
    const rows = await this.db.tx.$queryRaw<LimitRow[]>`
      SELECT value, source, valid_to FROM platform.current_tenant_limits WHERE limit_key = ${key}`;
    return effectiveLimit(rows, new Date());
  }

  /** Usage of the limits this stage can count; modules pass their own count for the rest. */
  async usage(key: LimitKey): Promise<number> {
    const count = async (rows: Promise<{ n: number }[]>) => (await rows)[0]?.n ?? 0;
    switch (key) {
      case 'users.max': // seats: invited, active and suspended members (Part 04 §4.8.2)
        return count(this.db.tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.memberships
          WHERE kind IN ('member', 'device') AND status IN ('invited', 'active', 'suspended')`);
      case 'branches.max':
        return count(this.db.tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.branches WHERE status = 'active' AND archived_at IS NULL`);
      default:
        throw new Error(`No usage count for ${key}; pass { used }`);
    }
  }

  /**
   * Refuses with limit_reached (and the key, usage and limit) when adding would pass the limit,
   * or its grace; `warn` is true past the warning share.
   */
  async check(
    key: LimitKey,
    options: { adding?: number; used?: number } = {},
  ): Promise<LimitCheck> {
    const adding = options.adding ?? 1;
    // One after the other: both run on the request's transaction.
    const limit = await this.limitOf(key);
    const used = options.used ?? (await this.usage(key));
    if (limit === null) return { used, limit, warn: false };
    const policy = LIMIT_POLICIES[key] ?? {};
    if (used + adding > Math.floor(limit * (1 + (policy.grace ?? 0)))) {
      const message = MESSAGES[key]?.(used, limit) ?? `Limit reached for ${key} (${used}/${limit})`;
      throw new ProblemException('limit_reached', message, { limit: { key, used, limit } });
    }
    const warn = policy.warnAt !== undefined && used + adding >= limit * policy.warnAt;
    return { used, limit, warn };
  }
}
