import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { TenantPrincipal } from '../context/tenant-context.service';

/**
 * Header a platform operator uses to name the company they are administering.
 *
 * Set by the Choose Company window. Honoured for platform operators only — a
 * company user's own tenant always wins, so this can never become a way to
 * read across tenants.
 */
export const ACTIVE_COMPANY_HEADER = 'x-company-id';

/**
 * Global JWT auth guard.
 *
 * - Skips entirely on routes marked `@Public()` (e.g. /auth/login, /auth/refresh).
 * - Otherwise enforces a valid access token via Passport.
 * - On success, copies the principal onto `req.tenantPrincipal` so the
 *   REQUEST-scoped TenantContextService can read it.
 * - Resolves the *active* company for platform operators, so the ~100
 *   controllers that read `user.companyId` keep working unchanged while a
 *   platform operator administers a tenant.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(err: any, user: any, info: any, context: ExecutionContext): TUser {
    const result = super.handleRequest(err, user, info, context);
    if (result) {
      const request = context.switchToHttp().getRequest();

      // A platform operator belongs to no company, so every company-scoped
      // route would otherwise query `companyId: null` — which matches nothing
      // and reads as "this tenant has no data", while the writes throw. A
      // window that mistook that failure for an expired session is what logged
      // the user out of Posting Periods on Add Period. Honouring the header the
      // Choose Company window sets gives them a real tenant to act in.
      //
      // Gated on `isSuperAdmin`: a company user's token decides their tenant,
      // and a header they supply is ignored rather than trusted.
      if (result.isSuperAdmin) {
        const header = request.headers?.[ACTIVE_COMPANY_HEADER];
        const active = Array.isArray(header) ? header[0] : header;
        if (typeof active === 'string' && active.trim()) {
          result.companyId = active.trim();
        }
      }

      const principal: TenantPrincipal = {
        userId: result.sub,
        email: result.email,
        companyId: result.companyId ?? null,
        roleType: result.roleType,
        isSuperAdmin: !!result.isSuperAdmin,
        departmentId: result.departmentId ?? null,
        branchId: result.branchId ?? null,
        permissions: result.permissions ?? [],
      };
      request.tenantPrincipal = principal;
    }
    return result;
  }
}
