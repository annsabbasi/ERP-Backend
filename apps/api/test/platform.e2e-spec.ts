import { uuidv7, type StaffRoleKey } from '@erp/contracts';
import { createPrismaClient, seedConsoleData, syncCatalogue } from '@erp/db';
import request from 'supertest';
import { randomToken, sha256 } from '../src/modules/auth/crypto';
import { codeFor, emails, startAuthEnv, stopAuthEnv, type AuthEnv } from './support/auth-env';

// Platform Console I end to end (Part 03 §3.2–3.3, §3.11, §3.17): staff of every role signed in
// for real (setup link, password, TOTP), the console API behind the real guards, the shipped
// catalogue seeded as at release, and the platform audit log.

const P = '/api/platform/v1';
const PASSWORD = 'console pass 2026';
let env: AuthEnv;
let ip = 0;
const server = () => env.app.getHttpServer();
const from = () => `10.4.0.${++ip}`;

type Staff = { id: string; email: string; token: string; secret: string; step: number };

/** A staff member with these roles, through the real first sign-in (setup, password, TOTP). */
async function staffWith(roles: StaffRoleKey[]): Promise<Staff> {
  const id = uuidv7();
  const email = `${roles[0]}-${id.slice(-6)}@example.com`;
  await env.owner.query(
    `INSERT INTO platform.staff_users (id, email, email_normalized, name, status) VALUES ($1, $2, $2, $3, 'invited')`,
    [id, email, `${roles[0]} ${id.slice(-4)}`],
  );
  for (const role of roles) {
    await env.owner.query(
      'INSERT INTO platform.staff_role_assignments (staff_user_id, role_key) VALUES ($1, $2)',
      [id, role],
    );
  }
  const setup = randomToken();
  await env.owner.query(
    `INSERT INTO platform.staff_setup_tokens (id, staff_user_id, kind, token_hash, expires_at) VALUES ($1, $2, 'setup', $3, now() + interval '1 hour')`,
    [uuidv7(), id, sha256(setup)],
  );
  await request(server())
    .post(`${P}/auth/setup`)
    .send({ token: setup, password: PASSWORD })
    .expect(200);
  const addr = from();
  const first = await request(server())
    .post(`${P}/auth/login`)
    .set('X-Forwarded-For', addr)
    .send({ email, password: PASSWORD })
    .expect(200);
  const enrolled = await request(server())
    .post(`${P}/auth/mfa/enrol`)
    .set('X-Forwarded-For', addr)
    .send({ challenge: first.body.challenge, code: codeFor(first.body.secret) })
    .expect(200);
  return { id, email, token: enrolled.body.access_token, secret: first.body.secret, step: 0 };
}

const as = (s: Staff) => ({
  get: (path: string) =>
    request(server()).get(`${P}${path}`).set('Authorization', `Bearer ${s.token}`),
  post: (path: string, body: object = {}) =>
    request(server()).post(`${P}${path}`).set('Authorization', `Bearer ${s.token}`).send(body),
  put: (path: string, body: object, ifMatch?: string) => {
    const r = request(server()).put(`${P}${path}`).set('Authorization', `Bearer ${s.token}`);
    return (ifMatch ? r.set('If-Match', ifMatch) : r).send(body);
  },
  patch: (path: string, body: object) =>
    request(server()).patch(`${P}${path}`).set('Authorization', `Bearer ${s.token}`).send(body),
});

let owner: Staff;
let adminA: Staff;
let adminB: Staff;
let onboarding: Staff;
let billing: Staff;
let support: Staff;
let auditor: Staff;

beforeAll(async () => {
  env = await startAuthEnv('erp_test_platform');
  const prisma = createPrismaClient(env.db.ownerUrl, { max: 2 });
  try {
    await syncCatalogue(prisma);
    await seedConsoleData(prisma);
  } finally {
    await prisma.$disconnect();
  }
  owner = await staffWith(['platform_owner']);
  adminA = await staffWith(['platform_admin']);
  adminB = await staffWith(['platform_admin']);
  onboarding = await staffWith(['onboarding_specialist']);
  billing = await staffWith(['billing_manager']);
  support = await staffWith(['support_agent']);
  auditor = await staffWith(['auditor']);
}, 180_000);

