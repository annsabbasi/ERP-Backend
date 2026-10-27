import { canEnterTenant, type MembershipSummary, type TenantStatus } from '@erp/contracts';
import type { PrismaClient } from '@erp/db';

// Where sign-in reads and writes, for members (identity.*) and platform staff
// (platform.staff_*, decision D5). Everything goes through the app_auth connection (ADR 0008).

export type Realm = 'member' | 'staff';

export type Account = {
  id: string;
  email: string;
  emailNormalized: string;
  name: string;
  locale: string;
  status: string;
};

export type MembershipRow = MembershipSummary & {
  status: string;
  tenant_status: string;
  permissions_version: number;
  entitlements_version: number;
  is_owner: boolean;
};

// The staff tables have the member tables' shape, with `userId` mapped to staff_user_id, so the
// staff delegates are used through the member delegate types. Only fields both share are used.
type Tables = {
  credential: PrismaClient['credential'];
  mfaFactor: PrismaClient['mfaFactor'];
  recoveryCode: PrismaClient['recoveryCode'];
  refreshToken: PrismaClient['refreshToken'];
  linkToken: PrismaClient['passwordReset'];
  loginAttempt: PrismaClient['loginAttempt'];
};

export class AccountStore {
  readonly t: Tables;

  constructor(
    readonly db: PrismaClient,
    readonly realm: Realm,
  ) {
    this.t =
      realm === 'member'
        ? {
            credential: db.credential,
            mfaFactor: db.mfaFactor,
            recoveryCode: db.recoveryCode,
            refreshToken: db.refreshToken,
            linkToken: db.passwordReset,
            loginAttempt: db.loginAttempt,
          }
        : {
            credential: db.staffCredential as unknown as Tables['credential'],
            mfaFactor: db.staffMfaFactor as unknown as Tables['mfaFactor'],
            recoveryCode: db.staffRecoveryCode as unknown as Tables['recoveryCode'],
            refreshToken: db.staffRefreshToken as unknown as Tables['refreshToken'],
            linkToken: db.staffSetupToken as unknown as Tables['linkToken'],
            loginAttempt: db.staffLoginAttempt as unknown as Tables['loginAttempt'],
          };
  }

  async findByEmail(emailNormalized: string): Promise<Account | null> {
    if (this.realm === 'member') {
      const user = await this.db.user.findUnique({
        where: { emailNormalized_accountKind: { emailNormalized, accountKind: 'member' } },
      });
      return user && { ...user };
    }
    const staff = await this.db.staffUser.findUnique({ where: { emailNormalized } });
    return staff && { ...staff, locale: 'en' };
  }

  async findById(id: string): Promise<Account | null> {
    if (this.realm === 'member') {
      const user = await this.db.user.findUnique({ where: { id } });
      return user && { ...user };
    }
    const staff = await this.db.staffUser.findUnique({ where: { id } });
    return staff && { ...staff, locale: 'en' };
  }

  async markSignedIn(id: string): Promise<void> {
    const data = { lastSignInAt: new Date() };
    if (this.realm === 'member') await this.db.user.update({ where: { id }, data });
    else
      await this.db.staffUser.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
  }

  async activateStaff(id: string): Promise<void> {
    await this.db.staffUser.update({
      where: { id },
      data: { status: 'active', updatedAt: new Date() },
    });
  }

