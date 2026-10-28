import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import {
  CATALOGUE,
  STAFF_PERMISSIONS,
  type StaffPermission as StaffPermissionKey,
} from '@erp/contracts';
import type { Request } from 'express';
import { ProblemException } from '../../common/problem';
import type { MemberAccess } from './compute-access';

// How a route says who may call it (Part 10 §10.7.4). Every route that is not @Public() carries
// exactly one rule; the route audit test fails the build otherwise.

export const ACCESS_META = {
  permission: 'erp:require-permission',
  feature: 'erp:require-feature',
  signedIn: 'erp:signed-in',
  staff: 'erp:staff-permission',
} as const;

/** Gates 1 and 2 (Part 02 §2.12): a feature that unlocks the key is effective, a role grants it. */
export function RequirePermission(permission: string) {
  if (!CATALOGUE.permissionKeys.includes(permission)) {
    throw new Error(`RequirePermission: ${permission} is not in the registry`);
  }
  return SetMetadata(ACCESS_META.permission, permission);
}

/** Gate 1 for a route that belongs to one feature, for example the waiter app's order screen. */
export function RequireFeature(feature: string) {
  if (!CATALOGUE.getFeature(feature)) {
    throw new Error(`RequireFeature: ${feature} is not in the registry`);
  }
  return SetMetadata(ACCESS_META.feature, feature);
}

/** Any signed-in person, about their own account (profile, sessions, MFA, /me/access). */
export const SignedIn = () => SetMetadata(ACCESS_META.signedIn, true);

/** A Platform Console route and the staff permissions that open it, any of them (Part 03 §3.2.1). */
export function StaffPermission(...permissions: StaffPermissionKey[]) {
  for (const p of permissions) {
    if (!(STAFF_PERMISSIONS as readonly string[]).includes(p)) {
      throw new Error(`StaffPermission: ${p} is not a staff permission`);
    }
  }
  return SetMetadata(ACCESS_META.staff, permissions);
}

export type AccessRequest = Request & { access?: MemberAccess };

/** The caller's effective access in the current company. */
export const CurrentAccess = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const access = ctx.switchToHttp().getRequest<AccessRequest>().access;
  if (!access) throw new ProblemException('permission_denied', 'Choose a company first');
  return access;
});
