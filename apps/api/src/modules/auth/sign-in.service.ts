import { Inject, Injectable } from '@nestjs/common';
import type { LoginResponse } from '@erp/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import { ProblemException } from '../../common/problem';
import { RedisService } from '../redis/redis.service';
import type { Account, AccountStore, Realm } from './account-store';
import { AuthDatabase } from './auth-database.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { randomToken, sha256 } from './crypto';
import { LinksService } from './links.service';
import { MailerService } from './mailer.service';
import { MfaService } from './mfa.service';
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword } from './passwords';
import { SessionsService, type ClientMeta, type Started } from './sessions.service';
import { base32Encode } from './totp';

// Sign-in (Part 05 §5.3.4, §5.3.8): the same answer for an unknown e-mail and a wrong
// password, a growing delay after failures, a 15-minute lock after 10 failures in 15 minutes
// with a "this wasn't me" e-mail, then the second factor. Staff enrol an authenticator at
// their first sign-in (D5).

export const LOCK_FAILURES = 10;
const LOCK_WINDOW_MS = 15 * 60_000;
const CHALLENGE_SECONDS = 300;
const CHALLENGE_ATTEMPTS = 5;

type Challenge = {
  realm: Realm;
  userId: string;
  purpose: 'verify' | 'enrol';
  meta: ClientMeta;
  attempts: number;
};

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

/** Delay before answering the nth failure in a row: none for the first three, then doubling. */
export function failureDelay(previousFailures: number, baseMs: number): number {
  if (baseMs <= 0 || previousFailures < 3) return 0;
  return Math.min(baseMs * 2 ** (previousFailures - 3), 8_000);
}

export type SignInResult = { response: LoginResponse; refreshToken?: string };

