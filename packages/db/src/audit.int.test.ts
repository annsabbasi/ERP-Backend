import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareTestDatabase, type TestDatabase } from './testing';
import { createTenantWithData, type TenantFixture } from './test-support/fixtures';

// Append-only audit logs and the platform audit hash chain (Part 03 §3.17, Part 04 §4.19,
// gap G12). Own database: the tamper test at the end breaks the chain on purpose.

let db: TestDatabase;
let owner: pg.Client;
let app: pg.Client;
let platform: pg.Client;
let tenant: TenantFixture;

async function append(client: pg.Client | pg.Pool, action: string): Promise<void> {
  await client.query(
    `SELECT platform.append_audit($1, $2, $3, $4, 'tenant', $5, '{"plan":"starter"}', '{"plan":"business"}', 'test', $6)`,
    [uuidv7(), uuidv7(), action, tenant.tenantId, tenant.tenantId, uuidv7()],
  );
}

async function verify(
  client: pg.Client,
): Promise<{ checked: number; first_broken_seq: string | null }> {
  const { rows } = await client.query('SELECT * FROM platform.verify_audit_chain()');
  return { checked: Number(rows[0].checked), first_broken_seq: rows[0].first_broken_seq };
}

beforeAll(async () => {
  db = await prepareTestDatabase('erp_test_audit');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  app = new pg.Client({ connectionString: db.appUrl });
  platform = new pg.Client({ connectionString: db.platformUrl });
  await owner.connect();
  await app.connect();
  await platform.connect();
  tenant = await createTenantWithData(owner, 'audit');
}, 120_000);

afterAll(async () => {
  await app?.end();
  await platform?.end();
  await owner?.end();
});

describe('platform audit log', () => {
  it('is written through append_audit by the console (app_platform), never directly', async () => {
    await append(platform, 'tenant.plan_changed');
    await expect(
      platform.query(
        `INSERT INTO platform.platform_audit_log (id, at, action, hash) VALUES ($1, now(), 'x', '\\x00')`,
        [uuidv7()],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses append_audit to tenant code (app_user), so it cannot pick a staff actor (F4)', async () => {
    await expect(append(app, 'tenant.forged')).rejects.toMatchObject({
      code: '42501',
      message: expect.stringMatching(/permission denied for function append_audit/),
    });
  });

  it('refuses UPDATE as app_user and app_platform', async () => {
    for (const client of [app, platform]) {
      await expect(
        client.query(`UPDATE platform.platform_audit_log SET reason = 'changed'`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('refuses UPDATE, DELETE and TRUNCATE even for the owner', async () => {
    await expect(
      owner.query(`UPDATE platform.platform_audit_log SET reason = 'changed'`),
    ).rejects.toThrow(/append-only/);
    await expect(owner.query('DELETE FROM platform.platform_audit_log')).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.query('TRUNCATE platform.platform_audit_log')).rejects.toThrow(
      /append-only/,
    );
  });

  it('keeps one unbroken chain after 100 parallel inserts', async () => {
    const before = await verify(owner);
    const pool = new pg.Pool({ connectionString: db.platformUrl, max: 20 });
    try {
      await Promise.all(Array.from({ length: 100 }, (_, i) => append(pool, `parallel.${i}`)));
    } finally {
      await pool.end();
    }
    const after = await verify(owner);
    expect(after).toEqual({ checked: before.checked + 100, first_broken_seq: null });
    const links = await owner.query<{ n: string }>(`
      SELECT count(*) AS n FROM platform.platform_audit_log l
      WHERE l.prev_hash IS NOT NULL
        AND l.prev_hash <> (SELECT p.hash FROM platform.platform_audit_log p WHERE p.seq < l.seq ORDER BY p.seq DESC LIMIT 1)`);
    expect(Number(links.rows[0]!.n)).toBe(0);
  });

  it('verify_audit_chain finds a tampered entry', async () => {
    const { rows } = await owner.query<{ seq: string }>(
      'SELECT seq FROM platform.platform_audit_log ORDER BY seq LIMIT 1 OFFSET 10',
    );
    const seq = rows[0]!.seq;
    // Only a superuser can switch the trigger off; this test database is thrown away.
    await owner.query('ALTER TABLE platform.platform_audit_log DISABLE TRIGGER append_only');
    await owner.query(
      `UPDATE platform.platform_audit_log SET reason = 'rewritten' WHERE seq = $1`,
      [seq],
    );
    await owner.query('ALTER TABLE platform.platform_audit_log ENABLE TRIGGER append_only');
    expect((await verify(owner)).first_broken_seq).toBe(seq);
  });
});

describe('company audit log (app.audit_log)', () => {
  it('lets app_user add entries for its tenant and refuses UPDATE and DELETE', async () => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.tenantId]);
      await app.query(
        `INSERT INTO app.audit_log (id, tenant_id, action, record_type) VALUES ($1, $2, 'role.updated', 'role')`,
        [uuidv7(), tenant.tenantId],
      );
      await expect(app.query(`UPDATE app.audit_log SET action = 'x'`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await app.query('ROLLBACK');
    }
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.tenantId]);
      await expect(app.query('DELETE FROM app.audit_log')).rejects.toThrow(/permission denied/);
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('refuses UPDATE, DELETE and TRUNCATE even for the owner', async () => {
    await expect(owner.query(`UPDATE app.audit_log SET action = 'x'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.query('DELETE FROM app.audit_log')).rejects.toThrow(/append-only/);
    await expect(owner.query('TRUNCATE app.audit_log')).rejects.toThrow(/append-only/);
  });
});
