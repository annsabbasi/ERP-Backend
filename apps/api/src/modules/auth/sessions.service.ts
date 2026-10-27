import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenClaims, SignedIn } from '@erp/contracts';
import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ProblemException } from '../../common/problem';
import { RedisService } from '../redis/redis.service';
import { summary, type Account, type AccountStore, type MembershipRow } from './account-store';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { deriveKey, randomToken, sha256 } from './crypto';
import { TokenService } from './token.service';

// Sessions and refresh tokens (§10.6): one session per sign-in, refresh tokens rotated on
// every use; reusing an old one revokes the whole family (theft detection). Members' sessions
// last 30 days at most; staff sessions end after 30 minutes without use (D5).
//
// Grace window (QA ruling, 27 Oct): for 30 seconds after a rotation, the token just replaced is
// accepted again and answered with the same successor, so a retry after a dropped response or
// a parallel request does not sign the person out. Each successor is an HMAC of the token it
// replaces under a server key, so it can be given again without being stored.

/** How long a just-rotated refresh token still gets its successor. */
export const REFRESH_GRACE_MS = 30_000;

export type ClientMeta = {
  client: 'web' | 'desktop';
  ip: string | null;
  userAgent: string | null;
  deviceId?: string;
};

export type Started = { body: SignedIn; refreshToken: string; sessionId: string };

