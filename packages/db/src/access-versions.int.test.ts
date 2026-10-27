import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareTestDatabase } from './testing';
import { createTenantWithData, type TenantFixture } from './test-support/fixtures';

// The access token's pv (Part 10 §10.7.3) is the member's permissions_version plus the tenant's
// entitlements_version. Triggers move them on every write that can change access, whoever the
// writer is; these tests write as app_user (company admin work) and as the owner (console work)
// and watch the numbers. The views give app_user its own tenant's control-plane rows only.

let owner: pg.Client;
let app: pg.Client;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_access_versions');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  app = new pg.Client({ connectionString: db.appUrl });
  await Promise.all([owner.connect(), app.connect()]);
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
}, 120_000);

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
});

/** Runs statements as app_user inside tenant A, the way the API does. */
async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await work();
    await app.query('COMMIT');
    return result;
  } catch (error) {
    await app.query('ROLLBACK');
    throw error;
  }
}

async function pv(membershipId: string): Promise<number> {
  const { rows } = await owner.query(
    'SELECT permissions_version FROM app.memberships WHERE id = $1',
    [membershipId],
  );
  return rows[0].permissions_version as number;
}

async function ev(tenantId: string): Promise<number> {
  const { rows } = await owner.query(
    'SELECT entitlements_version FROM platform.tenants WHERE id = $1',
    [tenantId],
  );
  return rows[0].entitlements_version as number;
}

/** A second membership in tenant A with no roles, to show bumps stay with the right member. */
async function bystander(): Promise<string> {
  const id = uuidv7();
  await owner.query(
    `INSERT INTO app.memberships (id, tenant_id, kind, display_name, status) VALUES ($1, $2, 'member', 'Bystander', 'active')`,
    [id, a.tenantId],
  );
  return id;
}