@Injectable()
export class SignInService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly authDb: AuthDatabase,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly links: LinksService,
    private readonly mailer: MailerService,
    private readonly redis: RedisService,
  ) {}

  async login(
    realm: Realm,
    input: { email: string; password: string; device_id?: string },
    meta: ClientMeta,
  ): Promise<SignInResult> {
    const store = this.authDb.store(realm);
    const email = normalizeEmail(input.email);
    const failures = await this.recentFailures(store, email);
    const account = await store.findByEmail(email);
    const credential = account
      ? await store.t.credential.findUnique({
          where: { userId_kind: { userId: account.id, kind: 'password' } },
        })
      : null;
    // Always one Argon2 check, so an unknown e-mail takes as long as a wrong password.
    const passwordOk =
      (await verifyPassword(credential?.hash ?? (await dummyPasswordHash()), input.password)) &&
      credential !== null;
    const locked = failures >= LOCK_FAILURES;
    const active = account?.status === 'active';

    if (!account || !passwordOk || !active || locked) {
      const reason = !account
        ? 'unknown_email'
        : locked
          ? 'locked'
          : !passwordOk
            ? 'bad_password'
            : 'inactive';
      await this.record(store, email, meta, false, reason);
      if (account && !locked && failures + 1 >= LOCK_FAILURES)
        await this.sendLockedNotice(store, account);
      await sleep(failureDelay(failures, this.config.failureDelayMs));
      // One answer for every case (§5.3.4): nothing tells whether the account exists.
      throw new ProblemException(
        'invalid_credentials',
        'Check the e-mail and password and try again',
      );
    }

    if (needsRehash(credential.hash)) {
      await store.t.credential.update({
        where: { id: credential.id },
        data: { hash: await hashPassword(input.password), changedAt: credential.changedAt },
      });
    }
    await this.record(store, email, meta, true, 'password');
    const loginMeta = { ...meta, deviceId: input.device_id };

    if (await this.mfa.isEnrolled(store, account.id)) {
      return { response: await this.challenge(realm, account.id, 'verify', loginMeta) };
    }
    if (realm === 'staff') {
      const issuer = 'ERP System Console';
      const enrolment = await this.mfa.startEnrolment(store, account.id, account.email, issuer);
      const challenge = await this.newChallenge({
        realm,
        userId: account.id,
        purpose: 'enrol',
        meta: loginMeta,
        attempts: 0,
      });
      return {
        response: {
          status: 'mfa_enrolment_required',
          challenge,
          secret: base32Encode(enrolment.secret),
          otpauth_uri: enrolment.uri,
        },
      };
    }
    return this.complete(store, account, loginMeta, ['pwd']);
  }

  /** The second factor after the password (§5.3.4 step 2). */
  async verifyMfa(
    realm: Realm,
    input: { challenge: string; code?: string; recovery_code?: string },
  ): Promise<SignInResult> {
    const { key, challenge } = await this.loadChallenge(realm, input.challenge, 'verify');
    const store = this.authDb.store(realm);
    const method = await this.mfa.check(store, challenge.userId, input);
    if (!method) return this.failChallenge(store, key, challenge);
    await this.redis.client.del(key);
    const account = await store.findById(challenge.userId);
    if (!account || account.status !== 'active') throw new ProblemException('mfa_invalid');
    if (method === 'recovery') {
      await this.mailer.send({
        template: 'mfa_changed',
        to: account.email,
        locale: localeOf(account),
        data: { name: account.name, change: 'recovery_code_used' },
      });
    }
    return this.complete(store, account, challenge.meta, [
      'pwd',
      method === 'otp' ? 'otp' : 'recovery',
    ]);
  }

  /** Staff confirm their first authenticator; they get their recovery codes once. */
  async confirmEnrolment(input: {
    challenge: string;
    code: string;
  }): Promise<SignInResult & { recoveryCodes: string[] }> {
    const { key, challenge } = await this.loadChallenge('staff', input.challenge, 'enrol');
    const store = this.authDb.store('staff');
    const codes = await this.mfa.confirmEnrolment(store, challenge.userId, input.code);
    if (!codes) {
      await this.failChallenge(store, key, challenge);
      throw new ProblemException('mfa_invalid');
    }
    await this.redis.client.del(key);
    const account = (await store.findById(challenge.userId))!;
    await this.mailer.send({
      template: 'mfa_changed',
      to: account.email,
      locale: 'en',
      data: { name: account.name, change: 'enabled' },
    });
    const result = await this.complete(store, account, challenge.meta, ['pwd', 'otp']);
    return { ...result, recoveryCodes: codes };
  }

  /** Marks a successful reset, so earlier failures no longer count towards a lock. */
  async clearFailures(realm: Realm, email: string): Promise<void> {
    const store = this.authDb.store(realm);
    await this.record(
      store,
      normalizeEmail(email),
      { client: 'web', ip: null, userAgent: null },
      true,
      'password_reset',
    );
  }

  private async complete(
    store: AccountStore,
    account: Account,
    meta: ClientMeta,
    amr: string[],
  ): Promise<SignInResult> {
    const device = meta.deviceId
      ? await store.knownDevice(account.id, sha256(meta.deviceId))
      : null;
    const started: Started = await this.sessions.start(store, account, meta, amr);
    // A new device for someone who has signed in before (§5.3.8): tell them.
    if (device && device.any && !device.known) {
      await this.mailer.send({
        template: 'new_sign_in',
        to: account.email,
        locale: localeOf(account),
        data: {
          name: account.name,
          when: new Date().toISOString(),
          device: meta.userAgent?.slice(0, 120) ?? meta.client,
        },
      });
    }
    return { response: started.body, refreshToken: started.refreshToken };
  }

  private async challenge(
    realm: Realm,
    userId: string,
    purpose: 'verify',
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    const challenge = await this.newChallenge({ realm, userId, purpose, meta, attempts: 0 });
    return { status: 'mfa_required', challenge, methods: ['totp', 'recovery_code'] };
  }

  private async newChallenge(data: Challenge): Promise<string> {
    const raw = randomToken();
    await this.redis.client.set(
      this.challengeKey(raw),
      JSON.stringify(data),
      'EX',
      CHALLENGE_SECONDS,
    );
    return raw;
  }

  private async loadChallenge(realm: Realm, raw: string, purpose: Challenge['purpose']) {
    const key = this.challengeKey(raw);
    const json = await this.redis.client.get(key);
    const challenge = json ? (JSON.parse(json) as Challenge) : null;
    if (!challenge || challenge.realm !== realm || challenge.purpose !== purpose) {
      throw new ProblemException('mfa_invalid', 'The sign-in expired; start again');
    }
    return { key, challenge };
  }

  private async failChallenge(
    store: AccountStore,
    key: string,
    challenge: Challenge,
  ): Promise<never> {
    const account = await store.findById(challenge.userId);
    if (account)
      await this.record(store, account.emailNormalized, challenge.meta, false, 'mfa_failed');
    if (challenge.attempts + 1 >= CHALLENGE_ATTEMPTS) {
      await this.redis.client.del(key);
    } else {
      await this.redis.client.set(
        key,
        JSON.stringify({ ...challenge, attempts: challenge.attempts + 1 }),
        'KEEPTTL',
      );
    }
    throw new ProblemException('mfa_invalid');
  }

  private challengeKey(raw: string): string {
    return this.redis.key('auth', 'challenge', sha256(raw));
  }

  /** Failures for this e-mail in the last 15 minutes, since its last success. */
  private async recentFailures(store: AccountStore, emailNormalized: string): Promise<number> {
    const since = new Date(Date.now() - LOCK_WINDOW_MS);
    const lastSuccess = await store.t.loginAttempt.findFirst({
      where: { emailNormalized, success: true, at: { gte: since } },
      orderBy: { at: 'desc' },
    });
    return store.t.loginAttempt.count({
      where: { emailNormalized, success: false, at: { gt: lastSuccess?.at ?? since } },
    });
  }

  private async record(
    store: AccountStore,
    emailNormalized: string,
    meta: ClientMeta,
    success: boolean,
    reason: string,
  ): Promise<void> {
    await store.t.loginAttempt.create({ data: { emailNormalized, ip: meta.ip, success, reason } });
  }

  /** "This wasn't me": the lock notice carries a link that resets the password (§5.3.8). */
  private async sendLockedNotice(store: AccountStore, account: Account): Promise<void> {
    const link =
      store.realm === 'member'
        ? `${this.config.webUrl}/reset/${await this.links.issue(store, account.id, 'lockout', 60)}`
        : `${this.config.consoleUrl}/signin`;
    await this.mailer.send({
      template: 'account_locked',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name, link, minutes: '15' },
    });
  }
}

export function localeOf(account: Account): 'en' | 'ur' {
  return account.locale === 'ur' ? 'ur' : 'en';
}
