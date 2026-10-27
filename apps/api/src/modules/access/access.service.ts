import { Injectable } from '@nestjs/common';
import type { TenantStatus } from '@erp/contracts';
import { withTenant, type TenantTransaction } from '@erp/db';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { computeAccess, type MemberAccess } from './compute-access';

// Loads a member's access and caches it (Part 10 §10.7.3). Two layers:
//
// - The stamp: membership status, tenant status, Owner or not, and the two versions. Read on
//   every company request, cached 15 seconds, so a removed permission, a suspended member or a
//   suspended company is refused within 15 seconds whatever the token says (AC-U07: 60).
// - The access itself, cached under (tenant, membership, pv, status) for at most a minute, and
//   no longer than until an entitlement, trial or exception ends.

const ACCESS_SECONDS = 60;
const stampSeconds = () => Number(process.env.ACCESS_STAMP_SECONDS ?? 15);

export type AccessStamp = {
  membershipStatus: string;
  tenantStatus: TenantStatus;
  tenantCode: string;
  isOwner: boolean;
  permissionsVersion: number;
  entitlementsVersion: number;
  /** The access version: what the token's pv should be. */
  pv: number;
};

type StampRow = {
  status: string;
  permissions_version: number;
  tenant_code: string;
  tenant_status: string;
  entitlements_version: number;
  is_owner: boolean;
};