describe('a member’s permissions version moves with their access', () => {
  it('when a grant is added to or removed from one of their roles', async () => {
    const other = await bystander();
    const [before, otherBefore] = [await pv(a.membershipId), await pv(other)];
    await asTenant(a.tenantId, () =>
      app.query(
        `INSERT INTO app.role_grants (tenant_id, role_id, permission_key, scope_type) VALUES ($1, $2, 'restaurant.tables.view', 'branch')`,
        [a.tenantId, a.roleId],
      ),
    );
    expect(await pv(a.membershipId)).toBe(before + 1);
    await asTenant(a.tenantId, () =>
      app.query(
        `DELETE FROM app.role_grants WHERE role_id = $1 AND permission_key = 'restaurant.tables.view'`,
        [a.roleId],
      ),
    );
    expect(await pv(a.membershipId)).toBe(before + 2);
    expect(await pv(other)).toBe(otherBefore);
  });

  it('when a grant’s scope or thresholds change', async () => {
    const before = await pv(a.membershipId);
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.role_grants SET scope_type = 'branch' WHERE role_id = $1`, [a.roleId]),
    );
    expect(await pv(a.membershipId)).toBe(before + 1);
  });

  it('when a role is given or taken away, and only for that member', async () => {
    const other = await bystander();
    const roleId = uuidv7();
    await owner.query(
      `INSERT INTO app.roles (id, tenant_id, key, name, origin) VALUES ($1, $2, 'host', 'Host', 'template')`,
      [roleId, a.tenantId],
    );
    const [before, otherBefore] = [await pv(a.membershipId), await pv(other)];
    await asTenant(a.tenantId, () =>
      app.query(
        `INSERT INTO app.membership_roles (tenant_id, membership_id, role_id, scope_values) VALUES ($1, $2, $3, '{}')`,
        [a.tenantId, a.membershipId, roleId],
      ),
    );
    expect(await pv(a.membershipId)).toBe(before + 1);
    await asTenant(a.tenantId, () =>
      app.query(
        `UPDATE app.membership_roles SET scope_values = '{"branch_ids":[]}' WHERE role_id = $1`,
        [roleId],
      ),
    );
    expect(await pv(a.membershipId)).toBe(before + 2);
    await asTenant(a.tenantId, () =>
      app.query(`DELETE FROM app.membership_roles WHERE role_id = $1`, [roleId]),
    );
    expect(await pv(a.membershipId)).toBe(before + 3);
    expect(await pv(other)).toBe(otherBefore);
  });

  it('when an exception is added or ends', async () => {
    const before = await pv(a.membershipId);
    const id = uuidv7();
    await asTenant(a.tenantId, () =>
      app.query(
        `INSERT INTO app.membership_exceptions (id, tenant_id, membership_id, permission_key, effect, expires_at, reason)
         VALUES ($1, $2, $3, 'restaurant.orders.void_request', 'deny', now() + interval '1 day', 'test')`,
        [id, a.tenantId, a.membershipId],
      ),
    );
    await asTenant(a.tenantId, () =>
      app.query(`DELETE FROM app.membership_exceptions WHERE id = $1`, [id]),
    );
    expect(await pv(a.membershipId)).toBe(before + 2);
  });

  it('when a role they hold is archived or restored, not for a new display name', async () => {
    const before = await pv(a.membershipId);
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.roles SET name = 'Senior waiter' WHERE id = $1`, [a.roleId]),
    );
    expect(await pv(a.membershipId)).toBe(before);
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.roles SET archived_at = now() WHERE id = $1`, [a.roleId]),
    );
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.roles SET archived_at = NULL WHERE id = $1`, [a.roleId]),
    );
    expect(await pv(a.membershipId)).toBe(before + 2);
  });

  it('when their branch, department or status changes, not for a new display name', async () => {
    const before = await pv(a.membershipId);
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.memberships SET display_name = 'Renamed' WHERE id = $1`, [
        a.membershipId,
      ]),
    );
    expect(await pv(a.membershipId)).toBe(before);
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.memberships SET department_id = NULL WHERE id = $1`, [a.membershipId]),
    );
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.memberships SET status = 'suspended' WHERE id = $1`, [a.membershipId]),
    );
    await asTenant(a.tenantId, () =>
      app.query(`UPDATE app.memberships SET status = 'active', department_id = $2 WHERE id = $1`, [
        a.membershipId,
        a.departmentId,
      ]),
    );
    expect(await pv(a.membershipId)).toBe(before + 3);
  });

  it('never reaches another tenant’s members: a write in A leaves B unchanged', async () => {
    const before = await pv(b.membershipId);
    await asTenant(a.tenantId, () =>
      app.query(
        `INSERT INTO app.role_grants (tenant_id, role_id, permission_key, scope_type) VALUES ($1, $2, 'restaurant.kds_tickets.view', 'branch')`,
        [a.tenantId, a.roleId],
      ),
    );
    expect(await pv(b.membershipId)).toBe(before);
  });
});

describe('a tenant’s entitlements version moves with its entitlements, limits and status', () => {
  it('when an entitlement is added, changed or removed', async () => {
    const before = await ev(a.tenantId);
    await owner.query(
      `INSERT INTO platform.tenant_entitlements (tenant_id, feature_key, state, source, changed_by)
       VALUES ($1, 'restaurant.floor', 'on', 'template', $2)`,
      [a.tenantId, uuidv7()],
    );
    await owner.query(
      `UPDATE platform.tenant_entitlements SET state = 'read_only' WHERE tenant_id = $1`,
      [a.tenantId],
    );
    await owner.query(`DELETE FROM platform.tenant_entitlements WHERE tenant_id = $1`, [
      a.tenantId,
    ]);
    expect(await ev(a.tenantId)).toBe(before + 3);
  });

  it('when a limit changes', async () => {
    const before = await ev(a.tenantId);
    await owner.query(
      `INSERT INTO platform.tenant_limits (tenant_id, limit_key, value, source, changed_by)
       VALUES ($1, 'users.max', 20, 'plan', $2)`,
      [a.tenantId, uuidv7()],
    );
    expect(await ev(a.tenantId)).toBe(before + 1);
  });

  it('when the status changes, not for a new display name', async () => {
    const before = await ev(a.tenantId);
    await owner.query(`UPDATE platform.tenants SET display_name = 'Renamed' WHERE id = $1`, [
      a.tenantId,
    ]);
    expect(await ev(a.tenantId)).toBe(before);
    await owner.query(`UPDATE platform.tenants SET status = 'past_due' WHERE id = $1`, [
      a.tenantId,
    ]);
    await owner.query(`UPDATE platform.tenants SET status = 'active' WHERE id = $1`, [a.tenantId]);
    expect(await ev(a.tenantId)).toBe(before + 2);
    expect(await ev(b.tenantId)).toBe(1);
  });
});

describe('app_user sees its own tenant’s control-plane rows through views only', () => {
  beforeAll(async () => {
    for (const t of [a, b]) {
      await owner.query(
        `INSERT INTO platform.tenant_entitlements (tenant_id, feature_key, state, source, changed_by)
         VALUES ($1, 'restaurant.menu', 'on', 'template', $2)`,
        [t.tenantId, uuidv7()],
      );
      await owner.query(
        `INSERT INTO platform.tenant_limits (tenant_id, limit_key, value, source, changed_by)
         VALUES ($1, 'branches.max', 2, 'plan', $2) ON CONFLICT DO NOTHING`,
        [t.tenantId, uuidv7()],
      );
    }
  });

  it('shows tenant A’s row, entitlements and limits inside A, and nothing of B', async () => {
    const seen = await asTenant(a.tenantId, async () => ({
      tenant: (await app.query('SELECT id, status FROM platform.current_tenant')).rows,
      features: (await app.query('SELECT feature_key FROM platform.current_tenant_entitlements'))
        .rows,
      limits: (await app.query('SELECT limit_key FROM platform.current_tenant_limits')).rows,
      other: (
        await app.query('SELECT count(*)::int AS n FROM platform.current_tenant WHERE id = $1', [
          b.tenantId,
        ])
      ).rows[0].n,
    }));
    expect(seen.tenant).toEqual([{ id: a.tenantId, status: 'active' }]);
    expect(seen.features).toEqual([{ feature_key: 'restaurant.menu' }]);
    expect(seen.limits.map((r) => r.limit_key)).toContain('branches.max');
    expect(seen.other).toBe(0);
  });

  it('shows nothing without a tenant in the transaction', async () => {
    for (const view of ['current_tenant', 'current_tenant_entitlements', 'current_tenant_limits']) {
      const { rows } = await app.query(`SELECT count(*)::int AS n FROM platform.${view}`);
      expect([view, rows[0].n]).toEqual([view, 0]);
    }
  });

  it('cannot write through the views', async () => {
    await expect(
      asTenant(a.tenantId, () => app.query(`UPDATE platform.current_tenant SET status = 'active'`)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot read the tables behind them, nor call the version helpers it does not need', async () => {
    await expect(app.query('SELECT 1 FROM platform.tenant_limits')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app.query('SELECT platform.bump_entitlements_version()')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('the sign-in lookup', () => {
  it('returns both pv parts and whether the person is the Owner', async () => {
    const userId = uuidv7();
    const email = `owner-${userId.slice(-6)}@example.com`;
    await owner.query(
      `INSERT INTO identity.users (id, email, email_normalized, name, status) VALUES ($1, $2, $2, 'Owner', 'active')`,
      [userId, email],
    );
    const membershipId = uuidv7();
    const ownerRole = uuidv7();
    await owner.query(
      `INSERT INTO app.memberships (id, tenant_id, user_id, kind, display_name, status) VALUES ($1, $2, $3, 'member', 'Owner', 'active')`,
      [membershipId, b.tenantId, userId],
    );
    await owner.query(
      `INSERT INTO app.roles (id, tenant_id, key, name, origin, is_protected) VALUES ($1, $2, 'owner', 'Owner', 'template', true)`,
      [ownerRole, b.tenantId],
    );
    const lookup = async () =>
      (
        await owner.query(
          'SELECT permissions_version, entitlements_version, is_owner FROM identity.memberships_of_user($1)',
          [userId],
        )
      ).rows[0];
    expect(await lookup()).toEqual({
      permissions_version: 1,
      entitlements_version: await ev(b.tenantId),
      is_owner: false,
    });
    await owner.query(
      `INSERT INTO app.membership_roles (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)`,
      [b.tenantId, membershipId, ownerRole],
    );
    expect(await lookup()).toMatchObject({ permissions_version: 2, is_owner: true });
  });
});
