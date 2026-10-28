import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCESS_VERSION_HEADER,
  allowedByTenantStatus,
  CATALOGUE,
  canEnterTenant,
  type AccessTokenClaims,
} from '@erp/contracts';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ProblemException } from '../../common/problem';
import { CTX } from '../../common/request-context';
import { PUBLIC } from '../auth/auth.guard';
import { ACCESS_META, type AccessRequest } from './access.decorators';
import { AccessService } from './access.service';
import { readOnlyDetail, refusalOf } from './compute-access';

// The global guards after authentication, in the order of Part 10 §10.7.4:
// Tenant → Entitlement (gate 1) → Permission (gate 2). Gate 3 (scope) is checked where the
// records are read, with ScopeService. Platform Console routes use the platform module's
// StaffPermissionGuard instead.

type Meta = { permission?: string; feature?: string; signedIn?: boolean; staff?: string[] };

function metaOf(reflector: Reflector, context: ExecutionContext): Meta & { public: boolean } {
  const targets = [context.getHandler(), context.getClass()];
  const get = <T>(key: string) => reflector.getAllAndOverride<T | undefined>(key, targets);
  return {
    public: get<boolean>(PUBLIC) ?? false,
    permission: get<string>(ACCESS_META.permission),
    feature: get<string>(ACCESS_META.feature),
    signedIn: get<boolean>(ACCESS_META.signedIn),
    staff: get<string[]>(ACCESS_META.staff),
  };
}

type GuardedRequest = AccessRequest & { auth?: AccessTokenClaims };

/**
 * The membership is still active, the company's status lets this member in and allows the
 * action, and the member's access is loaded for the gates and for ScopeService. A token whose
 * membership has ended gets 401, so the client refreshes into a token without that company.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = metaOf(this.reflector, context);
    if (meta.public || meta.staff) return true;
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const claims = request.auth;
    if (!claims || claims.aud !== 'app') return true;
    if (!meta.permission && !meta.feature && !meta.signedIn) {
      // Fail closed; the route audit test stops such a route before it ships.
      throw new ProblemException('permission_denied', 'This route declares no access rule');
    }
    if (!claims.tid || !claims.mid) {
      if (meta.permission || meta.feature) {
        throw new ProblemException('permission_denied', 'Choose a company first');
      }
      return true;
    }
    const stamp = await this.access.stamp(claims.tid, claims.mid);
    if (
      !stamp ||
      stamp.membershipStatus !== 'active' ||
      !canEnterTenant(stamp.tenantStatus, stamp.isOwner)
    ) {
      throw new ProblemException('unauthenticated', 'Your access to this company has ended');
    }
    context.switchToHttp().getResponse<Response>().setHeader(ACCESS_VERSION_HEADER, `${stamp.pv}`);
    const access = await this.access.access(claims.tid, claims.mid, stamp);
    request.access = access;
    this.cls.set(CTX.access, access);
    if (meta.permission && !allowedByTenantStatus(access.status, access.isOwner, meta.permission)) {
      throw new ProblemException('tenant_read_only', readOnlyDetail(access.status));
    }
    return true;
  }
}

/** Gate 1: the route's feature, or a feature that unlocks its permission, is effective. */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = metaOf(this.reflector, context);
    const access = context.switchToHttp().getRequest<GuardedRequest>().access;
    if (!access || (!meta.feature && !meta.permission)) return true;
    const entitled = meta.feature
      ? Boolean(access.features[meta.feature])
      : CATALOGUE.featuresOfPermission(meta.permission!).some((f) => access.features[f]);
    if (!entitled) {
      throw new ProblemException(
        'feature_not_entitled',
        'Your company’s plan does not include this',
      );
    }
    return true;
  }
}

/** Gate 2: one of the member's roles (or an exception) grants the permission. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { permission } = metaOf(this.reflector, context);
    const access = context.switchToHttp().getRequest<GuardedRequest>().access;
    if (!permission || !access) return true;
    if (!access.permissions[permission]) {
      const refusal = refusalOf(access, permission);
      throw new ProblemException(refusal.code, refusal.detail);
    }
    return true;
  }
}
