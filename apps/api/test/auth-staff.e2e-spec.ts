import { uuidv7 } from '@erp/contracts';
import { createTenantWithData } from '@erp/db/testing';
import { createLocalJWKSet, jwtVerify } from 'jose';
import request from 'supertest';
import { randomToken, sha256 } from '../src/modules/auth/crypto';
import {
  codeFor,
  cookie,
  createMember,
  setCookieHeader,
  startAuthEnv,
  stopAuthEnv,
  type AuthEnv,
} from './support/auth-env';

// Platform staff sign-in (D5) end to end: the one-time setup link, MFA enrolled at the first
// sign-in, tokens of the console audience only, sessions ending after 30 minutes idle.

const CONSOLE = 'http://localhost:5174';
let env: AuthEnv;
let ip = 0;
const server = () => env.app.getHttpServer();
const from = () => `10.2.0.${++ip}`;
const PASSWORD = 'staff pass 2026';

/** A staff member invited by the operator's CLI: a setup link, no password yet. */
async function inviteStaff(
  role = 'platform_owner',
): Promise<{ id: string; email: string; setup: string }> {
  const id = uuidv7();
  const email = `staff-${id.slice(-6)}@example.com`;
  await env.owner.query(
    `INSERT INTO platform.staff_users (id, email, email_normalized, name, status) VALUES ($1, $2, $2, 'Staff', 'invited')`,
    [id, email],
  );
  await env.owner.query(
    'INSERT INTO platform.staff_role_assignments (staff_user_id, role_key) VALUES ($1, $2)',
    [id, role],
  );
  const setup = randomToken();
  await env.owner.query(
    `INSERT INTO platform.staff_setup_tokens (id, staff_user_id, kind, token_hash, expires_at)
     VALUES ($1, $2, 'setup', $3, now() + interval '72 hours')`,
    [uuidv7(), id, sha256(setup)],
  );
  return { id, email, setup };
}

const login = (addr: string, email: string, password = PASSWORD) =>
  request(server())
    .post('/api/platform/v1/auth/login')
    .set('X-Forwarded-For', addr)
    .send({ email, password });

/** Setup link, first sign-in and enrolment: a signed-in staff member and their secret. */
async function onboardStaff() {
  const staff = await inviteStaff();
  const addr = from();
  await request(server())
    .post('/api/platform/v1/auth/setup')
    .send({ token: staff.setup, password: PASSWORD })
    .expect(200);
  const first = await login(addr, staff.email).expect(200);
  const enrolled = await request(server())
    .post('/api/platform/v1/auth/mfa/enrol')
    .set('X-Forwarded-For', addr)
    .send({ challenge: first.body.challenge, code: codeFor(first.body.secret) })
    .expect(200);
  return { ...staff, addr, secret: first.body.secret as string, enrolled };
}

beforeAll(async () => {
  process.env.TRUST_PROXY = '1';
  env = await startAuthEnv('erp_test_auth_staff');
}, 120_000);

afterAll(async () => {
  await stopAuthEnv(env);
});

describe('the setup link (D5)', () => {
  it('greets the person, sets a password once, and allows the MFA minimum of 8', async () => {
    const staff = await inviteStaff();
    const info = await request(server())
      .get('/api/platform/v1/auth/setup')
      .query({ token: staff.setup })
      .expect(200);
    expect(info.body).toEqual({ email: staff.email, name: 'Staff' });
    const setup = (password: string) =>
      request(server()).post('/api/platform/v1/auth/setup').send({ token: staff.setup, password });
    expect((await setup('seven c').expect(400)).body.errors[0].code).toBe('length');
    await setup(PASSWORD).expect(200);
    expect((await setup(PASSWORD).expect(400)).body.code).toBe('link_invalid');
  });

  it('keeps an invited staff member out until the setup is done, with the usual answer', async () => {
    const staff = await inviteStaff();
    const addr = from();
    const invited = await login(addr, staff.email).set('X-Correlation-Id', 'staff-same-0001');
    const unknown = await login(addr, 'nobody-staff@example.com').set(
      'X-Correlation-Id',
      'staff-same-0001',
    );
    expect(invited.status).toBe(401);
    expect(invited.text).toBe(unknown.text);
  });
});

