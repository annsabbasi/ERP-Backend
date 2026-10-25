import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareTestDatabase } from './testing';
import { createTenantWithData, TENANT_TABLES, type TenantFixture } from './test-support/fixtures';

// References between tenant rows (QA finding F1, Part 10 §10.5.3): a row may only point at a
// row of its own tenant, the database must say so in the same words whether the other row
// belongs to another tenant or does not exist, and no tenant's delete may touch another
// tenant's rows. Checked as app_user, under RLS, on a database built from the migrations.

/** Columns that hold an id without a foreign key, and why. Anything else needs one. */
const WITHOUT_FK: Readonly<Record<string, string>> = {
  'app.audit_log.actor_membership_id': 'append-only history: it must outlive the membership',
  'app.audit_log.actor_staff_id': 'append-only history; staff live in the control plane',
  'app.audit_log.device_id': 'append-only history; devices arrive in Stage 9',
  'app.audit_log.support_grant_id': 'append-only history; support grants arrive in Stage 9',
  'app.audit_log.record_id': 'polymorphic: any record type',
  'app.audit_log.correlation_id': 'a request id, not a reference',
  'app.outbox.aggregate_id': 'polymorphic: any aggregate type',
  'app.processed_events.event_id': 'outbox rows are pruned after dispatch',
  'app.settings.scope_id': 'polymorphic: company, legal entity, branch or user scope',
  'app.memberships.employee_id': 'the People module adds its table and the FK',
};

/** Every optional or required reference from one tenant row to another. */
const REFERENCES = [
  {
    table: 'app.memberships',
    column: 'primary_branch_id',
    target: 'app.branches',
    row: 'membershipId',
  },
  {
    table: 'app.memberships',
    column: 'department_id',
    target: 'app.departments',
    row: 'membershipId',
  },
  { table: 'app.departments', column: 'parent_id', target: 'app.departments', row: 'departmentId' },
  {
    table: 'app.departments',
    column: 'head_membership_id',
    target: 'app.memberships',
    row: 'departmentId',
  },
  { table: 'app.positions', column: 'department_id', target: 'app.departments', row: 'positionId' },
  {
    table: 'app.positions',
    column: 'reports_to_position_id',
    target: 'app.positions',
    row: 'positionId',
  },
  {
    table: 'app.branches',
    column: 'manager_membership_id',
    target: 'app.memberships',
    row: 'branchId',
  },
  { table: 'app.teams', column: 'lead_membership_id', target: 'app.memberships', row: 'teamId' },
  {
    table: 'identity.invitations',
    column: 'membership_id',
    target: 'app.memberships',
    row: 'invitationId',
  },
] as const satisfies readonly { row: keyof TenantFixture; [k: string]: string }[];

let owner: pg.Client;
let app: pg.Client;
let a: TenantFixture;
let b: TenantFixture;

/** Runs one statement as app_user inside a tenant, in its own transaction. */
async function asTenant(tenantId: string, sql: string, params: unknown[] = []) {
  await app.query('BEGIN');
  try {
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await app.query(sql, params);
    await app.query('COMMIT');
    return result;
  } catch (error) {
    await app.query('ROLLBACK');
    throw error;
  }
}

/** The error a statement raises, with ids blanked so two errors can be compared. */
async function failure(tenantId: string, sql: string, params: unknown[]) {
  const error = await asTenant(tenantId, sql, params).then(
    () => undefined,
    (e: pg.DatabaseError) => e,
  );
  if (!error) throw new Error(`expected an error from: ${sql}`);
  const blank = (s?: string) => s?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>');
  return {
    code: error.code,
    constraint: error.constraint,
    message: blank(error.message),
    detail: blank(error.detail),
  };
}

/** A new row in `target` for a tenant, referenced by nothing, so it can be deleted. */
async function freshTarget(target: string, f: TenantFixture): Promise<string> {
  const id = uuidv7();
  const code = `X${id.slice(-8).toUpperCase()}`;
  const insert: Record<string, [string, unknown[]]> = {
    'app.branches': [
      `INSERT INTO app.branches (id, tenant_id, legal_entity_id, name, code, type) VALUES ($1, $2, $3, 'Spare', $4, 'outlet')`,
      [id, f.tenantId, f.legalEntityId, code],
    ],
    'app.departments': [
      `INSERT INTO app.departments (id, tenant_id, name, code) VALUES ($1, $2, 'Spare', $3)`,
      [id, f.tenantId, code],
    ],
    'app.memberships': [
      `INSERT INTO app.memberships (id, tenant_id, kind, display_name, status) VALUES ($1, $2, 'device', 'Spare', 'active')`,
      [id, f.tenantId],
    ],
    'app.positions': [
      `INSERT INTO app.positions (id, tenant_id, title) VALUES ($1, $2, 'Spare')`,
      [id, f.tenantId],
    ],
  };
  const [sql, params] = insert[target]!;
  await owner.query(sql, params);
  return id;
}

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_references');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  app = new pg.Client({ connectionString: db.appUrl });
  await Promise.all([owner.connect(), app.connect()]);
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
}, 120_000);

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
});

