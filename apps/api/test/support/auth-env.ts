import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { uuidv7, type EmailJob } from '@erp/contracts';
import { prepareTestDatabase, type TestDatabase } from '@erp/db/testing';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { redisConnection } from '../../src/common/redis-connection';
import { hashPassword } from '../../src/modules/auth/passwords';
import { base32Decode, hotp, timeStep } from '../../src/modules/auth/totp';

// The auth e2e suites: a database built from the migrations (the API connects as app_user and
// app_auth), Redis keys and the e-mail queue under a prefix of their own, no failure delay.

export const WEB = 'http://localhost:5173';

export type AuthEnv = { db: TestDatabase; owner: pg.Client; mail: Queue; app: INestApplication };

/** `extra`: test-only modules (probe controllers) that run behind the real global guards. */
export async function startAuthEnv(name: string, extra: Type[] = []): Promise<AuthEnv> {
  const db = await prepareTestDatabase(name);
  const prefix = `erp-test-${uuidv7()}`;
  Object.assign(process.env, {
    DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    REDIS_KEY_PREFIX: `${prefix}:`,
    QUEUE_PREFIX: prefix,
    AUTH_FAILURE_DELAY_MS: '0',
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  });
  delete process.env.AUTH_JWKS;
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();
  const mail = new Queue('email', { connection: redisConnection(), prefix });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...extra] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return { db, owner, mail, app };
}

export async function stopAuthEnv(env: AuthEnv | undefined): Promise<void> {
  await env?.app.close();
  await env?.mail.obliterate({ force: true });
  await env?.mail.close();
  await env?.owner.end();
}

/** The e-mails queued so far, oldest first, as the worker would receive them. */
export async function emails(env: AuthEnv, to?: string): Promise<Required<EmailJob>[]> {
  const jobs = await env.mail.getJobs([
    'waiting',
    'delayed',
    'active',
    'completed',
    'failed',
    'prioritized',
  ]);
  return jobs
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((j) => j.data as Required<EmailJob>)
    .filter((j) => !to || j.to === to);
}

export function tokenFromLink(link: string): string {
  return link.split('/').pop()!;
}

/** A member account with a password, active in each of `tenants`. */
export async function createMember(
  owner: pg.Client,
  email: string,
  password: string,
  tenants: string[],
): Promise<{ userId: string; membershipIds: string[] }> {
  const userId = uuidv7();
  await owner.query(
    `INSERT INTO identity.users (id, email, email_normalized, name) VALUES ($1, $2, lower($2), $3)`,
    [userId, email, email.split('@')[0]],
  );
  await owner.query(
    `INSERT INTO identity.credentials (id, user_id, kind, hash, algorithm, single_factor_ok)
     VALUES ($1, $2, 'password', $3, 'argon2id', $4)`,
    [uuidv7(), userId, await hashPassword(password), [...password].length >= 15],
  );
  const membershipIds: string[] = [];
  for (const tenantId of tenants) {
    const id = uuidv7();
    await owner.query(
      `INSERT INTO app.memberships (id, tenant_id, user_id, kind, display_name, status)
       VALUES ($1, $2, $3, 'member', $4, 'active')`,
      [id, tenantId, userId, email],
    );
    membershipIds.push(id);
  }
  return { userId, membershipIds };
}

/** The current code of an authenticator set up with `secret` (base32), as the app would show. */
export function codeFor(secret: string, offsetSteps = 0): string {
  return hotp(base32Decode(secret), timeStep() + BigInt(offsetSteps));
}

/** The value of a cookie set by a response. */
export function cookie(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const found = list.find((c: string) => c.startsWith(`${name}=`));
  return found?.split(';')[0]!.slice(name.length + 1) || undefined;
}

export function setCookieHeader(
  response: { headers: Record<string, unknown> },
  name: string,
): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.find((c: string) => c.startsWith(`${name}=`)) ?? '';
}
