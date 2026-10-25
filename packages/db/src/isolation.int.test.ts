import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_MODELS } from './tenant';
import { prepareTestDatabase, type TestDatabase } from './testing';
import { createTenantWithData, TENANT_TABLES, type TenantFixture } from './test-support/fixtures';

// Tenant isolation at the database level (Part 10 §10.5.5): as app_user, with RLS and no
// application code in between. Runs on its own database, rebuilt from the migrations.

const TABLES = Object.keys(TENANT_TABLES);
let db: TestDatabase;
let owner: pg.Client;
let app: pg.Client;
let a: TenantFixture;
let b: TenantFixture;

async function asTenant<T>(
  client: pg.Client,
  tenantId: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function count(client: pg.Client, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  // Supabase creates these roles; the migration must leave them without access (gap G9).
  const server = new pg.Client({
    connectionString:
      (process.env.TEST_PG_SERVER ?? 'postgresql://erp:erp@localhost:5433') + '/postgres',
  });
  await server.connect();
  for (const role of ['anon', 'authenticated']) {
    await server.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
    );
  }
  await server.end();

  db = await prepareTestDatabase('erp_test_db');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  app = new pg.Client({ connectionString: db.appUrl });
  await owner.connect();
  await app.connect();
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
}, 120_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
});

describe('schema: every tenant-owned table is protected', () => {
  it('app.* tables and identity.invitations have tenant_id, RLS enabled and forced, and the policy', async () => {
    const { rows } = await owner.query<{
      table: string;
      tenant_id: boolean;
      enabled: boolean;
      forced: boolean;
      policy: boolean;
    }>(`
      SELECT n.nspname || '.' || c.relname AS table,
             EXISTS (SELECT FROM information_schema.columns col
                     WHERE col.table_schema = n.nspname AND col.table_name = c.relname
                       AND col.column_name = 'tenant_id' AND col.is_nullable = 'NO') AS tenant_id,
             c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             EXISTS (SELECT FROM pg_policies p
                     WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                       AND p.policyname = 'tenant_isolation'
                       AND p.qual LIKE '%current_setting(''app.tenant_id''%'
                       AND p.with_check LIKE '%current_setting(''app.tenant_id''%') AS policy
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND (n.nspname = 'app' OR (n.nspname = 'identity' AND c.relname = 'invitations'))
      ORDER BY 1`);
    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows.filter((r) => !(r.tenant_id && r.enabled && r.forced && r.policy));
    expect(unprotected, 'tables missing tenant_id, RLS or the policy').toEqual([]);
    // The test data covers every one of them, so the checks below cover every table.
    expect(rows.map((r) => r.table).sort()).toEqual([...TABLES].sort());
  });

  it('the application layer scopes exactly the same tables (TENANT_MODELS)', () => {
    expect(new Set(Object.values(TENANT_TABLES))).toEqual(TENANT_MODELS);
  });

  it('no other app.* object can be added without the helper noticing', async () => {
    const secured = await count(owner, `SELECT platform.secure_tenant_tables() AS n`);
    expect(secured).toBe(TABLES.filter((t) => t.startsWith('app.')).length);
  });
});