afterAll(async () => {
  await stopAuthEnv(env);
});

describe('staff access (Part 03 §3.2.1, §3.3.2)', () => {
  it('gives each role only its own sidebar entries', async () => {
    const paths = async (s: Staff) =>
      (
        (await as(s).get('/me/access').expect(200)).body.menu as { entries: { path: string }[] }[]
      ).flatMap((g) => g.entries.map((e) => e.path));
    expect(await paths(owner)).toEqual([
      '/',
      '/catalogue/modules',
      '/catalogue/templates',
      '/catalogue/plans',
      '/catalogue/country-packs',
      '/approvals',
      '/audit',
      '/staff',
    ]);
    expect(await paths(adminA)).toEqual([
      '/',
      '/catalogue/modules',
      '/catalogue/templates',
      '/catalogue/plans',
      '/catalogue/country-packs',
      '/approvals',
      '/audit',
    ]);
    expect(await paths(onboarding)).toEqual([
      '/',
      '/catalogue/modules',
      '/catalogue/templates',
      '/catalogue/plans',
      '/audit',
    ]);
    expect(await paths(billing)).toEqual(['/', '/catalogue/plans', '/approvals', '/audit']);
    expect(await paths(support)).toEqual(['/', '/audit']);
    expect(await paths(auditor)).toEqual([
      '/',
      '/catalogue/modules',
      '/catalogue/templates',
      '/catalogue/plans',
      '/catalogue/country-packs',
      '/approvals',
      '/audit',
      '/staff',
    ]);
  });

  it('refuses what a role may not do, on the server', async () => {
    expect((await as(support).get('/catalogue/modules').expect(403)).body.code).toBe(
      'permission_denied',
    );
    await as(auditor).get('/catalogue/modules').expect(200);
    await as(auditor)
      .patch('/catalogue/features/restaurant.floor', { display_name: 'x', reason: 'test' })
      .expect(403);
    await as(onboarding)
      .post('/catalogue/templates/restaurant_cafe/1.0.0/publish', { reason: 'test' })
      .expect(403);
    await as(adminA).get('/staff').expect(403);
    await as(auditor).get('/staff').expect(200);
  });
});

