import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenClaims, SignedIn } from '@erp/contracts';
import { ProblemException } from '../../common/problem';
import { RedisService } from '../redis/redis.service';
import { summary, type Account, type AccountStore, type MembershipRow } from './account-store';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { randomToken, sha256 } from './crypto';
import { TokenService } from './token.service';

// Sessions and refresh tokens (§10.6): one session per sign-in, refresh tokens rotated on
// every use; reusing an old one revokes the whole family (theft detection). Members' sessions
// last 30 days at most; staff sessions end after 30 minutes without use (D5).

export type ClientMeta = {
  client: 'web' | 'desktop';
  ip: string | null;
  userAgent: string | null;
  deviceId?: string;
};

export type Started = { body: SignedIn; refreshToken: string; sessionId: string };

@Injectable()
export class SessionsService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
  ) {}

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
    // Conditional: of two requests with the same token, only one wins; the other is reuse.
    const used = await store.t.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) {
      await this.revoke(store, { userId: session.userId, id: session.id }, 'refresh_reuse');
      throw new ProblemException('unauthenticated', 'Sign in again');
    }

    const memberships = await store.memberships(session.userId);
    const current = memberships.find((m) => m.membership_id === session.membershipId) ?? null;
    await store.updateSession(session.id, {
      lastSeenAt: new Date(),
      ...(session.membershipId && !current ? { membershipId: null } : {}),
    });
    const refreshToken = await this.newRefreshToken(
      store,
      session.id,
      row.familyId,
      session.expiresAt,
    );
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

  private async newRefreshToken(
    store: AccountStore,
    sessionId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<string> {
    const raw = randomToken();
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
            pv: membership.permissions_version,
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
