import { ACCESS_VERSION_HEADER, uuidv7 } from '@erp/contracts';
import { createTenantWithData, type TenantFixture } from '@erp/db/testing';
import request from 'supertest';
import { AccessService } from '../src/modules/access/access.service';
import { AccessProbeModule } from './support/access-probe';
import { createMember, startAuthEnv, stopAuthEnv, type AuthEnv } from './support/auth-env';

// The three gates end to end (Part 02 §2.12, Part 10 §10.7): real tokens, a database built from
// the migrations (the API as app_user), Redis, and test routes behind the real global guards.

let env: AuthEnv;
let a: TenantFixture;
let bare: TenantFixture;
let secondBranch: string;
let ip = 0;
const server = () => env.app.getHttpServer();
const from = () => `10.3.${Math.floor(++ip / 250)}.${ip % 250}`;
const LONG = 'a long passphrase for tests';
const WAITER_CHAIN = ['pos.core', 'restaurant.menu', 'restaurant.floor', 'restaurant.waiter_app'];

async function entitle(tenantId: string, features: string[]): Promise<void> {
  for (const feature of features) {
    await env.owner.query(
      `INSERT INTO platform.tenant_entitlements (tenant_id, feature_key, state, source, changed_by)
       VALUES ($1, $2, 'on', 'template', $3)`,
      [tenantId, feature, uuidv7()],
    );
  }
}

const ownerRoles = new Map<string, string>();

async function role(
  tenantId: string,
  grants: [permission: string, scope: string][],
  options: { owner?: boolean } = {},
): Promise<string> {
  // One Owner role per company (role keys are unique within a company).
  if (options.owner && ownerRoles.has(tenantId)) return ownerRoles.get(tenantId)!;
  const id = uuidv7();
  if (options.owner) ownerRoles.set(tenantId, id);
  await env.owner.query(
    `INSERT INTO app.roles (id, tenant_id, key, name, origin, is_protected) VALUES ($1, $2, $3, $3, 'custom', $4)`,
    [id, tenantId, options.owner ? 'owner' : `role-${id.slice(-8)}`, options.owner ?? false],
  );
  for (const [permission, scope] of grants) {
    await env.owner.query(
      `INSERT INTO app.role_grants (tenant_id, role_id, permission_key, scope_type) VALUES ($1, $2, $3, $4)`,
      [tenantId, id, permission, scope],
    );
  }
  return id;
}

type Member = { membershipId: string; token: string; email: string };

/** A member with these roles, signed in (one company, so the token is for it). */
async function member(
  tenantId: string,
  roles: { roleId: string; scope?: object }[] = [],
  place: { branchId?: string; departmentId?: string } = {},
): Promise<Member> {
  const email = `m-${uuidv7().slice(-8)}@example.com`;
  const { membershipIds } = await createMember(env.owner, email, LONG, [tenantId]);
  const membershipId = membershipIds[0]!;
  await env.owner.query(
    `UPDATE app.memberships SET primary_branch_id = $2, department_id = $3 WHERE id = $1`,
    [membershipId, place.branchId ?? null, place.departmentId ?? null],
  );
  for (const r of roles) {
    await env.owner.query(
      `INSERT INTO app.membership_roles (tenant_id, membership_id, role_id, scope_values) VALUES ($1, $2, $3, $4)`,
      [tenantId, membershipId, r.roleId, JSON.stringify(r.scope ?? {})],
    );
  }
  return { membershipId, email, token: await signIn(email) };
}

async function signIn(email: string): Promise<string> {
  const response = await request(server())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', from())
    .send({ email, password: LONG })
    .expect(200);
  return response.body.access_token as string;
}

