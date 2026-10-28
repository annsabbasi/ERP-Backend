import {
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  STAFF_ROLES,
  staffPermissionsOf,
  type AccessTokenClaims,
  type StaffGrantMode,
  type StaffPermission,
  type StaffRoleKey,
} from '@erp/contracts';
import type { Request } from 'express';
import { ProblemException } from '../../common/problem';
import { ACCESS_META } from '../access/access.decorators';
import { RedisService } from '../redis/redis.service';
import { PlatformDatabase } from './platform-database.service';

// Who a staff member is in the console (Part 03 §3.2): their roles and the permissions the
// §3.2.1 matrix gives them. Read on every console request from a 15-second cache, like the
// members' access stamp, so a role change or a deactivation applies within 15 seconds.

export type StaffContext = {
  id: string;
  name: string;
  roles: StaffRoleKey[];
  permissions: Partial<Record<StaffPermission, StaffGrantMode>>;
};

const CACHE_SECONDS = () => Number(process.env.ACCESS_STAMP_SECONDS ?? 15);

@Injectable()
export class StaffAccessService {
  constructor(
    private readonly platform: PlatformDatabase,
    private readonly redis: RedisService,
  ) {}

  /** The active staff member's context, or null when they are not active any more. */
  async load(staffId: string): Promise<StaffContext | null> {
    const key = this.key(staffId);
    const cached = await this.redis.client.get(key);
    let stamp = cached
      ? (JSON.parse(cached) as { name: string; status: string; roles: string[] } | null)
      : undefined;
    if (stamp === undefined) {
      const user = await this.platform.db.staffUser.findUnique({
        where: { id: staffId },
        select: { name: true, status: true, roles: { select: { roleKey: true } } },
      });
      stamp = user
        ? { name: user.name, status: user.status, roles: user.roles.map((r) => r.roleKey) }
        : null;
      await this.redis.client.set(key, JSON.stringify(stamp), 'EX', CACHE_SECONDS());
    }
    if (!stamp || stamp.status !== 'active') return null;
    const roles = stamp.roles.filter((r): r is StaffRoleKey =>
      (STAFF_ROLES as readonly string[]).includes(r),
    );
    return { id: staffId, name: stamp.name, roles, permissions: staffPermissionsOf(roles) };
  }

  /** Forget a staff member's cached roles at once (after a role change or deactivation). */
  async forget(staffId: string): Promise<void> {
    await this.redis.client.del(this.key(staffId));
  }

  private key(staffId: string): string {
    return this.redis.key('access', 'staff', staffId);
  }
}

type StaffRequest = Request & { auth?: AccessTokenClaims; staff?: StaffContext };

/**
 * Console routes name the staff permissions that open them (@StaffPermission, any of them).
 * The staff member must still be active; their context is kept for the handler.
 */
@Injectable()
export class StaffPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: StaffAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const needed = this.reflector.getAllAndOverride<StaffPermission[] | undefined>(
      ACCESS_META.staff,
      [context.getHandler(), context.getClass()],
    );
    if (!needed) return true;
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const claims = request.auth;
    if (!claims || claims.aud !== 'console') throw new ProblemException('unauthenticated');
    const staff = await this.access.load(claims.sub);
    if (!staff) throw new ProblemException('unauthenticated', 'Your console access has ended');
    if (!needed.some((p) => staff.permissions[p])) {
      throw new ProblemException('permission_denied', 'Your staff role does not allow this');
    }
    request.staff = staff;
    return true;
  }
}

/** The calling staff member (on routes with @StaffPermission). */
export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffContext => {
    const staff = ctx.switchToHttp().getRequest<StaffRequest>().staff;
    if (!staff) throw new ProblemException('permission_denied');
    return staff;
  },
);