describe('industry templates and four-eyes publishing (§3.11, Stage 4 acceptance)', () => {
  it('ships the three templates, published, with no problems', async () => {
    const list = (await as(auditor).get('/catalogue/templates').expect(200)).body.data;
    expect(
      list.map(
        (t: { key: string; version: string; status: string }) =>
          `${t.key}@${t.version}:${t.status}`,
      ),
    ).toEqual([
      'general_business@1.0.0:published',
      'restaurant_cafe@1.0.0:published',
      'school_k12@1.0.0:published',
    ]);
    const detail = await as(auditor).get('/catalogue/templates/school_k12/1.0.0').expect(200);
    expect(detail.body.problems).toEqual([]);
    expect(detail.headers.etag).toBe('W/"1"');
  });

  it('keeps a publish by one Platform Admin pending until a second approves; self-approval is refused', async () => {
    await as(adminA)
      .post('/catalogue/templates/restaurant_cafe/drafts', {
        version: '1.1.0',
        from_version: '1.0.0',
        reason: 'add reservations',
      })
      .expect(201);
    const draft = await as(adminA).get('/catalogue/templates/restaurant_cafe/1.1.0').expect(200);
    const definition = structuredClone(draft.body.definition);
    definition.entitlements.push('restaurant.reservations');
    definition.roles
      .find((r: { key: string }) => r.key === 'host')
      .grants.push({ permission: 'restaurant.reservations.view', scope: 'branch' });
    await as(adminA)
      .put('/catalogue/templates/restaurant_cafe/1.1.0', {
        definition,
        reason: 'hosts see bookings',
      })
      .expect(428);
    await as(adminA)
      .put(
        '/catalogue/templates/restaurant_cafe/1.1.0',
        { definition, reason: 'hosts see bookings' },
        draft.headers.etag,
      )
      .expect(200);
    const asked = await as(adminA)
      .post('/catalogue/templates/restaurant_cafe/1.1.0/publish', { reason: 'release 1.1' })
      .expect(202);
    expect(asked.body.status).toBe('pending');
    const approvalId = asked.body.approval_id as string;

    const state = async () =>
      (await as(auditor).get('/catalogue/templates').expect(200)).body.data
        .filter((t: { key: string }) => t.key === 'restaurant_cafe')
        .map((t: { version: string; status: string }) => `${t.version}:${t.status}`);
    expect(await state()).toEqual(['1.0.0:published', '1.1.0:in_review']);

    const own = await as(adminA).post(`/approvals/${approvalId}/approve`).expect(403);
    expect(own.body.detail).toMatch(/your own request/);
    await as(onboarding).post(`/approvals/${approvalId}/approve`).expect(403);
    const queue = (await as(adminB).get('/approvals?status=pending').expect(200)).body.data;
    expect(queue.find((a: { id: string }) => a.id === approvalId)).toMatchObject({
      can_decide: true,
      action: 'template.publish',
    });
    expect(
      (await as(adminB).get('/me/access').expect(200)).body.badges.approvals,
    ).toBeGreaterThanOrEqual(1);

    await as(adminB)
      .post(`/approvals/${approvalId}/approve`, { note: 'checked the diff' })
      .expect(200);
    expect(await state()).toEqual(['1.0.0:deprecated', '1.1.0:published']);
    const published = (
      await as(auditor).get('/audit?action=catalogue.template_published').expect(200)
    ).body.data[0];
    expect(published).toMatchObject({
      actor: { id: adminB.id },
      target_id: 'restaurant_cafe@1.1.0',
      after: { status: 'published', requested_by: adminA.id, approved_by: adminB.id },
    });
    const diff = await as(auditor)
      .get('/catalogue/templates/restaurant_cafe/diff?from=1.0.0&to=1.1.0')
      .expect(200);
    expect(diff.body.entitlements).toEqual({ added: ['restaurant.reservations'], removed: [] });
  });

  it('refuses to publish a role template holding a feature its template does not entitle', async () => {
    await as(adminA)
      .post('/catalogue/templates/school_k12/drafts', {
        version: '1.0.1',
        from_version: '1.0.0',
        reason: 'test',
      })
      .expect(201);
    const draft = await as(adminA).get('/catalogue/templates/school_k12/1.0.1').expect(200);
    const definition = structuredClone(draft.body.definition);
    definition.roles
      .find((r: { key: string }) => r.key === 'teacher')
      .grants.push({ permission: 'restaurant.orders.create', scope: 'assigned' });
    const saved = await as(adminA)
      .put(
        '/catalogue/templates/school_k12/1.0.1',
        { definition, reason: 'test' },
        draft.headers.etag,
      )
      .expect(200);
    expect(saved.body.problems).toEqual([
      'role teacher: restaurant.orders.create needs restaurant.waiter_app or restaurant.cashier or restaurant.takeaway or restaurant.delivery, which the template does not entitle',
    ]);
    const refused = await as(adminA)
      .post('/catalogue/templates/school_k12/1.0.1/publish', { reason: 'test' })
      .expect(400);
    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.errors[0].message).toMatch(/does not entitle/);
  });
});