const call = (token: string, method: 'get' | 'post', path: string) =>
  request(server())[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  env = await startAuthEnv('erp_test_access', [AccessProbeModule]);
  a = await createTenantWithData(env.owner, 'alpha');
  bare = await createTenantWithData(env.owner, 'bare');
  await entitle(a.tenantId, WAITER_CHAIN);
  secondBranch = uuidv7();
  await env.owner.query(
    `INSERT INTO app.branches (id, tenant_id, legal_entity_id, name, code, type) VALUES ($1, $2, $3, 'Second', 'B2', 'outlet')`,
    [secondBranch, a.tenantId, a.legalEntityId],
  );
  await env.owner.query(
    `INSERT INTO platform.tenant_limits (tenant_id, limit_key, value, source, changed_by) VALUES ($1, 'branches.max', 2, 'plan', $2)`,
    [a.tenantId, uuidv7()],
  );
}, 120_000);

afterAll(async () => {
  await stopAuthEnv(env);
});

describe('the three gates (Part 02 §2.12)', () => {
  it('gate 1: a feature the company lacks → 403 feature_not_entitled, even with the grant', async () => {
    const waiter = await role(bare.tenantId, [
      ['restaurant.orders.create', 'assigned'],
      ['restaurant.orders.view', 'branch'],
    ]);
    const m = await member(bare.tenantId, [{ roleId: waiter }]);
    for (const [method, path] of [
      ['post', '/probe/orders'],
      ['get', '/probe/orders'],
    ] as const) {
      const response = await call(m.token, method, path).expect(403);
      expect(response.body.code).toBe('feature_not_entitled');
    }
  });

  it('gate 2: no role grants the permission → 403 permission_denied', async () => {
    const m = await member(a.tenantId);
    expect((await call(m.token, 'get', '/probe/branches').expect(403)).body.code).toBe(
      'permission_denied',
    );
    expect((await call(m.token, 'post', '/probe/orders').expect(403)).body.code).toBe(
      'permission_denied',
    );
  });

  it('gate 3: a record outside the scope → 404, the same answer as one that does not exist', async () => {
    const outlet = await role(a.tenantId, [['core.branches.view', 'branch']]);
    const m = await member(a.tenantId, [{ roleId: outlet, scope: { branch_ids: [a.branchId] } }]);
    expect((await call(m.token, 'get', '/probe/branches').expect(200)).body).toEqual([
      { id: a.branchId },
    ]);
    await call(m.token, 'get', `/probe/branches/${a.branchId}`).expect(200);
    const outside = await call(m.token, 'get', `/probe/branches/${secondBranch}`).expect(404);
    const otherTenant = await call(m.token, 'get', `/probe/branches/${bare.branchId}`).expect(404);
    const missing = await call(m.token, 'get', `/probe/branches/${uuidv7()}`).expect(404);
    for (const r of [outside, otherTenant, missing]) {
      expect({ code: r.body.code, title: r.body.title, detail: r.body.detail }).toEqual({
        code: missing.body.code,
        title: missing.body.title,
        detail: missing.body.detail,
      });
    }
  });

  it('checks the gates in order: sign-in first, then entitlement before permission', async () => {
    await request(server()).get('/api/v1/probe/branches').expect(401);
    const m = await member(bare.tenantId); // no grants and no restaurant features
    expect((await call(m.token, 'post', '/probe/orders').expect(403)).body.code).toBe(
      'feature_not_entitled',
    );
  });

  it('gives the Owner every record and every entitled feature', async () => {
    const owner = await role(a.tenantId, [], { owner: true });
    const m = await member(a.tenantId, [{ roleId: owner }]);
    const branches = (await call(m.token, 'get', '/probe/branches').expect(200)).body;
    expect(branches.map((b: { id: string }) => b.id).sort()).toEqual(
      [a.branchId, secondBranch].sort(),
    );
    await call(m.token, 'post', '/probe/orders').expect(200);
  });

  it('department scope covers sub-departments; own scope covers the member', async () => {
    const pastry = uuidv7();
    const front = uuidv7();
    await env.owner.query(
      `INSERT INTO app.departments (id, tenant_id, name, code, parent_id) VALUES ($1, $3, 'Pastry', 'PAS', $4), ($2, $3, 'Front', 'FRT', NULL)`,
      [pastry, front, a.tenantId, a.departmentId],
    );
    const people = async (departmentId: string) =>
      (await member(a.tenantId, [], { departmentId })).membershipId;
    const [kitchen, inPastry, inFront] = [
      await people(a.departmentId),
      await people(pastry),
      await people(front),
    ];
    const hr = await role(a.tenantId, [['core.members.view', 'department']]);
    const head = await member(a.tenantId, [{ roleId: hr }], { departmentId: a.departmentId });
    const seen = (await call(head.token, 'get', '/probe/members').expect(200)).body.map(
      (m: { id: string }) => m.id,
    );
    expect(seen).toEqual(expect.arrayContaining([kitchen, inPastry, head.membershipId]));
    expect(seen).not.toContain(inFront);

    const self = await role(a.tenantId, [['core.members.view', 'own']]);
    const me = await member(a.tenantId, [{ roleId: self }]);
    expect((await call(me.token, 'get', '/probe/members').expect(200)).body).toEqual([
      { id: me.membershipId },
    ]);
  });
});