  async staffRoles(id: string): Promise<string[]> {
    const rows = await this.db.staffRoleAssignment.findMany({ where: { staffUserId: id } });
    return rows.map((r) => r.roleKey).sort();
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────────────

  createSession(data: {
    userId: string;
    client: 'web' | 'desktop';
    ip: string | null;
    userAgent: string | null;
    deviceHash: string | null;
    amr: string[];
    expiresAt: Date;
    mfaVerifiedAt?: Date | null;
    membershipId?: string | null;
  }) {
    if (this.realm === 'member') {
      return this.db.session.create({ data: { ...data, audience: 'app' } });
    }
    const { membershipId: _m, ...staff } = data;
    void _m;
    return this.db.staffSession.create({ data: staff });
  }

  findSession(id: string) {
    return this.realm === 'member'
      ? this.db.session.findUnique({ where: { id } })
      : this.db.staffSession
          .findUnique({ where: { id } })
          .then((s) => s && { ...s, membershipId: null as string | null, audience: 'console' });
  }

  updateSession(
    id: string,
    data: { lastSeenAt?: Date; mfaVerifiedAt?: Date; membershipId?: string | null },
  ) {
    if (this.realm === 'member') return this.db.session.update({ where: { id }, data });
    const { membershipId: _m, ...staff } = data;
    void _m;
    return this.db.staffSession.update({ where: { id }, data: staff });
  }

  listSessions(userId: string) {
    const where = { userId, revokedAt: null, expiresAt: { gt: new Date() } };
    const orderBy = { lastSeenAt: 'desc' as const };
    return this.realm === 'member'
      ? this.db.session.findMany({ where, orderBy })
      : this.db.staffSession.findMany({ where, orderBy });
  }

  /** Revokes sessions (and their refresh tokens); returns the ids revoked. */
  async revokeSessions(
    where: { userId: string; id?: string; notId?: string },
    reason: string,
  ): Promise<string[]> {
    const filter = {
      userId: where.userId,
      revokedAt: null,
      ...(where.id ? { id: where.id } : {}),
      ...(where.notId ? { id: { not: where.notId } } : {}),
    };
    const sessions =
      this.realm === 'member'
        ? await this.db.session.findMany({ where: filter, select: { id: true } })
        : await this.db.staffSession.findMany({ where: filter, select: { id: true } });
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return [];
    const now = new Date();
    if (this.realm === 'member') {
      await this.db.session.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: now, revokeReason: reason },
      });
    } else {
      await this.db.staffSession.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: now, revokeReason: reason },
      });
    }
    await this.t.refreshToken.updateMany({
      where: { sessionId: { in: ids }, revokedAt: null },
      data: { revokedAt: now },
    });
    return ids;
  }

  /** Whether this person signed in before from the device with this hash. */
  async knownDevice(userId: string, deviceHash: string): Promise<{ known: boolean; any: boolean }> {
    const where = { userId };
    const [any, known] =
      this.realm === 'member'
        ? await Promise.all([
            this.db.session.count({ where }),
            this.db.session.count({ where: { ...where, deviceHash } }),
          ])
        : await Promise.all([
            this.db.staffSession.count({ where }),
            this.db.staffSession.count({ where: { ...where, deviceHash } }),
          ]);
    return { known: known > 0, any: any > 0 };
  }

  // ── Companies (members only, through the ADR 0006 lookups) ───────────────────────────

  async memberships(userId: string): Promise<MembershipRow[]> {
    if (this.realm !== 'member') return [];
    const rows = await this.db.$queryRaw<MembershipRow[]>`
      SELECT membership_id::text, tenant_id::text, tenant_code, tenant_slug, tenant_name,
             tenant_status, kind, status, display_name, permissions_version,
             entitlements_version, is_owner
      FROM identity.memberships_of_user(${userId}::uuid)`;
    // Companies the person may enter: membership active, and the company's status lets them in
    // (a locked or closing company only its Owner, Part 03 §3.7.2). The same rule as the
    // company guard, so a token is never issued for a company the guard then refuses.
    return rows.filter(
      (r) => r.status === 'active' && canEnterTenant(r.tenant_status as TenantStatus, r.is_owner),
    );
  }

  async mfaRequiredByCompany(userId: string): Promise<boolean> {
    if (this.realm === 'staff') return true; // platform staff always (§5.4, D5)
    const [row] = await this.db.$queryRaw<{ required: boolean }[]>`
      SELECT identity.mfa_required_by_company(${userId}::uuid) AS required`;
    return Boolean(row?.required);
  }
}

export function summary(row: MembershipRow): MembershipSummary {
  return {
    membership_id: row.membership_id,
    tenant_id: row.tenant_id,
    tenant_code: row.tenant_code,
    tenant_slug: row.tenant_slug,
    tenant_name: row.tenant_name,
    display_name: row.display_name,
    kind: row.kind,
  };
}