describe('schema: references stay inside the tenant', () => {
  it('every foreign key between tenant tables includes tenant_id on both sides', async () => {
    const tables = Object.keys(TENANT_TABLES);
    const { rows } = await owner.query<{ name: string; from_ok: boolean; to_ok: boolean }>(
      `SELECT c.conname AS name,
              (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'tenant_id') = ANY (c.conkey) AS from_ok,
              (SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'tenant_id') = ANY (c.confkey) AS to_ok
       FROM pg_constraint c
       WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1) AND c.confrelid::regclass::text = ANY ($1)`,
      [tables],
    );
    expect(rows.length).toBeGreaterThanOrEqual(REFERENCES.length);
    expect(rows.filter((r) => !r.from_ok || !r.to_ok).map((r) => r.name)).toEqual([]);
  });

  it('every *_id column of a tenant table has a foreign key, unless listed with a reason', async () => {
    const { rows } = await owner.query<{ col: string }>(
      `SELECT c.oid::regclass::text || '.' || a.attname AS col
       FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.oid::regclass::text = ANY ($1) AND a.attname LIKE '%\\_id' AND a.attname <> 'tenant_id'
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                         WHERE k.contype = 'f' AND k.conrelid = c.oid AND a.attnum = ANY (k.conkey))
       ORDER BY 1`,
      [Object.keys(TENANT_TABLES)],
    );
    // A column dropped from the list must also leave WITHOUT_FK, so the list stays true.
    expect(rows.map((r) => r.col)).toEqual(Object.keys(WITHOUT_FK).sort());
  });
});

describe.each(REFERENCES)('$table ($column) → $target', ({ table, column, target, row }) => {
  const update = `UPDATE ${table} SET ${column} = $2 WHERE id = $1`;

  it('refuses another tenant’s row with the same error as a row that does not exist', async () => {
    const theirs = await failure(a.tenantId, update, [a[row], await freshTarget(target, b)]);
    const missing = await failure(a.tenantId, update, [a[row], uuidv7()]);
    expect(theirs.code).toBe('23503');
    expect(theirs).toEqual(missing);
  });

  it('never changes when another tenant deletes the row it tried to point at', async () => {
    const mine = await freshTarget(target, a);
    await asTenant(a.tenantId, update, [a[row], mine]);
    // The QA probe: point at the other tenant's row (refused now), then that tenant deletes it.
    const theirs = await freshTarget(target, b);
    await asTenant(a.tenantId, update, [a[row], theirs]).catch(() => undefined);
    const deleted = await asTenant(b.tenantId, `DELETE FROM ${target} WHERE id = $1`, [theirs]);
    expect(deleted.rowCount).toBe(1);
    const { rows } = await owner.query(`SELECT ${column} AS ref FROM ${table} WHERE id = $1`, [
      a[row],
    ]);
    expect(rows[0].ref).toBe(mine);
  });

  it('clears or removes only its own tenant’s rows when the target is deleted', async () => {
    const mine = await freshTarget(target, a);
    const source = table === 'identity.invitations' ? await spareInvitation(mine) : a[row];
    if (table !== 'identity.invitations') await asTenant(a.tenantId, update, [source, mine]);
    await asTenant(a.tenantId, `DELETE FROM ${target} WHERE id = $1`, [mine]);
    const { rows } = await owner.query(
      `SELECT tenant_id, ${column} AS ref FROM ${table} WHERE id = $1`,
      [source],
    );
    if (table === 'identity.invitations') {
      expect(rows).toEqual([]); // ON DELETE CASCADE: the invitation goes with its membership
    } else {
      expect(rows).toEqual([{ tenant_id: a.tenantId, ref: null }]); // SET NULL (column) only
    }
  });
});

/** An invitation of tenant A for a membership, so that deleting the membership is safe. */
async function spareInvitation(membershipId: string): Promise<string> {
  const id = uuidv7();
  await owner.query(
    `INSERT INTO identity.invitations (id, tenant_id, membership_id, email, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, 'spare@example.com', 'member', $4, now() + interval '1 day')`,
    [id, a.tenantId, membershipId, `spare-${id}`.padEnd(64, '0').slice(0, 64)],
  );
  return id;
}

describe('app.memberships.user_id → identity.users', () => {
  it('refuses a user that does not exist and accepts one that does', async () => {
    const update = `UPDATE app.memberships SET user_id = $2 WHERE id = $1`;
    const missing = await failure(a.tenantId, update, [a.membershipId, uuidv7()]);
    expect(missing).toMatchObject({ code: '23503', constraint: 'memberships_user_id_fkey' });

    const userId = uuidv7();
    await owner.query(
      `INSERT INTO identity.users (id, email, email_normalized, name) VALUES ($1, $2, $2, 'Spare')`,
      [userId, `${userId}@example.com`],
    );
    await asTenant(a.tenantId, update, [a.membershipId, userId]);
    await expect(
      owner.query('DELETE FROM identity.users WHERE id = $1', [userId]),
    ).rejects.toMatchObject({
      code: '23503',
    });
  });
});
