import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessTokenClaims, Audience } from '@erp/contracts';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ProblemException } from '../../common/problem';
import { CTX } from '../../common/request-context';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

// Authentication for every route (§10.7.4: the first global guard). Routes are private unless
// marked @Public(); each controller names its audience, so a staff token is refused on company
// routes and a member token on Platform Console routes.

const PUBLIC = 'erp:public';
const AUDIENCE = 'erp:audience';

export const Public = () => SetMetadata(PUBLIC, true);
export const ForAudience = (audience: Audience) => SetMetadata(AUDIENCE, audience);

type AuthedRequest = Request & { auth?: AccessTokenClaims };

/** The verified claims of the caller's access token. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessTokenClaims => {
  const claims = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!claims) throw new ProblemException('unauthenticated');
  return claims;
});

export function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
  return match?.[1];
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const audience = this.reflector.getAllAndOverride<Audience>(AUDIENCE, targets) ?? 'app';
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(request);
    const claims = token ? await this.tokens.verify(token, audience) : null;
    // A revoked session (sign-out, reset, theft detection) loses access at once, not in 10 minutes.
    if (!claims || (await this.sessions.isRevoked(claims.sid))) {
      throw new ProblemException('unauthenticated', 'Sign in again');
    }
    request.auth = claims;
    // The tenant comes from the token, never from a header (§10.5.3). Stage 3 adds the check
    // that the membership is still active on every request.
    if (audience === 'app' && claims.tid) {
      this.cls.set(CTX.tenantId, claims.tid);
      this.cls.set(CTX.membershipId, claims.mid);
    }
    return true;
  }
}
