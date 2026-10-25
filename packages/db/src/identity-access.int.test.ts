import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareTestDatabase } from './testing';
import { createTenantWithData, type TenantFixture } from './test-support/fixtures';
import { grantsOf } from './test-support/grants';

// Who may touch sign-in secrets (QA finding F3, ADR 0008): only app_auth, the auth module's
// role. app_user, the role of every tenant request, sees nothing of identity but tenant-owned
// invitations; app_auth sees no tenant data and finds a person's companies through a lookup.

const SECRETS = [
  'identity.credentials',
  'identity.mfa_factors',
  'identity.recovery_codes',
  'identity.password_resets',
  'identity.refresh_tokens',
  'identity.sessions',
  'identity.email_changes',
  'identity.login_attempts',
  'identity.users',
  'platform.staff_users',
  'platform.staff_credentials',
  'platform.staff_mfa_factors',
  'platform.staff_recovery_codes',
  'platform.staff_sessions',
  'platform.staff_refresh_tokens',
  'platform.staff_setup_tokens',
  'platform.staff_login_attempts',
];

const AUTH_GRANTS = [
  'identity.credentials INSERT',
  'identity.credentials SELECT',
  'identity.credentials UPDATE',
  'identity.email_changes INSERT',
  'identity.email_changes SELECT',
  'identity.email_changes UPDATE',
  'identity.login_attempts INSERT',
  'identity.login_attempts SELECT',
  'identity.mfa_factors DELETE',
  'identity.mfa_factors INSERT',
  'identity.mfa_factors SELECT',
  'identity.mfa_factors UPDATE',
  'identity.password_resets INSERT',
  'identity.password_resets SELECT',
  'identity.password_resets UPDATE',
  'identity.recovery_codes DELETE',
  'identity.recovery_codes INSERT',
  'identity.recovery_codes SELECT',
  'identity.recovery_codes UPDATE',
  'identity.refresh_tokens INSERT',
  'identity.refresh_tokens SELECT',
  'identity.refresh_tokens UPDATE',
  'identity.sessions INSERT',
  'identity.sessions SELECT',
  'identity.sessions UPDATE',
  'identity.users SELECT',
  'identity.users UPDATE',
  'platform.staff_credentials INSERT',
  'platform.staff_credentials SELECT',
  'platform.staff_credentials UPDATE',
  'platform.staff_login_attempts INSERT',
  'platform.staff_login_attempts SELECT',
  'platform.staff_mfa_factors DELETE',
  'platform.staff_mfa_factors INSERT',
  'platform.staff_mfa_factors SELECT',
  'platform.staff_mfa_factors UPDATE',
  'platform.staff_recovery_codes DELETE',
  'platform.staff_recovery_codes INSERT',
  'platform.staff_recovery_codes SELECT',
  'platform.staff_recovery_codes UPDATE',
  'platform.staff_refresh_tokens INSERT',
  'platform.staff_refresh_tokens SELECT',
  'platform.staff_refresh_tokens UPDATE',
  'platform.staff_role_assignments SELECT',
  'platform.staff_roles SELECT',
  'platform.staff_sessions INSERT',
  'platform.staff_sessions SELECT',
  'platform.staff_sessions UPDATE',
  'platform.staff_setup_tokens INSERT',
  'platform.staff_setup_tokens SELECT',
  'platform.staff_setup_tokens UPDATE',
  'platform.staff_users SELECT',
  'platform.staff_users UPDATE (last_sign_in_at, status, updated_at)',
];

let owner: pg.Client;
let app: pg.Client;
let auth: pg.Client;
let a: TenantFixture;
let b: TenantFixture;
const userId = uuidv7();

