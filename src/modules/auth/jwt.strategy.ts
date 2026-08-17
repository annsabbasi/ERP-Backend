import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenPayload } from './auth-tokens.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'secret',
    });
  }

  async validate(payload: AccessTokenPayload) {
    // Reject refresh tokens or anything without the access type marker.
    if (payload?.type && payload.type !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      companyId: payload.companyId,
      isSuperAdmin: payload.isSuperAdmin,
      roleType: payload.roleType,
      departmentId: payload.departmentId,
      branchId: payload.branchId ?? null,
      permissions: payload.permissions,
      enabledModuleSlugs: payload.enabledModuleSlugs ?? [],
    };
  }
}