describe('catalogue changes are audited (AC-P12)', () => {
  it('records actor, reason, before and after; the entry cannot be changed or removed', async () => {
    await as(adminA)
      .patch('/catalogue/features/restaurant.waiter_app', {
        display_name: 'Waiter tablet',
        countries: ['PK'],
        reason: 'clearer name for sales',
      })
      .expect(200);
    const entry = (
      await as(auditor).get('/audit?action=catalogue.feature_display_changed').expect(200)
    ).body.data[0];
    expect(entry).toMatchObject({
      actor: { id: adminA.id },
      target_type: 'catalogue_feature',
      target_id: 'restaurant.waiter_app',
      reason: 'clearer name for sales',
      before: { display_name: null, countries: [] },
      after: { display_name: 'Waiter tablet', countries: ['PK'] },
      result: 'success',
    });
    await expect(
      env.owner.query('UPDATE platform.platform_audit_log SET reason = $1 WHERE id = $2', [
        'edited',
        entry.id,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      env.owner.query('DELETE FROM platform.platform_audit_log WHERE id = $1', [entry.id]),
    ).rejects.toThrow(/append-only/);
    const modules = (await as(auditor).get('/catalogue/modules').expect(200)).body.data;
    const feature = modules
      .find((m: { key: string }) => m.key === 'restaurant')
      .features.find((f: { key: string }) => f.key === 'restaurant.waiter_app');
    expect(feature).toMatchObject({
      name: 'Waiter App',
      display_name: 'Waiter tablet',
      countries: ['PK'],
    });
  });

  it('shows each role only the entries it may see, and lets only the Owner and Auditor export', async () => {
    const seen = (await as(support).get('/audit').expect(200)).body.data;
    expect(seen.every((e: { actor: { id: string } | null }) => e.actor?.id === support.id)).toBe(
      true,
    );
    const csv = await as(auditor).get('/audit/export?action=catalogue.').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe(
      'seq,at,actor,action,target_type,target_id,target_tenant_id,reason,result,before,after,correlation_id',
    );
    expect(csv.text).toContain('catalogue.feature_display_changed');
    await as(adminA).get('/audit/export').expect(403);
  });
});

describe('plans and prices (§3.11, ◐ for Billing)', () => {
  it('applies the Owner’s price change at once and holds the Billing Manager’s for a second approver', async () => {
    const direct = await as(owner)
      .post('/catalogue/plans/starter/prices', {
        prices: { PKR: { monthly: 4900 } },
        reason: 'launch price',
      })
      .expect(200);
    expect(direct.body).toEqual({ status: 'done' });
    const held = await as(billing)
      .post('/catalogue/plans/business/prices', {
        prices: { PKR: { monthly: 9900 } },
        reason: 'launch price',
      })
      .expect(200);
    expect(held.body.status).toBe('pending');
    const before = (await as(billing).get('/catalogue/plans').expect(200)).body.data.find(
      (p: { key: string }) => p.key === 'business',
    );
    expect(before.prices).toEqual({});
    await as(adminA).post(`/approvals/${held.body.approval_id}/approve`).expect(200);
    const after = (await as(billing).get('/catalogue/plans').expect(200)).body.data.find(
      (p: { key: string }) => p.key === 'business',
    );
    expect(after.prices).toEqual({ PKR: { monthly: 9900 } });
  });

  it('refuses unknown features in a plan', async () => {
    const refused = await as(owner)
      .put('/catalogue/plans', {
        key: 'trial_plus',
        kind: 'addon',
        name: 'Trial plus',
        tier: null,
        limits: {},
        feature_keys: ['restaurant.teleport'],
        prices: {},
        visibility: 'private',
        reason: 'test',
      })
      .expect(400);
    expect(refused.body.errors[0].message).toMatch(/not in the registry/);
  });
});

describe('country packs (§3.11, AC-P10)', () => {
  it('ships Pakistan 1.0; a new version needs step-up and a second approver to publish', async () => {
    await as(owner)
      .post('/catalogue/country-packs/PK/drafts', {
        version: '1.1',
        from_version: '1.0',
        reason: 'confirmed Eid dates',
      })
      .expect(201);
    const asked = await as(owner)
      .post('/catalogue/country-packs/PK/1.1/publish', { reason: 'confirmed Eid dates' })
      .expect(202);
    // The approver's MFA check is old: publishing a country pack needs a fresh one (§3.3.1).
    await env.owner.query(
      'UPDATE platform.staff_sessions SET mfa_verified_at = NULL WHERE staff_user_id = $1',
      [adminA.id],
    );
    expect(
      (await as(adminA).post(`/approvals/${asked.body.approval_id}/approve`).expect(403)).body.code,
    ).toBe('step_up_required');
    await as(adminA)
      .post('/me/step-up', { code: codeFor(adminA.secret, 1) })
      .expect(200);
    await as(adminA).post(`/approvals/${asked.body.approval_id}/approve`).expect(200);
    const packs = (await as(auditor).get('/catalogue/country-packs').expect(200)).body.data;
    expect(
      packs.map((p: { version: string; status: string }) => `${p.version}:${p.status}`),
    ).toEqual(['1.0:deprecated', '1.1:published']);
  });
});

describe('staff management (Owner only, §3.2)', () => {
  it('invites with a setup link, keeps two Owners at most, and deactivation ends access at once', async () => {
    const email = `new-${uuidv7().slice(-6)}@example.com`;
    await as(adminA)
      .post('/staff', { email, name: 'New Person', roles: ['support_agent'], reason: 'test' })
      .expect(403);
    const invited = await as(owner)
      .post('/staff', { email, name: 'New Person', roles: ['support_agent'], reason: 'new hire' })
      .expect(201);
    expect(invited.body).toMatchObject({ email, status: 'invited', roles: ['support_agent'] });
    const mail = (await emails(env, email)).filter((m) => m.template === 'staff_setup');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.data.link).toMatch(/\/setup\//);

    const second = await as(owner)
      .post('/staff', {
        email: `owner2-${uuidv7().slice(-6)}@example.com`,
        name: 'Second Owner',
        roles: ['platform_owner'],
        reason: 'test',
      })
      .expect(201);
    const third = await as(owner)
      .post('/staff', {
        email: `owner3-${uuidv7().slice(-6)}@example.com`,
        name: 'Third Owner',
        roles: ['platform_owner'],
        reason: 'test',
      })
      .expect(409);
    expect(third.body.detail).toMatch(/already 2 Platform Owners/);
    await as(owner)
      .put(`/staff/${second.body.id}/roles`, { roles: ['platform_admin'], reason: 'test' })
      .expect(200);

    await as(support).get('/audit').expect(200);
    await as(owner)
      .post(`/staff/${support.id}/deactivate`, { reason: 'left the team' })
      .expect(200);
    expect((await as(support).get('/audit').expect(401)).body.code).toBe('unauthenticated');
    expect(
      (await as(owner).post(`/staff/${owner.id}/deactivate`, { reason: 'test' }).expect(409)).body
        .detail,
    ).toMatch(/yourself/);
  });
});

describe('search (Ctrl+K)', () => {
  it('finds tenants by name or code, and only pages the person may open', async () => {
    const id = uuidv7();
    await env.owner.query(
      `INSERT INTO platform.tenants (id, code, slug, display_name, legal_name, country, base_currency, timezone, industry_key, status, region)
       VALUES ($1, 'T-SRCH01', 'searchable', 'Searchable Bistro', 'Searchable Bistro', 'PK', 'PKR', 'Asia/Karachi', 'restaurant', 'active', 'ap-southeast-1')`,
      [id],
    );
    const found = (await as(billing).get('/search?q=bistro').expect(200)).body;
    expect(found.tenants).toEqual([
      {
        id,
        code: 'T-SRCH01',
        slug: 'searchable',
        display_name: 'Searchable Bistro',
        status: 'active',
      },
    ]);
    expect((await as(billing).get('/search?q=catalogue').expect(200)).body.pages).toEqual([
      { path: '/catalogue/plans', label: 'console.nav.plans' },
    ]);
  });
});