@Injectable()
export class SessionsService {
  private readonly successorKey: Buffer;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
  ) {
    // Local-only mode without a key in .env: one for this process.
    this.successorKey = deriveKey(config.encryptionKey ?? randomBytes(32), 'refresh-successor');
  }

  async start(
    store: AccountStore,
    account: Account,
    meta: ClientMeta,
    amr: string[],
  ): Promise<Started> {
    const memberships = await store.memberships(account.id);
    const chosen = memberships.length === 1 ? memberships[0]! : null;
    const expiresAt = new Date(Date.now() + this.config.sessionDays * 86_400_000);
    const session = await store.createSession({
      userId: account.id,
      client: meta.client,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      deviceHash: meta.deviceId ? sha256(meta.deviceId) : null,
      amr,
      expiresAt,
      // A sign-in with an authenticator code counts as a fresh MFA check.
      mfaVerifiedAt: amr.includes('otp') ? new Date() : null,
      membershipId: chosen?.membership_id ?? null,
    });
    const refreshToken = await this.newRefreshToken(store, session.id, session.id, expiresAt);
    await store.markSignedIn(account.id);
    return {
      body: await this.signedIn(store, account.id, session.id, amr, chosen, memberships),
      refreshToken,
      sessionId: session.id,
    };
  }

  /** Rotates a refresh token. Throws 401 unauthenticated, revoking the family on reuse. */
  async refresh(store: AccountStore, raw: string): Promise<Started> {
    const row = await store.t.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!row) throw new ProblemException('unauthenticated', 'Sign in again');
    const session = await store.findSession(row.sessionId);
    if (!session) throw new ProblemException('unauthenticated', 'Sign in again');

    if (row.usedAt || row.revokedAt) {
      const successor = await this.graceSuccessor(store, raw, session);
      if (successor) return this.answer(store, session, successor);
      // An old token came back: someone else may hold a copy. End the whole family.
      await this.revoke(store, { userId: session.userId, id: session.id }, 'refresh_reuse');
      throw new ProblemException('unauthenticated', 'Sign in again');
    }
    const now = Date.now();
    const idleLimit = this.config.staffIdleMinutes * 60_000;
    if (
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      row.expiresAt.getTime() <= now ||
      (store.realm === 'staff' && now - session.lastSeenAt.getTime() > idleLimit)
    ) {
      if (!session.revokedAt) {
        const reason =
          store.realm === 'staff' && session.expiresAt.getTime() > now ? 'idle' : 'expired';
        await this.revoke(store, { userId: session.userId, id: session.id }, reason);
      }
      throw new ProblemException('unauthenticated', 'Sign in again');
    }
    // Conditional: of two requests with the same token, only one rotates it; the other gets
    // the same successor through the grace window.
    const used = await store.t.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) {
      const successor = await this.graceSuccessor(store, raw, session);
      if (successor) return this.answer(store, session, successor);
      await this.revoke(store, { userId: session.userId, id: session.id }, 'refresh_reuse');
      throw new ProblemException('unauthenticated', 'Sign in again');
    }
    const refreshToken = await this.newRefreshToken(
      store,
      session.id,
      row.familyId,
      session.expiresAt,
      raw,
    );
    return this.answer(store, session, refreshToken);
  }

  /**
   * The successor of a token rotated in the last 30 seconds, if that successor is still unused
   * and the session alive; null otherwise (then it is reuse). The request that rotated it may
   * still be writing the successor, so it is looked for a few times.
   */
  private async graceSuccessor(
    store: AccountStore,
    raw: string,
    session: { revokedAt: Date | null; expiresAt: Date },
  ): Promise<string | null> {
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    const row = await store.t.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!row?.usedAt || row.revokedAt) return null;
    if (Date.now() - row.usedAt.getTime() > REFRESH_GRACE_MS) return null;
    const next = this.successorOf(raw);
    for (let attempt = 0; attempt < 10; attempt++) {
      const successor = await store.t.refreshToken.findUnique({
        where: { tokenHash: sha256(next) },
      });
      if (successor) return successor.usedAt || successor.revokedAt ? null : next;
      await sleep(50);
    }
    return null;
  }

  private successorOf(raw: string): string {
    return createHmac('sha256', this.successorKey).update(raw).digest('base64url');
  }

  /** The signed-in answer for a session, with its current company if still open to the person. */
  private async answer(
    store: AccountStore,
    session: { id: string; userId: string; amr: string[]; membershipId: string | null },
    refreshToken: string,
  ): Promise<Started> {
    const memberships = await store.memberships(session.userId);
    const current = memberships.find((m) => m.membership_id === session.membershipId) ?? null;
    await store.updateSession(session.id, {
      lastSeenAt: new Date(),
      ...(session.membershipId && !current ? { membershipId: null } : {}),
    });
    return {
      body: await this.signedIn(
        store,
        session.userId,
        session.id,
        session.amr,
        current,
        memberships,
      ),
      refreshToken,
      sessionId: session.id,
    };
  }

  /** A new access token for another of the person's companies (§5.3.5). */
  async switch(
    store: AccountStore,
    claims: AccessTokenClaims,
    membershipId: string,
  ): Promise<SignedIn> {
    const memberships = await store.memberships(claims.sub);
    const target = memberships.find((m) => m.membership_id === membershipId);
    // Not one of theirs, or not active: not found, so other companies' ids reveal nothing.
    if (!target) throw new ProblemException('not_found');
    await store.updateSession(claims.sid, { membershipId, lastSeenAt: new Date() });
    return this.signedIn(store, claims.sub, claims.sid, claims.amr, target, memberships);
  }

  async revoke(
    store: AccountStore,
    where: { userId: string; id?: string; notId?: string },
    reason: string,
  ): Promise<string[]> {
    const ids = await store.revokeSessions(where, reason);
    // Access tokens live 10 minutes; the guard refuses those of revoked sessions at once.
    for (const id of ids) {
      await this.redis.client.set(
        this.revokedKey(id),
        reason,
        'EX',
        this.config.accessTokenSeconds + 60,
      );
    }
    return ids;
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(this.revokedKey(sessionId))) === 1;
  }

  private revokedKey(sessionId: string): string {
    return this.redis.key('auth', 'revoked', sessionId);
  }

  /** A new refresh token: random at sign-in, derived from the token it replaces on rotation. */
  private async newRefreshToken(
    store: AccountStore,
    sessionId: string,
    familyId: string,
    expiresAt: Date,
    replaces?: string,
  ): Promise<string> {
    const raw = replaces ? this.successorOf(replaces) : randomToken();
    await store.t.refreshToken.create({
      data: { sessionId, familyId, tokenHash: sha256(raw), expiresAt },
    });
    return raw;
  }

  private async signedIn(
    store: AccountStore,
    userId: string,
    sessionId: string,
    amr: string[],
    membership: MembershipRow | null,
    memberships: MembershipRow[],
  ): Promise<SignedIn> {
    const { token, expiresIn } = await this.tokens.sign({
      sub: userId,
      sid: sessionId,
      aud: store.realm === 'staff' ? 'console' : 'app',
      amr,
      ...(membership
        ? {
            mid: membership.membership_id,
            tid: membership.tenant_id,
            // The access version (Part 10 §10.7.3): member's plus company's.
            pv: membership.permissions_version + membership.entitlements_version,
          }
        : {}),
    });
    return {
      status: 'signed_in',
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      membership: membership ? summary(membership) : null,
      memberships: memberships.map(summary),
    };
  }
}
