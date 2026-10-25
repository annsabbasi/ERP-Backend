import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import {
  extendForTenants,
  TenantContextMissingError,
  TenantMismatchError,
  withTenant,
  type TenantClient,
} from './tenant';
import { prepareTestDatabase, type TestDatabase } from './testing';
import { createTenantWithData, type TenantFixture } from './test-support/fixtures';

// Tenant isolation in the application layer (Part 10 §10.5.3, layer 1), on top of RLS:
// the Prisma extension as the API uses it, connected as app_user.

let db: TestDatabase;
let owner: pg.Client;
let client: TenantClient;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await prepareTestDatabase('erp_test_tenant');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
  client = extendForTenants(createPrismaClient(db.appUrl, { max: 4 }));
}, 120_000);

afterAll(async () => {
  await client?.$disconnect();
  await owner?.end();
});

describe('isolation through the Prisma tenant extension', () => {
  it('lists only the current tenant’s records', async () => {
    const branches = await withTenant(client, a.tenantId, (tx) => tx.branch.findMany());
    expect(branches.map((x) => x.tenantId)).toEqual([a.tenantId]);
    const members = await withTenant(client, b.tenantId, (tx) => tx.membership.findMany());
    expect(members.map((x) => x.id)).toEqual([b.membershipId]);
  });

  it('treats another tenant’s record as not found', async () => {
    const found = await withTenant(client, a.tenantId, (tx) =>
      tx.branch.findUnique({ where: { id: b.branchId } }),
    );
    expect(found).toBeNull();
    await expect(
      withTenant(client, a.tenantId, (tx) =>
        tx.branch.update({ where: { id: b.branchId }, data: { name: 'taken' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });
    await expect(
      withTenant(client, a.tenantId, (tx) => tx.role.delete({ where: { id: b.roleId } })),
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('counts and aggregates only within the tenant', async () => {
    const counted = await withTenant(client, a.tenantId, (tx) => tx.auditLog.count());
    const total = await owner.query<{ n: string }>('SELECT count(*) AS n FROM app.audit_log');
    expect(counted).toBe(1);
    expect(Number(total.rows[0]!.n)).toBeGreaterThan(counted);
  });

  it('fills in the tenant on create and refuses a different one', async () => {
    const team = await withTenant(client, a.tenantId, (tx) =>
      tx.team.create({ data: { name: 'Night shift' } as never }),
    );
    expect(team.tenantId).toBe(a.tenantId);
    await expect(
      withTenant(client, a.tenantId, (tx) =>
        tx.team.create({ data: { name: 'x', tenantId: b.tenantId } }),
      ),
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });

  it('refuses tenant-owned access with no tenant context (fail closed)', async () => {
    await expect(client.branch.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(client.membership.count()).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it('leaves global models alone', async () => {
    await expect(client.catalogueModule.count()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('keeps RLS as the second layer when the extension is bypassed with raw SQL', async () => {
    const rows = await withTenant(
      client,
      a.tenantId,
      (tx) => tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id::text FROM app.branches`,
    );
    expect(rows).toEqual([{ tenant_id: a.tenantId }]);
    const none = await client.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM app.branches`;
    expect(Number(none[0]!.n)).toBe(0);
  });

  it('refuses a tenant id that is not a uuid', async () => {
    await expect(withTenant(client, "x' OR true --", async () => 1)).rejects.toThrow(
      'needs a tenant id',
    );
  });

  it('does not let one tenant’s context leak into parallel work', async () => {
    const [left, right] = await Promise.all([
      withTenant(client, a.tenantId, async (tx) =>
        (await tx.membership.findMany()).map((m) => m.tenantId),
      ),
      withTenant(client, b.tenantId, async (tx) =>
        (await tx.membership.findMany()).map((m) => m.tenantId),
      ),
    ]);
    expect(new Set(left)).toEqual(new Set([a.tenantId]));
    expect(new Set(right)).toEqual(new Set([b.tenantId]));
  });

  it('creates ids as UUID v7 when none is given', async () => {
    const dept = await withTenant(client, a.tenantId, (tx) =>
      tx.department.create({ data: { name: 'Bar', code: `BAR-${uuidv7().slice(-4)}` } as never }),
    );
    expect(dept.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });
});
