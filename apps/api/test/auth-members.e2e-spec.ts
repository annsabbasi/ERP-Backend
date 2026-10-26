import { uuidv7 } from '@erp/contracts';
import { createHash } from 'node:crypto';
import { createTenantWithData, type TenantFixture } from '@erp/db/testing';
import request from 'supertest';
import {
  codeFor,
  cookie,
  createMember,
  emails,
  setCookieHeader,
  startAuthEnv,
  stopAuthEnv,
  tokenFromLink,
  WEB,
  type AuthEnv,
} from './support/auth-env';

// Member sign-in end to end (Part 05 §5.3–5.4, Part 10 §10.6) against a database built from the
// migrations, as app_auth and app_user. Each scenario has its own person and client address.

let env: AuthEnv;
let a: TenantFixture;
let b: TenantFixture;
let ip = 0;
const server = () => env.app.getHttpServer();
/** A client address of its own per scenario, so rate limits of one do not touch another. */
const from = () => `10.1.${Math.floor(++ip / 250)}.${ip % 250}`;
const email = (label: string) => `${label}-${uuidv7().slice(-6)}@example.com`;
const LONG = 'a long passphrase for tests';

function login(addr: string, address: string, password: string, extra: object = {}) {
  return request(server())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', addr)
    .send({ email: address, password, ...extra });
}

beforeAll(async () => {
  process.env.TRUST_PROXY = '1';
  env = await startAuthEnv('erp_test_auth_members');
  a = await createTenantWithData(env.owner, 'alpha');
  b = await createTenantWithData(env.owner, 'bravo');
}, 120_000);

afterAll(async () => {
  await stopAuthEnv(env);
});

describe('sign-in (§5.3.4)', () => {
  it('answers an unknown e-mail and a wrong password with identical bodies', async () => {
    const addr = from();
    const known = email('known');
    await createMember(env.owner, known, LONG, [a.tenantId]);
    const send = (address: string) =>
      request(server())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', addr)
        .set('X-Correlation-Id', 'same-request-0001')
        .send({ email: address, password: 'not the password at all' });
    const unknown = await send(email('nobody'));
    const wrong = await send(known);
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.text).toBe(wrong.text);
    expect(unknown.body.code).toBe('invalid_credentials');
  });

  it('signs a one-company member straight into that company', async () => {
    const address = email('one');
    const { membershipIds } = await createMember(env.owner, address, LONG, [a.tenantId]);
    const response = await login(from(), address, LONG);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'signed_in',
      token_type: 'Bearer',
      expires_in: 600,
      membership: { membership_id: membershipIds[0], tenant_id: a.tenantId },
    });
    expect(response.body.refresh_token).toBeUndefined(); // web: in the cookie only
    const me = await request(server())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${response.body.access_token}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: address, membership_id: membershipIds[0] });
  });

  it('lets a two-company member choose, then switch (§5.3.5)', async () => {
    const address = email('two');
    const { membershipIds } = await createMember(env.owner, address, LONG, [
      a.tenantId,
      b.tenantId,
    ]);
    const signedIn = await login(from(), address, LONG).expect(200);
    expect(signedIn.body.membership).toBeNull();
    expect(signedIn.body.memberships).toHaveLength(2);
    const auth = `Bearer ${signedIn.body.access_token}`;
    const switched = await request(server())
      .post('/api/v1/auth/switch')
      .set('Authorization', auth)
      .send({ membership_id: membershipIds[1] })
      .expect(200);
    expect(switched.body.membership.tenant_id).toBe(b.tenantId);
    // Another company's membership is "not found", not "forbidden".
    await request(server())
      .post('/api/v1/auth/switch')
      .set('Authorization', auth)
      .send({ membership_id: a.membershipId })
      .expect(404);
  });
});