describe('the company’s status (Part 03 §3.7.2)', () => {
  it('read-only: view and export still work, changes get 403 tenant_read_only', async () => {
    const ro = await createTenantWithData(env.owner, 'readonly');
    await entitle(ro.tenantId, WAITER_CHAIN);
    const waiter = await role(ro.tenantId, [
      ['restaurant.orders.create', 'branch'],
      ['restaurant.orders.view', 'branch'],
    ]);
    await env.owner.query(
      `UPDATE platform.tenants SET status = 'suspended_read_only' WHERE id = $1`,
      [ro.tenantId],
    );
    const m = await member(ro.tenantId, [{ roleId: waiter }]);
    await call(m.token, 'get', '/probe/orders').expect(200);
    const refused = await call(m.token, 'post', '/probe/orders').expect(403);
    expect(refused.body).toMatchObject({
      code: 'tenant_read_only',
      detail: expect.stringMatching(/read-only/),
    });
  });

  it('locked: only the Owner gets in, to pay and export', async () => {
    const lk = await createTenantWithData(env.owner, 'locked');
    const owner = await role(lk.tenantId, [], { owner: true });
    const o = await member(lk.tenantId, [{ roleId: owner }]);
    const staff = await member(lk.tenantId);
    await env.owner.query(`UPDATE platform.tenants SET status = 'suspended_locked' WHERE id = $1`, [
      lk.tenantId,
    ]);
    // A fresh sign-in: the Owner gets the company, anyone else gets no company at all.
    const ownerToken = await signIn(o.email);
    const access = (await call(ownerToken, 'get', '/me/access').expect(200)).body;
    const keys = Object.keys(access.permissions);
    expect(keys).toContain('core.billing.configure');
    expect(keys.every((k) => /^core\.(billing|plan)\./.test(k) || k.endsWith('.export'))).toBe(
      true,
    );
    expect((await call(ownerToken, 'get', '/probe/branches').expect(403)).body.code).toBe(
      'tenant_read_only',
    );
    const staffLogin = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', from())
      .send({ email: staff.email, password: LONG })
      .expect(200);
    expect(staffLogin.body).toMatchObject({ membership: null, memberships: [] });
    // A token from before the lock stops working too (stamp forgotten instead of waiting).
    await env.app.get(AccessService).forget(lk.tenantId, staff.membershipId);
    expect((await call(staff.token, 'get', '/me').expect(401)).body.detail).toMatch(/ended/);
  });

  it('a suspended member loses the company on the next request', async () => {
    const reader = await role(a.tenantId, [['core.branches.view', 'company']]);
    const m = await member(a.tenantId, [{ roleId: reader }]);
    await call(m.token, 'get', '/probe/branches').expect(200);
    await env.owner.query(`UPDATE app.memberships SET status = 'suspended' WHERE id = $1`, [
      m.membershipId,
    ]);
    await env.app.get(AccessService).forget(a.tenantId, m.membershipId);
    expect((await call(m.token, 'get', '/probe/branches').expect(401)).body.code).toBe(
      'unauthenticated',
    );
  });
});