describe('isolation as app_user', () => {
  it('sees no rows at all with no tenant set (SELECT count(*) FROM app.memberships = 0)', async () => {
    expect(await count(app, 'SELECT count(*) AS n FROM app.memberships')).toBe(0);
    for (const table of TABLES) {
      expect(await count(app, `SELECT count(*) AS n FROM ${table}`), table).toBe(0);
    }
  });

  it('sees no rows after a tenant transaction ended on the same connection (pooler reuse)', async () => {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
    await app.query('COMMIT');
    // app.tenant_id is now '' on this connection; the policy must read it as "no tenant".
    for (const table of TABLES) {
      expect(await count(app, `SELECT count(*) AS n FROM ${table}`), table).toBe(0);
    }
  });

  it('sees only its own tenant in every table', async () => {
    for (const [mine, other] of [
      [a, b],
      [b, a],
    ] as const) {
      await asTenant(app, mine.tenantId, async () => {
        for (const table of TABLES) {
          expect(await count(app, `SELECT count(*) AS n FROM ${table}`), table).toBeGreaterThan(0);
          expect(
            await count(app, `SELECT count(*) AS n FROM ${table} WHERE tenant_id <> $1`, [
              mine.tenantId,
            ]),
            table,
          ).toBe(0);
          expect(
            await count(app, `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [
              other.tenantId,
            ]),
            table,
          ).toBe(0);
        }
      });
    }
  });

  it('cannot read another tenant’s record by id (it does not exist for it)', async () => {
    await asTenant(app, a.tenantId, async () => {
      expect(
        await count(app, 'SELECT count(*) AS n FROM app.branches WHERE id = $1', [b.branchId]),
      ).toBe(0);
      expect(
        await count(app, 'SELECT count(*) AS n FROM app.memberships WHERE id = $1', [
          b.membershipId,
        ]),
      ).toBe(0);
    });
  });

  it('cannot change or delete another tenant’s rows', async () => {
    await asTenant(app, a.tenantId, async () => {
      const updated = await app.query(`UPDATE app.branches SET name = 'taken' WHERE id = $1`, [
        b.branchId,
      ]);
      expect(updated.rowCount).toBe(0);
      const deleted = await app.query('DELETE FROM app.settings WHERE tenant_id = $1', [
        b.tenantId,
      ]);
      expect(deleted.rowCount).toBe(0);
    });
    expect(
      await count(
        owner,
        `SELECT count(*) AS n FROM app.branches WHERE id = $1 AND name = 'taken'`,
        [b.branchId],
      ),
    ).toBe(0);
  });

  it('cannot write a row for another tenant (WITH CHECK)', async () => {
    await asTenant(app, a.tenantId, async () => {
      await expect(
        app.query(`INSERT INTO app.teams (id, tenant_id, name) VALUES ($1, $2, 'smuggled')`, [
          uuidv7(),
          b.tenantId,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
    await asTenant(app, a.tenantId, async () => {
      await expect(
        app.query(`UPDATE app.teams SET tenant_id = $1 WHERE tenant_id = $2`, [
          b.tenantId,
          a.tenantId,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('cannot reach the control plane, only the catalogue and flags', async () => {
    await expect(app.query('SELECT count(*) FROM platform.tenants')).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query('SELECT count(*) FROM platform.tenant_entitlements')).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query('SELECT count(*) FROM platform.platform_audit_log')).rejects.toThrow(
      /permission denied/,
    );
    expect(
      await count(app, 'SELECT count(*) AS n FROM platform.catalogue_modules'),
    ).toBeGreaterThanOrEqual(0);
    expect(
      await count(app, 'SELECT count(*) AS n FROM platform.feature_flags'),
    ).toBeGreaterThanOrEqual(0);
  });

  it('is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('pre-tenant lookup (ADR 0006)', () => {
  it('finds an invitation by token hash before any tenant is set, and nothing else', async () => {
    expect(await count(app, 'SELECT count(*) AS n FROM identity.invitations')).toBe(0);
    const { rows } = await app.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM identity.invitation_by_token_hash($1)',
      [b.invitationTokenHash],
    );
    expect(rows).toEqual([{ tenant_id: b.tenantId }]);
    const none = await app.query('SELECT * FROM identity.invitation_by_token_hash($1)', [
      '0'.repeat(64),
    ]);
    expect(none.rowCount).toBe(0);
  });
});

describe('Supabase roles (gap G9)', () => {
  it('anon and authenticated have no access to platform, identity or app', async () => {
    const { rows } = await owner.query<{ role: string; schema: string; usage: boolean }>(`
      SELECT r.role, s.schema, has_schema_privilege(r.role, s.schema, 'USAGE') AS usage
      FROM (VALUES ('anon'), ('authenticated')) r(role), (VALUES ('platform'), ('identity'), ('app')) s(schema)`);
    expect(rows.filter((r) => r.usage)).toEqual([]);
    const tables = await owner.query<{ n: string }>(`
      SELECT count(*) AS n FROM information_schema.role_table_grants
      WHERE grantee IN ('anon', 'authenticated', 'PUBLIC') AND table_schema IN ('platform', 'identity', 'app')`);
    expect(Number(tables.rows[0]!.n)).toBe(0);
  });
});