describe('refresh tokens (§10.6)', () => {
  it('keeps the web refresh token in an httpOnly, Secure, SameSite=Strict cookie', async () => {
    const address = email('cookie');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const response = await login(from(), address, LONG).expect(200);
    const header = setCookieHeader(response, 'erp_rt');
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('refuses the cookie from a page that is not the app (CSRF)', async () => {
    const address = email('csrf');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const token = cookie(await login(from(), address, LONG), 'erp_rt')!;
    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `erp_rt=${token}`)
      .expect(403);
    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `erp_rt=${token}`)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  /** A member signed in on the web, and a refresh call with a given cookie value. */
  async function refreshing(label: string) {
    const addr = from();
    const address = email(label);
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const first = cookie(await login(addr, address, LONG), 'erp_rt')!;
    const refresh = (token: string) =>
      request(server())
        .post('/api/v1/auth/refresh')
        .set('X-Forwarded-For', addr)
        .set('Origin', WEB)
        .set('Cookie', `erp_rt=${token}`);
    return { first, refresh };
  }

  it('rotates on every use and answers a retry within 30 seconds with the same successor', async () => {
    const { first, refresh } = await refreshing('grace');
    const second = cookie(await refresh(first).expect(200), 'erp_rt')!;
    expect(second).not.toBe(first);
    // The response was lost and the browser tries again with the old cookie: same successor.
    const retried = await refresh(first).expect(200);
    expect(cookie(retried, 'erp_rt')).toBe(second);
    const third = cookie(await refresh(second).expect(200), 'erp_rt')!;
    expect(third).not.toBe(second);
  });

  it('gives two requests sent at once with the same token the same successor', async () => {
    const { first, refresh } = await refreshing('parallel');
    const [one, two] = await Promise.all([refresh(first), refresh(first)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(cookie(one, 'erp_rt')).toBe(cookie(two, 'erp_rt'));
  });

  it('revokes the whole family when an old token comes back after the grace window', async () => {
    const { first, refresh } = await refreshing('reuse');
    const rotated = await refresh(first).expect(200);
    const second = cookie(rotated, 'erp_rt')!;
    const access = rotated.body.access_token as string;
    await env.owner.query(
      `UPDATE identity.refresh_tokens SET used_at = now() - interval '31 seconds' WHERE token_hash = $1`,
      [createHash('sha256').update(first).digest('hex')],
    );
    expect((await refresh(first)).status).toBe(401);
    // The family is gone: the newest token and its access token stop working too.
    await refresh(second).expect(401);
    await request(server()).get('/api/v1/me').set('Authorization', `Bearer ${access}`).expect(401);
  });

  it('revokes the family when an old token comes back after its successor was used', async () => {
    const { first, refresh } = await refreshing('reuse2');
    const second = cookie(await refresh(first).expect(200), 'erp_rt')!;
    const third = cookie(await refresh(second).expect(200), 'erp_rt')!;
    await refresh(first).expect(401); // within 30 s, but the chain has moved on: reuse
    await refresh(third).expect(401);
  });

  it('gives the desktop its refresh token in the body, never in a cookie', async () => {
    const address = email('desktop');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const response = await login(from(), address, LONG).set('X-ERP-Client', 'desktop').expect(200);
    expect(response.body.refresh_token).toEqual(expect.any(String));
    expect(cookie(response, 'erp_rt')).toBeUndefined();
    const rotated = await request(server())
      .post('/api/v1/auth/refresh')
      .set('X-ERP-Client', 'desktop')
      .send({ refresh_token: response.body.refresh_token })
      .expect(200);
    expect(rotated.body.refresh_token).not.toBe(response.body.refresh_token);
  });

  it('signs out at once: the access token stops working with the session', async () => {
    const address = email('logout');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const access = (await login(from(), address, LONG)).body.access_token as string;
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    await request(server()).get('/api/v1/me').set('Authorization', `Bearer ${access}`).expect(401);
  });
});

describe('MFA (§5.3.9) and the password rules (§5.4)', () => {
  it('enrols TOTP, then asks for the code at sign-in and accepts each code once', async () => {
    const addr = from();
    const address = email('mfa');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const access = (await login(addr, address, LONG)).body.access_token as string;
    const auth = `Bearer ${access}`;
    const start = await request(server())
      .post('/api/v1/me/mfa/totp')
      .set('Authorization', auth)
      .expect(200);
    expect(start.body.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    const confirm = await request(server())
      .post('/api/v1/me/mfa/totp/confirm')
      .set('Authorization', auth)
      .send({ code: codeFor(start.body.secret) })
      .expect(200);
    expect(confirm.body.recovery_codes).toHaveLength(10);

    const challenge = await login(addr, address, LONG).expect(200);
    expect(challenge.body).toMatchObject({
      status: 'mfa_required',
      methods: ['totp', 'recovery_code'],
    });
    const verify = (body: object) =>
      request(server()).post('/api/v1/auth/mfa/verify').set('X-Forwarded-For', addr).send(body);
    await verify({ challenge: challenge.body.challenge, code: '000000' }).expect(401);
    // The code used to confirm the enrolment cannot be used again: wait for the next step's code.
    const code = codeFor(start.body.secret, 1);
    const signedIn = await verify({ challenge: challenge.body.challenge, code }).expect(200);
    expect(signedIn.body.status).toBe('signed_in');

    const again = await login(addr, address, LONG);
    await verify({ challenge: again.body.challenge, code }).expect(401); // replay refused
    const recovery = confirm.body.recovery_codes[0] as string;
    await verify({ challenge: again.body.challenge, recovery_code: recovery.toLowerCase() }).expect(
      200,
    );
    const third = await login(addr, address, LONG);
    await verify({ challenge: third.body.challenge, recovery_code: recovery }).expect(401); // once
  });

  it('refuses a 10-character password without MFA and accepts it with MFA (AC-U01)', async () => {
    const address = email('acu01');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const auth = `Bearer ${(await login(from(), address, LONG)).body.access_token}`;
    const change = (next: string, current = LONG) =>
      request(server())
        .post('/api/v1/me/password')
        .set('Authorization', auth)
        .send({ current_password: current, new_password: next });
    const refused = await change('tenchars!!').expect(400);
    expect(refused.body.errors).toEqual([
      expect.objectContaining({ field: 'new_password', code: 'length' }),
    ]);

    const start = await request(server())
      .post('/api/v1/me/mfa/totp')
      .set('Authorization', auth)
      .expect(200);
    await request(server())
      .post('/api/v1/me/mfa/totp/confirm')
      .set('Authorization', auth)
      .send({ code: codeFor(start.body.secret) })
      .expect(200);
    await change('tenchars!!').expect(200);
  });

  it('refuses common passwords and passwords containing the e-mail name', async () => {
    const address = email('rules');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const auth = `Bearer ${(await login(from(), address, LONG)).body.access_token}`;
    const name = address.split('@')[0]!;
    const refused = await request(server())
      .post('/api/v1/me/password')
      .set('Authorization', auth)
      .send({ current_password: LONG, new_password: `${name} is my long password` })
      .expect(400);
    expect(refused.body.errors.map((e: { code: string }) => e.code)).toEqual(['not_email']);
    const common = await request(server())
      .post('/api/v1/me/password')
      .set('Authorization', auth)
      .send({ current_password: LONG, new_password: '1qaz2wsx3edc4rfv' })
      .expect(400);
    expect(common.body.errors.map((e: { code: string }) => e.code)).toContain('not_common');
  });

  it('turns MFA off only after a step-up, with a 15-character password and no company rule (G16)', async () => {
    const address = email('g16');
    const { membershipIds } = await createMember(env.owner, address, LONG, [a.tenantId]);
    const auth = `Bearer ${(await login(from(), address, LONG)).body.access_token}`;
    const start = await request(server())
      .post('/api/v1/me/mfa/totp')
      .set('Authorization', auth)
      .expect(200);
    await request(server())
      .post('/api/v1/me/mfa/totp/confirm')
      .set('Authorization', auth)
      .send({ code: codeFor(start.body.secret) })
      .expect(200);
    // The confirmation counts as a fresh MFA check; pretend it was long ago.
    await env.owner.query('UPDATE identity.sessions SET mfa_verified_at = NULL');
    const off = () => request(server()).delete('/api/v1/me/mfa').set('Authorization', auth);
    expect((await off().expect(403)).body.code).toBe('step_up_required');
    await request(server())
      .post('/api/v1/auth/step-up')
      .set('Authorization', auth)
      .send({ code: codeFor(start.body.secret, 1) })
      .expect(200);

    // A short password (allowed only with MFA) keeps MFA on.
    await request(server())
      .post('/api/v1/me/password')
      .set('Authorization', auth)
      .send({ current_password: LONG, new_password: 'tenchars!!' })
      .expect(200);
    expect((await off().expect(409)).body.detail).toMatch(/15 characters/);
    await request(server())
      .post('/api/v1/me/password')
      .set('Authorization', auth)
      .send({ current_password: 'tenchars!!', new_password: LONG })
      .expect(200);

    // The Owner role always requires MFA (§5.4).
    await env.owner.query(
      `INSERT INTO app.roles (id, tenant_id, key, name, origin, is_protected) VALUES ($1, $2, 'owner', 'Owner', 'template', true)`,
      [uuidv7(), a.tenantId],
    );
    await env.owner.query(
      `INSERT INTO app.membership_roles (tenant_id, membership_id, role_id)
       SELECT $1, $2, id FROM app.roles WHERE tenant_id = $1 AND key = 'owner'`,
      [a.tenantId, membershipIds[0]],
    );
    expect((await off().expect(409)).body.detail).toMatch(/requires MFA/);
    await env.owner.query('DELETE FROM app.membership_roles WHERE membership_id = $1', [
      membershipIds[0],
    ]);
    await off().expect(200);
    expect(
      (await request(server()).get('/api/v1/me').set('Authorization', auth)).body.mfa.enrolled,
    ).toBe(false);
  });
});

describe('forgotten password (§5.3.7, AC-U04)', () => {
  it('works once from the newest link, ends every session and confirms by e-mail', async () => {
    const addr = from();
    const address = email('acu04');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const other = await login(addr, address, LONG).expect(200);
    const otherRefresh = cookie(other, 'erp_rt')!;

    const forgot = (to: string) =>
      request(server())
        .post('/api/v1/auth/password/forgot')
        .set('X-Forwarded-For', addr)
        .send({ email: to });
    const answer = await forgot(address).expect(202);
    expect((await forgot(email('nobody')).expect(202)).text).toBe(answer.text); // same answer
    await forgot(address).expect(202);
    const links = (await emails(env, address)).filter((m) => m.template === 'password_reset');
    expect(links).toHaveLength(2);
    expect(links[0]!.data.expires_minutes).toBe('30');
    const [first, second] = links.map((m) => tokenFromLink(m.data.link!));

    const reset = (token: string) =>
      request(server())
        .post('/api/v1/auth/password/reset')
        .set('X-Forwarded-For', addr)
        .send({ token, password: 'a brand new long passphrase' });
    expect((await reset(first!).expect(400)).body.code).toBe('link_invalid'); // older link ended
    await reset(second!).expect(200);
    await reset(second!).expect(400); // once only

    await request(server())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${other.body.access_token}`)
      .expect(401);
    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', `erp_rt=${otherRefresh}`)
      .expect(401);
    expect((await emails(env, address)).map((m) => m.template)).toContain('password_changed');
    await login(addr, address, LONG).expect(401);
    await login(addr, address, 'a brand new long passphrase').expect(200);
  });
});

describe('lockout (§5.3.8)', () => {
  it('locks after 10 failures in 15 minutes, answers as usual, and e-mails a reset link', async () => {
    const addr = from();
    const address = email('lock');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    for (let i = 0; i < 10; i++) await login(addr, address, `wrong password ${i}`).expect(401);
    const locked = await login(addr, address, LONG);
    expect(locked.status).toBe(401); // even the right password, while locked
    expect(locked.body.code).toBe('invalid_credentials');
    const notice = (await emails(env, address)).filter((m) => m.template === 'account_locked');
    expect(notice).toHaveLength(1);
    expect(notice[0]!.data.minutes).toBe('15');
    // "This wasn't me": the link resets the password, and the reset ends the lock.
    await request(server())
      .post('/api/v1/auth/password/reset')
      .set('X-Forwarded-For', addr)
      .send({ token: tokenFromLink(notice[0]!.data.link!), password: 'after the lock passphrase' })
      .expect(200);
    await login(addr, address, 'after the lock passphrase').expect(200);
  });

  it('rate-limits forgotten-password requests per address with Retry-After', async () => {
    const addr = from();
    let last;
    for (let i = 0; i < 11; i++) {
      last = await request(server())
        .post('/api/v1/auth/password/forgot')
        .set('X-Forwarded-For', addr)
        .send({ email: email('rl') });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.code).toBe('rate_limited');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('sessions and e-mail (§5.3.8, §5.3.10, §5.3.11)', () => {
  it('lists sessions and signs another one out', async () => {
    const addr = from();
    const address = email('sessions');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const one = await login(addr, address, LONG, { device_id: 'device-one-0000000001' });
    const two = await login(addr, address, LONG, { device_id: 'device-two-0000000002' });
    const auth = `Bearer ${one.body.access_token}`;
    const list = await request(server())
      .get('/api/v1/me/sessions')
      .set('Authorization', auth)
      .expect(200);
    expect(list.body.data).toHaveLength(2);
    const otherId = list.body.data.find((s: { current: boolean }) => !s.current).id;
    await request(server())
      .delete(`/api/v1/me/sessions/${otherId}`)
      .set('Authorization', auth)
      .expect(200);
    await request(server())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${two.body.access_token}`)
      .expect(401);
    // The second device was new for someone who had signed in before: they were told.
    expect((await emails(env, address)).map((m) => m.template)).toEqual(['new_sign_in']);
  });

  it('changes the e-mail only after the new address confirms', async () => {
    const addr = from();
    const address = email('old');
    const next = email('new');
    await createMember(env.owner, address, LONG, [a.tenantId]);
    const auth = `Bearer ${(await login(addr, address, LONG)).body.access_token}`;
    await request(server())
      .post('/api/v1/me/email')
      .set('Authorization', auth)
      .send({ new_email: next, password: LONG })
      .expect(202);
    expect((await emails(env, address)).map((m) => m.template)).toContain('email_change_notice');
    const confirm = (await emails(env, next)).find((m) => m.template === 'email_change_confirm')!;
    await login(addr, next, LONG).expect(401); // not yet
    await request(server())
      .post('/api/v1/auth/email/confirm')
      .send({ token: tokenFromLink(confirm.data.link!) })
      .expect(200);
    await login(addr, next, LONG).expect(200);
    await login(addr, address, LONG).expect(401);
  });
});
