import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareTestDatabase } from './testing';
import { createTenantWithData, type TenantFixture } from './test-support/fixtures';

// app_ops bypasses RLS, so it may hold only what today's cross-tenant work uses (QA finding
// F2): the outbox dispatch, and the tables behind the SECURITY DEFINER functions it owns.
// A stage that adds a job adds its grants and updates EXPECTED here.

const EXPECTED = [
  'app.outbox SELECT',
  'app.outbox UPDATE (attempts)',
  'app.outbox UPDATE (dispatched_at)',
  'identity.invitations SELECT',
  'platform.platform_audit_log INSERT',
  'platform.platform_audit_log SELECT',
];

let owner: pg.Client;
let ops: pg.Client;
let app: pg.Client;
let a: TenantFixture;

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_ops');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  ops = new pg.Client({ connectionString: db.opsUrl });
  app = new pg.Client({ connectionString: db.appUrl });
  await Promise.all([owner.connect(), ops.connect(), app.connect()]);
  a = await createTenantWithData(owner, 'alpha');
}, 120_000);

afterAll(async () => {
  await Promise.all([owner?.end(), ops?.end(), app?.end()]);
});

describe('app_ops privileges', () => {
  it('holds exactly the grants of the current jobs', async () => {
    const { rows } = await owner.query<{ grant: string }>(
      `SELECT table_schema || '.' || table_name || ' ' || privilege_type AS grant
       FROM information_schema.role_table_grants
       WHERE grantee = 'app_ops' AND table_schema IN ('platform', 'identity', 'app')
       UNION
       SELECT table_schema || '.' || table_name || ' ' || privilege_type || ' (' || column_name || ')'
       FROM information_schema.column_privileges
       WHERE grantee = 'app_ops' AND table_schema IN ('platform', 'identity', 'app')
         AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants t
                         WHERE t.grantee = 'app_ops' AND t.table_schema = column_privileges.table_schema
                           AND t.table_name = column_privileges.table_name
                           AND t.privilege_type = column_privileges.privilege_type)
       ORDER BY 1`,
    );
    expect(rows.map((r) => r.grant)).toEqual(EXPECTED);
  });

  it.each([
    'SELECT * FROM identity.credentials',
    'SELECT * FROM identity.users',
    'SELECT * FROM platform._prisma_migrations',
    'SELECT * FROM platform.tenants',
    'SELECT * FROM app.memberships',
    'DELETE FROM app.outbox',
    "UPDATE app.outbox SET payload = '{}'",
    "UPDATE platform.platform_audit_log SET reason = 'x'",
  ])('is refused: %s', async (sql) => {
    await expect(ops.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  it('still runs the outbox dispatch across tenants', async () => {
    await ops.query('BEGIN');
    try {
      const { rows } = await ops.query<{ id: string }>(
        `SELECT id FROM app.outbox WHERE dispatched_at IS NULL ORDER BY occurred_at, id
         LIMIT 10 FOR UPDATE SKIP LOCKED`,
      );
      expect(rows.length).toBeGreaterThan(0);
      const updated = await ops.query(
        `UPDATE app.outbox SET dispatched_at = now(), attempts = attempts + 1 WHERE id = ANY ($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
      expect(updated.rowCount).toBe(rows.length);
    } finally {
      await ops.query('ROLLBACK');
    }
  });

  it('still owns working audit and invitation functions', async () => {
    const seq = await app.query(
      `SELECT platform.append_audit($1, $2, 'tenant.checked', $3, 'tenant', $4, NULL, NULL, 'test', 'corr-ops-0001')`,
      [uuidv7(), uuidv7(), a.tenantId, a.tenantId],
    );
    expect(Number(seq.rows[0].append_audit)).toBeGreaterThan(0);
    const chain = await app.query('SELECT * FROM platform.verify_audit_chain()');
    expect(chain.rows[0]).toMatchObject({ first_broken_seq: null });
    const found = await app.query('SELECT tenant_id FROM identity.invitation_by_token_hash($1)', [
      a.invitationTokenHash,
    ]);
    expect(found.rows).toEqual([{ tenant_id: a.tenantId }]);
  });

  it('gets nothing on tenant tables added by later migrations', async () => {
    await owner.query('CREATE TABLE app.ops_probe (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)');
    try {
      await owner.query('SELECT platform.secure_tenant_tables()');
      await expect(ops.query('SELECT * FROM app.ops_probe')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(app.query('SELECT * FROM app.ops_probe')).resolves.toBeDefined();
    } finally {
      await owner.query('DROP TABLE app.ops_probe');
    }
  });
});