@Injectable()
export class AccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async stamp(tenantId: string, membershipId: string): Promise<AccessStamp | null> {
    const key = this.stampKey(tenantId, membershipId);
    const cached = await this.redis.client.get(key);
    if (cached) return JSON.parse(cached) as AccessStamp | null;
    const stamp = await withTenant(this.db.client, tenantId, (tx) =>
      this.readStamp(tx, membershipId),
    );
    await this.redis.client.set(key, JSON.stringify(stamp), 'EX', stampSeconds());
    return stamp;
  }

  async access(tenantId: string, membershipId: string, stamp: AccessStamp): Promise<MemberAccess> {
    const key = this.redis.key(
      'access',
      'member',
      tenantId,
      membershipId,
      `${stamp.pv}`,
      stamp.tenantStatus,
    );
    const cached = await this.redis.client.get(key);
    if (cached) return JSON.parse(cached) as MemberAccess;
    const access = await withTenant(this.db.client, tenantId, (tx) =>
      this.compute(tx, tenantId, membershipId, stamp),
    );
    const untilChange = access.validUntil
      ? Math.ceil((Date.parse(access.validUntil) - Date.now()) / 1000)
      : ACCESS_SECONDS;
    await this.redis.client.set(
      key,
      JSON.stringify(access),
      'EX',
      Math.max(1, Math.min(ACCESS_SECONDS, untilChange)),
    );
    return access;
  }

  /** Forget a member's stamp at once, for writes that should not wait 15 seconds. */
  async forget(tenantId: string, membershipId: string): Promise<void> {
    await this.redis.client.del(this.stampKey(tenantId, membershipId));
  }

  private stampKey(tenantId: string, membershipId: string): string {
    return this.redis.key('access', 'stamp', tenantId, membershipId);
  }

  private async readStamp(
    tx: TenantTransaction,
    membershipId: string,
  ): Promise<AccessStamp | null> {
    const [row] = await tx.$queryRaw<StampRow[]>`
      SELECT m.status, m.permissions_version, t.code AS tenant_code, t.status AS tenant_status,
             t.entitlements_version,
             EXISTS (SELECT 1 FROM app.membership_roles mr
                     JOIN app.roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
                     WHERE mr.tenant_id = m.tenant_id AND mr.membership_id = m.id
                       AND r.key = 'owner' AND r.is_protected AND r.archived_at IS NULL) AS is_owner
      FROM app.memberships m CROSS JOIN platform.current_tenant t
      WHERE m.id = ${membershipId}::uuid`;
    if (!row) return null;
    return {
      membershipStatus: row.status,
      tenantStatus: row.tenant_status as TenantStatus,
      tenantCode: row.tenant_code,
      isOwner: row.is_owner,
      permissionsVersion: row.permissions_version,
      entitlementsVersion: row.entitlements_version,
      pv: row.permissions_version + row.entitlements_version,
    };
  }

  private async compute(
    tx: TenantTransaction,
    tenantId: string,
    membershipId: string,
    stamp: AccessStamp,
  ): Promise<MemberAccess> {
    const [membership] = await tx.$queryRaw<
      {
        primary_branch_id: string | null;
        department_id: string | null;
        legal_entity_id: string | null;
      }[]
    >`
      SELECT m.primary_branch_id::text, m.department_id::text, b.legal_entity_id::text
      FROM app.memberships m
      LEFT JOIN app.branches b ON b.tenant_id = m.tenant_id AND b.id = m.primary_branch_id
      WHERE m.id = ${membershipId}::uuid`;
    const entitlements = await tx.$queryRaw<
      {
        feature_key: string;
        state: string;
        source: string;
        valid_from: Date;
        valid_to: Date | null;
      }[]
    >`SELECT feature_key, state, source, valid_from, valid_to FROM platform.current_tenant_entitlements`;
    const roleGrants = await tx.$queryRaw<
      {
        permission_key: string;
        scope_type: string;
        thresholds: Record<string, unknown>;
        scope_values: Record<string, unknown>;
      }[]
    >`
      SELECT g.permission_key, g.scope_type, g.thresholds, mr.scope_values
      FROM app.membership_roles mr
      JOIN app.roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id AND r.archived_at IS NULL
      JOIN app.role_grants g ON g.tenant_id = r.tenant_id AND g.role_id = r.id
      WHERE mr.membership_id = ${membershipId}::uuid`;
    const exceptions = await tx.$queryRaw<
      {
        permission_key: string;
        effect: string;
        scope_type: string | null;
        scope_values: Record<string, unknown>;
        expires_at: Date;
      }[]
    >`
      SELECT permission_key, effect, scope_type, scope_values, expires_at
      FROM app.membership_exceptions
      WHERE membership_id = ${membershipId}::uuid AND expires_at > now()`;
    const departments = await tx.$queryRaw<{ id: string; parent_id: string | null }[]>`
      SELECT id::text, parent_id::text FROM app.departments`;
    const led = await tx.$queryRaw<{ membership_id: string }[]>`
      SELECT DISTINCT tm.membership_id::text
      FROM app.teams t JOIN app.team_members tm ON tm.tenant_id = t.tenant_id AND tm.team_id = t.id
      WHERE t.lead_membership_id = ${membershipId}::uuid`;

    return computeAccess({
      now: new Date(),
      tenant: {
        id: tenantId,
        code: stamp.tenantCode,
        status: stamp.tenantStatus,
        entitlementsVersion: stamp.entitlementsVersion,
      },
      membership: {
        id: membershipId,
        permissionsVersion: stamp.permissionsVersion,
        primaryBranchId: membership?.primary_branch_id ?? null,
        departmentId: membership?.department_id ?? null,
        primaryLegalEntityId: membership?.legal_entity_id ?? null,
      },
      isOwner: stamp.isOwner,
      entitlements: entitlements.map((e) => ({
        featureKey: e.feature_key,
        state: e.state,
        source: e.source,
        validFrom: e.valid_from,
        validTo: e.valid_to,
      })),
      roleGrants: roleGrants.map((g) => ({
        permissionKey: g.permission_key,
        scopeType: g.scope_type,
        thresholds: g.thresholds,
        scopeValues: g.scope_values,
      })),
      exceptions: exceptions.map((e) => ({
        permissionKey: e.permission_key,
        effect: e.effect,
        scopeType: e.scope_type,
        scopeValues: e.scope_values,
        expiresAt: e.expires_at,
      })),
      departments: departments.map((d) => ({ id: d.id, parentId: d.parent_id })),
      ledTeamMemberIds: led.map((l) => l.membership_id),
    });
  }
}