async function asTenant(client: pg.Client, tenantId: string, sql: string, params: unknown[] = []) {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return await client.query(sql, params);
  } finally {
    await client.query('ROLLBACK');
  }
}

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_identity');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  app = new pg.Client({ connectionString: db.appUrl });
  auth = new pg.Client({ connectionString: db.authUrl });
  await Promise.all([owner.connect(), app.connect(), auth.connect()]);
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
  // One person who works for both companies; alpha makes them Owner.
  await owner.query(
    `INSERT INTO identity.users (id, email, email_normalized, name) VALUES ($1, 'sana@example.com', 'sana@example.com', 'Sana')`,
    [userId],
  );
  await owner.query('UPDATE app.memberships SET user_id = $1, kind = $2 WHERE id = ANY ($3)', [
    userId,
    'member',
    [a.membershipId, b.membershipId],
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end(), auth?.end()]);
});

describe('app_user (every tenant request)', () => {
  it.each(SECRETS)('is refused %s', async (table) => {
    await expect(asTenant(app, a.tenantId, `SELECT * FROM ${table} LIMIT 1`)).rejects.toMatchObject(
      {
        code: '42501',
      },
    );
  });

  it('keeps its tenant’s invitations, under RLS', async () => {
    const { rows } = await asTenant(app, a.tenantId, 'SELECT tenant_id FROM identity.invitations');
    expect(rows).toEqual([{ tenant_id: a.tenantId }]);
  });

  it('cannot run the sign-in lookups', async () => {
    await expect(
      app.query('SELECT * FROM identity.memberships_of_user($1)', [userId]),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('app_auth (the auth module)', () => {
  it('holds exactly the grants of sign-in', async () => {
    expect(await grantsOf(owner, 'app_auth')).toEqual(AUTH_GRANTS);
  });

  it.each([
    'SELECT * FROM app.memberships',
    'SELECT * FROM app.roles',
    'SELECT * FROM identity.invitations',
    'SELECT * FROM platform.tenants',
    'SELECT * FROM platform._prisma_migrations',
    'SELECT * FROM platform.platform_audit_log',
    "INSERT INTO platform.staff_users (id, email, email_normalized, name) VALUES (gen_random_uuid(), 'x@example.com', 'x@example.com', 'X')",
    "INSERT INTO platform.staff_role_assignments (staff_user_id, role_key) VALUES (gen_random_uuid(), 'platform_owner')",
    "UPDATE platform.staff_users SET email = 'x@example.com'",
    'DELETE FROM identity.users',
  ])('is refused: %s', async (sql) => {
    await expect(auth.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot bypass RLS', async () => {
    const { rows } = await auth.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_auth'`,
    );
    expect(rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
  });

  it('finds the person’s companies before any tenant is set, and nobody else’s', async () => {
    const { rows } = await auth.query(
      'SELECT tenant_id, membership_id, status FROM identity.memberships_of_user($1) ORDER BY tenant_id',
      [userId],
    );
    expect(rows.map((r) => r.membership_id).sort()).toEqual(
      [a.membershipId, b.membershipId].sort(),
    );
    const none = await auth.query('SELECT * FROM identity.memberships_of_user($1)', [uuidv7()]);
    expect(none.rows).toEqual([]);
  });

  it('knows when a company requires MFA (gap G16)', async () => {
    const required = () =>
      auth
        .query('SELECT identity.mfa_required_by_company($1) AS r', [userId])
        .then((x) => x.rows[0].r as boolean);
    // The fixture role is a plain waiter role: no requirement yet.
    expect(await required()).toBe(false);

    await owner.query(
      `INSERT INTO app.settings (id, tenant_id, scope_type, scope_id, module_key, key, value)
       VALUES ($1, $2, 'company', $2, 'core', 'security.mfa_required', 'true')`,
      [uuidv7(), b.tenantId],
    );
    expect(await required()).toBe(true);
    await owner.query(`DELETE FROM app.settings WHERE key = 'security.mfa_required'`);

    await owner.query('UPDATE app.roles SET is_protected = true WHERE id = $1', [a.roleId]);
    expect(await required()).toBe(true);
    await owner.query('UPDATE app.memberships SET status = $1 WHERE id = $2', [
      'deactivated',
      a.membershipId,
    ]);
    expect(await required()).toBe(false); // only active memberships count
  });
});
