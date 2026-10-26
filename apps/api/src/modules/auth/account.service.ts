import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenClaims, Me } from '@erp/contracts';
import { ProblemException } from '../../common/problem';
import type { Account, AccountStore, Realm } from './account-store';
import { AuthDatabase } from './auth-database.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { randomToken, sha256 } from './crypto';
import { LinksService } from './links.service';
import { MailerService } from './mailer.service';
import { MfaService } from './mfa.service';
import {
  ARGON2_ALGORITHM,
  ARGON2_PARAMS,
  assertPasswordAllowed,
  hashPassword,
  singleFactorOk,
  verifyPassword,
} from './passwords';
import { RateLimitService, LIMITS } from './rate-limit.service';
import { SessionsService, type ClientMeta } from './sessions.service';
import { localeOf, normalizeEmail, SignInService } from './sign-in.service';
import { base32Encode } from './totp';

// Account security self-service (Part 05 §5.3.7, §5.3.9–5.3.11) and the staff setup link (D5).

/** A step-up (§10.6) counts for 10 minutes. */
const STEP_UP_MS = 10 * 60_000;
const RESET_MINUTES = 30;
const EMAIL_CHANGE_HOURS = 24;

@Injectable()
export class AccountService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly authDb: AuthDatabase,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly links: LinksService,
    private readonly mailer: MailerService,
    private readonly limits: RateLimitService,
    private readonly signIn: SignInService,
  ) {}

  private get members(): AccountStore {
    return this.authDb.store('member');
  }

  async me(claims: AccessTokenClaims): Promise<Me> {
    const account = await this.account(this.members, claims.sub);
    const credential = await this.credential(this.members, account.id);
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      locale: account.locale,
      mfa: {
        enrolled: await this.mfa.isEnrolled(this.members, account.id),
        required: await this.members.mfaRequiredByCompany(account.id),
      },
      password_single_factor_ok: credential?.singleFactorOk ?? false,
      membership_id: claims.mid ?? null,
    };
  }

  // ── Forgotten password (§5.3.7) ──────────────────────────────────────────────────────

  /** Always the same answer; a link goes out only to an existing, active account. */
  async forgotPassword(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const perEmail = await this.limits.take(LIMITS.forgotPerEmail, sha256(normalized));
    if (!perEmail.ok) return; // quietly: the answer must not differ
    const account = await this.members.findByEmail(normalized);
    if (!account || account.status !== 'active') return;
    const token = await this.links.issue(this.members, account.id, 'reset', RESET_MINUTES);
    await this.mailer.send({
      template: 'password_reset',
      to: account.email,
      locale: localeOf(account),
      data: {
        name: account.name,
        link: `${this.config.webUrl}/reset/${token}`,
        expires_minutes: String(RESET_MINUTES),
      },
    });
  }

  /** Sets a new password from a reset, lockout or first-password link; ends every session. */
  async resetPassword(token: string, password: string): Promise<void> {
    const link = await this.links.peek(this.members, token, ['reset', 'lockout', 'setup']);
    const account = await this.account(this.members, link.userId);
    const mfa = await this.mfa.isEnrolled(this.members, account.id);
    assertPasswordAllowed(password, { mfa, email: account.email });
    await this.links.consume(this.members, link.id);
    await this.setPassword(this.members, account.id, password);
    if (account.status === 'invited') {
      await this.members.db.user.update({ where: { id: account.id }, data: { status: 'active' } });
    }
    await this.sessions.revoke(this.members, { userId: account.id }, 'password_reset');
    await this.signIn.clearFailures('member', account.emailNormalized);
    await this.mailer.send({
      template: 'password_changed',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name },
    });
  }

  // ── Change password (§5.3.10) ────────────────────────────────────────────────────────

  async changePassword(claims: AccessTokenClaims, current: string, next: string): Promise<void> {
    const account = await this.account(this.members, claims.sub);
    const credential = await this.credential(this.members, account.id);
    if (!credential || !(await verifyPassword(credential.hash, current))) {
      throw new ProblemException('validation_failed', 'The current password is not right', {
        errors: [{ field: 'current_password', message: 'The current password is not right' }],
      });
    }
    const mfa = await this.mfa.isEnrolled(this.members, account.id);
    assertPasswordAllowed(next, { mfa, email: account.email }, 'new_password');
    await this.setPassword(this.members, account.id, next);
    await this.sessions.revoke(
      this.members,
      { userId: account.id, notId: claims.sid },
      'password_changed',
    );
    await this.mailer.send({
      template: 'password_changed',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name },
    });
  }

  // ── MFA (§5.3.9) ─────────────────────────────────────────────────────────────────────

  async startTotp(claims: AccessTokenClaims) {
    const account = await this.account(this.members, claims.sub);
    // Replacing an authenticator someone already has needs a fresh check of the old one.
    if (await this.mfa.isEnrolled(this.members, account.id))
      await this.assertStepUp(this.members, claims);
    const { secret, uri } = await this.mfa.startEnrolment(
      this.members,
      account.id,
      account.email,
      'ERP System',
    );
    return { secret: base32Encode(secret), otpauth_uri: uri };
  }

  async confirmTotp(claims: AccessTokenClaims, code: string): Promise<string[]> {
    const account = await this.account(this.members, claims.sub);
    const codes = await this.mfa.confirmEnrolment(this.members, account.id, code);
    if (!codes) throw new ProblemException('mfa_invalid');
    await this.members.updateSession(claims.sid, { mfaVerifiedAt: new Date() });
    await this.mailer.send({
      template: 'mfa_changed',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name, change: 'enabled' },
    });
    return codes;
  }

  /** Turning MFA off (gap G16): after a step-up, never with a short password or a company rule. */
  async disableMfa(claims: AccessTokenClaims): Promise<void> {
    const account = await this.account(this.members, claims.sub);
    await this.assertStepUp(this.members, claims);
    const credential = await this.credential(this.members, account.id);
    if (await this.members.mfaRequiredByCompany(account.id)) {
      throw new ProblemException(
        'conflict',
        'Your company requires MFA, so it cannot be turned off',
      );
    }
    if (!credential?.singleFactorOk) {
      throw new ProblemException(
        'conflict',
        'Set a password of at least 15 characters before turning MFA off',
      );
    }
    await this.mfa.disable(this.members, account.id);
    await this.mailer.send({
      template: 'mfa_changed',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name, change: 'disabled' },
    });
  }

  async regenerateRecoveryCodes(claims: AccessTokenClaims): Promise<string[]> {
    await this.assertStepUp(this.members, claims);
    if (!(await this.mfa.isEnrolled(this.members, claims.sub))) {
      throw new ProblemException('conflict', 'Turn on MFA first');
    }
    const codes = await this.mfa.replaceRecoveryCodes(this.members, claims.sub);
    const account = await this.account(this.members, claims.sub);
    await this.mailer.send({
      template: 'mfa_changed',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name, change: 'recovery_codes_replaced' },
    });
    return codes;
  }

  /** Re-checks MFA for a sensitive action (§10.6); valid for 10 minutes. */
  async stepUp(
    realm: Realm,
    claims: AccessTokenClaims,
    input: { code?: string; recovery_code?: string },
    meta: ClientMeta,
  ): Promise<void> {
    await this.limits.enforce(LIMITS.stepUpPerSession, claims.sid);
    // Wrong codes count towards the account's sign-in lock (QA finding F6).
    await this.signIn.checkSecondFactor(realm, claims.sub, meta, (store) =>
      this.mfa.check(store, claims.sub, input),
    );
    await this.authDb.store(realm).updateSession(claims.sid, { mfaVerifiedAt: new Date() });
  }

  // ── Sessions (§5.3.10) ───────────────────────────────────────────────────────────────

  async listSessions(realm: Realm, claims: AccessTokenClaims) {
    const rows = await this.authDb.store(realm).listSessions(claims.sub);
    return rows.map((s) => ({
      id: s.id,
      client: s.client as 'web' | 'desktop',
      user_agent: s.userAgent,
      ip: s.ip,
      created_at: s.createdAt.toISOString(),
      last_seen_at: s.lastSeenAt.toISOString(),
      current: s.id === claims.sid,
    }));
  }

  async revokeSession(realm: Realm, claims: AccessTokenClaims, sessionId: string): Promise<void> {
    const ids = await this.sessions.revoke(
      this.authDb.store(realm),
      { userId: claims.sub, id: sessionId },
      'signed_out',
    );
    if (ids.length === 0) throw new ProblemException('not_found');
  }

  // ── Change of e-mail (§5.3.11) ───────────────────────────────────────────────────────

  async requestEmailChange(
    claims: AccessTokenClaims,
    newEmail: string,
    password: string,
  ): Promise<void> {
    const account = await this.account(this.members, claims.sub);
    const credential = await this.credential(this.members, account.id);
    if (!credential || !(await verifyPassword(credential.hash, password))) {
      throw new ProblemException('validation_failed', 'The password is not right', {
        errors: [{ field: 'password', message: 'The password is not right' }],
      });
    }
    const normalized = normalizeEmail(newEmail);
    // Taken or the same: answer as usual and send nothing, so addresses cannot be probed.
    if (normalized === account.emailNormalized || (await this.members.findByEmail(normalized)))
      return;
    const raw = randomToken();
    await this.members.db.emailChange.updateMany({
      where: { userId: account.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.members.db.emailChange.create({
      data: {
        userId: account.id,
        newEmail: newEmail.trim(),
        newEmailNormalized: normalized,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_HOURS * 3_600_000),
      },
    });
    await this.mailer.send({
      template: 'email_change_confirm',
      to: newEmail.trim(),
      locale: localeOf(account),
      data: {
        name: account.name,
        link: `${this.config.webUrl}/email/confirm/${raw}`,
        new_email: newEmail.trim(),
      },
    });
    await this.mailer.send({
      template: 'email_change_notice',
      to: account.email,
      locale: localeOf(account),
      data: { name: account.name, new_email: newEmail.trim() },
    });
  }

  async confirmEmailChange(token: string): Promise<void> {
    const change = await this.members.db.emailChange.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!change || change.usedAt || change.expiresAt <= new Date()) {
      throw new ProblemException('link_invalid');
    }
    if (await this.members.findByEmail(change.newEmailNormalized)) {
      throw new ProblemException('conflict', 'That address is already in use');
    }
    const used = await this.members.db.emailChange.updateMany({
      where: { id: change.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) throw new ProblemException('link_invalid');
    await this.members.db.user.update({
      where: { id: change.userId },
      data: { email: change.newEmail, emailNormalized: change.newEmailNormalized },
    });
  }

  // ── Staff (D5) ───────────────────────────────────────────────────────────────────────

  async staffMe(claims: AccessTokenClaims) {
    const store = this.authDb.store('staff');
    const account = await this.account(store, claims.sub);
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      roles: await store.staffRoles(account.id),
    };
  }

  async staffSetupInfo(token: string) {
    const store = this.authDb.store('staff');
    const link = await this.links.peek(store, token, ['setup', 'reset']);
    const account = await this.account(store, link.userId);
    return { email: account.email, name: account.name };
  }

  /** The first password from the setup link; MFA is enrolled at the first sign-in. */
  async completeStaffSetup(token: string, password: string): Promise<void> {
    const store = this.authDb.store('staff');
    const link = await this.links.peek(store, token, ['setup', 'reset']);
    const account = await this.account(store, link.userId);
    if (account.status === 'suspended' || account.status === 'removed')
      throw new ProblemException('link_invalid');
    // Staff always use MFA, so the MFA minimum applies.
    assertPasswordAllowed(password, { mfa: true, email: account.email });
    await this.links.consume(store, link.id);
    await this.setPassword(store, account.id, password);
    if (account.status === 'invited') await store.activateStaff(account.id);
    await this.sessions.revoke(store, { userId: account.id }, 'password_reset');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────────────

  private async account(store: AccountStore, id: string): Promise<Account> {
    const account = await store.findById(id);
    if (!account) throw new ProblemException('unauthenticated');
    return account;
  }

  private credential(store: AccountStore, userId: string) {
    return store.t.credential.findUnique({ where: { userId_kind: { userId, kind: 'password' } } });
  }

  private async setPassword(store: AccountStore, userId: string, password: string): Promise<void> {
    const data = {
      hash: await hashPassword(password),
      algorithm: ARGON2_ALGORITHM,
      params: { ...ARGON2_PARAMS },
      singleFactorOk: singleFactorOk(password),
      changedAt: new Date(),
    };
    await store.t.credential.upsert({
      where: { userId_kind: { userId, kind: 'password' } },
      create: { userId, kind: 'password', ...data },
      update: data,
    });
  }

  private async assertStepUp(store: AccountStore, claims: AccessTokenClaims): Promise<void> {
    const session = await store.findSession(claims.sid);
    const at = session?.mfaVerifiedAt?.getTime() ?? 0;
    if (Date.now() - at > STEP_UP_MS) {
      throw new ProblemException('step_up_required', 'Enter a code from your authenticator first');
    }
  }
}