describe('changes reach the API (AC-U07)', () => {
  it('refuses a removed permission within 60 seconds, and the access version moves', async () => {
    const reader = await role(a.tenantId, [['core.branches.view', 'company']]);
    const m = await member(a.tenantId, [{ roleId: reader }]);
    const before = await call(m.token, 'get', '/probe/branches').expect(200);
    const versionBefore = Number(before.headers[ACCESS_VERSION_HEADER]);
    await env.owner.query(`DELETE FROM app.role_grants WHERE role_id = $1`, [reader]);
    const started = Date.now();
    let response = before;
    while (response.status === 200 && Date.now() - started < 65_000) {
      await new Promise((r) => setTimeout(r, 1000));
      response = await call(m.token, 'get', '/probe/branches');
    }
    const seconds = (Date.now() - started) / 1000;
    console.log(`AC-U07: refused ${seconds.toFixed(1)} s after the grant was removed`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('permission_denied');
    expect(seconds).toBeLessThan(60);
    expect(Number(response.headers[ACCESS_VERSION_HEADER])).toBe(versionBefore + 1);
  }, 75_000);
});

describe('GET /me/access (§10.7.5)', () => {
  it('answers features, permissions with scopes, the menu and the version', async () => {
    const waiter = await role(a.tenantId, [
      ['restaurant.orders.create', 'assigned'],
      ['core.branches.view', 'branch'],
    ]);
    const m = await member(a.tenantId, [{ roleId: waiter, scope: { section_ids: ['hall-a'] } }], {
      branchId: a.branchId,
    });
    const response = await call(m.token, 'get', '/me/access').expect(200);
    const body = response.body;
    expect(body.tenant).toEqual({ id: a.tenantId, code: a.code, status: 'active' });
    expect(body.pv).toBe(Number(response.headers[ACCESS_VERSION_HEADER]));
    const features = Object.fromEntries(
      body.features.map((f: { key: string; state: string }) => [f.key, f.state]),
    );
    expect(features['restaurant.waiter_app']).toBe('on');
    expect(features['core.iam']).toBe('on');
    expect(Object.keys(features).some((k) => k.startsWith('school.'))).toBe(false);
    expect(body.permissions).toEqual({
      'core.branches.view': [
        { scope: 'branch', values: { branch_ids: [a.branchId] }, thresholds: {} },
      ],
      'restaurant.orders.create': [
        { scope: 'assigned', values: { section_ids: ['hall-a'] }, thresholds: {} },
      ],
    });
    const entries = body.menu.flatMap((g: { entries: { requires: string }[] }) => g.entries);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e: { requires: string }) => e.requires in body.permissions)).toBe(true);
  });

  it('needs a company: a token without one may use its own account only', async () => {
    const email = `two-${uuidv7().slice(-8)}@example.com`;
    await createMember(env.owner, email, LONG, [a.tenantId, bare.tenantId]);
    const response = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', from())
      .send({ email, password: LONG })
      .expect(200);
    expect(response.body.membership).toBeNull();
    const token = response.body.access_token as string;
    await call(token, 'get', '/me').expect(200);
    for (const path of ['/me/access', '/probe/branches']) {
      const refused = await call(token, 'get', path).expect(403);
      expect(refused.body).toMatchObject({
        code: 'permission_denied',
        detail: 'Choose a company first',
      });
    }
  });
});

describe('limits (§2.11.1)', () => {
  it('refuses past the plan’s limit with limit_reached and the usage; an add-on raises it', async () => {
    const owner = await role(a.tenantId, [], { owner: true });
    const m = await member(a.tenantId, [{ roleId: owner }]);
    const refused = await call(m.token, 'post', '/probe/branches').expect(409);
    expect(refused.body).toMatchObject({
      code: 'limit_reached',
      detail: 'Branch limit reached (2/2). Ask your Owner to request more.',
      limit: { key: 'branches.max', used: 2, limit: 2 },
    });
    await env.owner.query(
      `INSERT INTO platform.tenant_limits (tenant_id, limit_key, value, source, changed_by) VALUES ($1, 'branches.max', 1, 'addon', $2)`,
      [a.tenantId, uuidv7()],
    );
    expect((await call(m.token, 'post', '/probe/branches').expect(200)).body).toEqual({
      used: 2,
      limit: 3,
      warn: false,
    });
  });
});