describe('first sign-in and MFA', () => {
  it('requires an authenticator before anything else and shows 10 recovery codes once', async () => {
    const staff = await inviteStaff();
    const addr = from();
    await request(server())
      .post('/api/platform/v1/auth/setup')
      .send({ token: staff.setup, password: PASSWORD })
      .expect(200);
    const first = await login(addr, staff.email).expect(200);
    expect(first.body).toMatchObject({ status: 'mfa_enrolment_required' });
    expect(first.body.otpauth_uri).toMatch(/^otpauth:\/\/totp\/ERP%20System%20Console:/);
    expect(first.body.access_token).toBeUndefined();

    const enrol = (code: string) =>
      request(server())
        .post('/api/platform/v1/auth/mfa/enrol')
        .set('X-Forwarded-For', addr)
        .send({ challenge: first.body.challenge, code });
    await enrol('000000').expect(401);
    const enrolled = await enrol(codeFor(first.body.secret)).expect(200);
    expect(enrolled.body.status).toBe('signed_in');
    expect(enrolled.body.recovery_codes).toHaveLength(10);
    const header = setCookieHeader(enrolled, 'erp_staff_rt');
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Path=\/api\/platform\/v1\/auth/);

    const me = await request(server())
      .get('/api/platform/v1/me')
      .set('Authorization', `Bearer ${enrolled.body.access_token}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: staff.email, roles: ['platform_owner'] });
  });

  it('asks for the code at every later sign-in', async () => {
    const staff = await onboardStaff();
    const again = await login(staff.addr, staff.email).expect(200);
    expect(again.body.status).toBe('mfa_required');
    await request(server())
      .post('/api/platform/v1/auth/mfa/verify')
      .set('X-Forwarded-For', staff.addr)
      .send({ challenge: again.body.challenge, code: codeFor(staff.secret, 1) })
      .expect(200);
  });
});

describe('audiences (§10.6)', () => {
  it('refuses a staff token on company routes and a member token on console routes', async () => {
    const staff = await onboardStaff();
    const tenant = await createTenantWithData(env.owner, 'alpha');
    const memberEmail = `member-${uuidv7().slice(-6)}@example.com`;
    await createMember(env.owner, memberEmail, 'a long passphrase for tests', [tenant.tenantId]);
    const member = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', from())
      .send({ email: memberEmail, password: 'a long passphrase for tests' })
      .expect(200);

    const staffToken = staff.enrolled.body.access_token as string;
    const memberToken = member.body.access_token as string;
    await request(server())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(401);
    await request(server())
      .get('/api/platform/v1/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(401);
    await request(server())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    await request(server())
      .get('/api/platform/v1/me')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    // Anyone can check a token against the published keys; the issuer names the audience.
    const jwks = await request(server()).get('/api/v1/auth/jwks').expect(200);
    const { payload } = await jwtVerify(staffToken, createLocalJWKSet(jwks.body), {
      audience: 'console',
    });
    expect(payload.iss).toMatch(/\/api\/platform\/v1\/auth$/);
    expect(payload.amr).toEqual(['pwd', 'otp']);
  });
});

describe('the staff refresh cookie (F5)', () => {
  it('is never handed back as a readable token to a page that adds the desktop header', async () => {
    const staff = await onboardStaff();
    const response = await request(server())
      .post('/api/platform/v1/auth/refresh')
      .set('Origin', CONSOLE)
      .set('X-ERP-Client', 'desktop')
      .set('Cookie', `erp_staff_rt=${cookie(staff.enrolled, 'erp_staff_rt')}`)
      .expect(200);
    expect(response.body.refresh_token).toBeUndefined();
    expect(cookie(response, 'erp_staff_rt')).toEqual(expect.any(String));
  });
});

describe('idle timeout (D5)', () => {
  it('refreshes while in use and ends the session after 30 minutes without use', async () => {
    const staff = await onboardStaff();
    const refresh = (token: string) =>
      request(server())
        .post('/api/platform/v1/auth/refresh')
        .set('Origin', CONSOLE)
        .set('Cookie', `erp_staff_rt=${token}`);
    const rotated = await refresh(cookie(staff.enrolled, 'erp_staff_rt')!).expect(200);
    await env.owner.query(
      `UPDATE platform.staff_sessions SET last_seen_at = now() - interval '31 minutes' WHERE staff_user_id = $1`,
      [staff.id],
    );
    await refresh(cookie(rotated, 'erp_staff_rt')!).expect(401);
    const { rows } = await env.owner.query(
      'SELECT revoke_reason FROM platform.staff_sessions WHERE staff_user_id = $1',
      [staff.id],
    );
    expect(rows).toEqual([{ revoke_reason: 'idle' }]);
  });
});
