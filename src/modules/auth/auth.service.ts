import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthEventType, Prisma, UserRoleType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  AccessTokenPayload,
  AuthTokens,
  RefreshTokenPayload,
} from './auth-tokens.types';
import { AuthAuditService, AuthRequestMeta } from './services/auth-audit.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { PermissionResolverService } from '../permissions/permission-resolver.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuthAuditService,
    private readonly permissions: PermissionResolverService,
  ) { }

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, meta: AuthRequestMeta) {
    const user = await this.findLoginCandidate(dto);

    if (!user) {
      await this.audit.recordLoginAttempt({
        email: dto.email,
        companySlug: dto.companySlug ?? null,
        userId: null,
        success: false,
        failureReason: dto.companySlug ? 'unknown_company_or_user' : 'unknown_user',
        meta,
      });
      // Do not leak whether the email or company is wrong.
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive || user.deletedAt) {
      await this.audit.recordLoginAttempt({
        email: dto.email,
        companySlug: dto.companySlug ?? null,
        userId: user.id,
        success: false,
        failureReason: 'inactive',
        meta,
      });
      throw new UnauthorizedException('Account is inactive');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.recordLoginAttempt({
        email: dto.email,
        companySlug: dto.companySlug ?? null,
        userId: user.id,
        success: false,
        failureReason: 'locked',
        meta,
      });
      throw new UnauthorizedException(
        `Account locked until ${user.lockedUntil.toISOString()} due to repeated failed attempts`,
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.registerFailedAttempt(user.id, dto, meta);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Successful login — clear lockout counters and issue tokens.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const tokens = await this.issueTokenPair(user.id, meta);
    await this.audit.recordLoginAttempt({
      email: user.email,
      companySlug: dto.companySlug ?? null,
      userId: user.id,
      success: true,
      meta,
    });
    await this.audit.recordEvent({
      userId: user.id,
      type: AuthEventType.LOGIN_SUCCESS,
      meta,
    });

    return {
      ...tokens,
      user: await this.publicUser(user.id),
    };
  }

  // ── REFRESH ────────────────────────────────────────────────────────────────
  async refresh(rawToken: string, meta: AuthRequestMeta): Promise<AuthTokens> {
    const rotated = await this.refreshTokens.rotate(rawToken, meta);

    const access = await this.signAccessToken(rotated.user.id);
    await this.audit.recordEvent({
      userId: rotated.user.id,
      type: AuthEventType.TOKEN_REFRESHED,
      meta,
    });

    return {
      accessToken: access.token,
      refreshToken: rotated.rawToken,
      accessTokenExpiresIn: access.expiresIn,
      refreshTokenExpiresIn: this.config.get<string>('jwt.refreshExpiresIn', '7d'),
    };
  }

  // ── LOGOUT ─────────────────────────────────────────────────────────────────
  async logout(rawToken: string | undefined, userId: string | null, meta: AuthRequestMeta) {
    if (rawToken) {
      await this.refreshTokens.revoke(rawToken);
    }
    await this.audit.recordEvent({
      userId: userId ?? null,
      type: AuthEventType.LOGOUT,
      meta,
    });
    return { ok: true };
  }

  // ── REGISTER (admin-only — guarded at the controller) ──────────────────────
  async register(dto: RegisterDto) {
    let companyId: string | null = null;

    if (dto.companySlug) {
      const company = await this.prisma.company.findUnique({ where: { slug: dto.companySlug } });
      if (!company) throw new BadRequestException('Company not found');
      companyId = company.id;
    }

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, companyId: companyId ?? undefined },
    });
    if (existing) {
      throw new BadRequestException('A user with this email already exists in this company');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        companyId,
        roleType: companyId ? UserRoleType.EMPLOYEE : UserRoleType.SUPER_ADMIN,
        isSuperAdmin: !companyId,
        passwordChangedAt: new Date(),
      },
    });

    return {
      message: 'User registered successfully',
      user: { id: user.id, name: user.name, email: user.email, companyId: user.companyId },
    };
  }

  // ── PROFILE ────────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    return this.publicUser(userId);
  }

  // ── INTERNAL ───────────────────────────────────────────────────────────────
  private async findLoginCandidate(dto: LoginDto) {
    if (dto.companySlug) {
      const company = await this.prisma.company.findUnique({
        where: { slug: dto.companySlug, isActive: true },
      });
      if (!company) return null;
      return this.prisma.user.findFirst({
        where: { email: dto.email, companyId: company.id },
      });
    }
    // Platform super admins authenticate without a company slug.
    return this.prisma.user.findFirst({
      where: { email: dto.email, isSuperAdmin: true },
    });
  }

  private async registerFailedAttempt(userId: string, dto: LoginDto, meta: AuthRequestMeta) {
    const max = this.config.get<number>('auth.maxFailedAttempts', 5);
    const lockoutMin = this.config.get<number>('auth.lockoutMinutes', 15);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { id: true, failedLoginAttempts: true },
    });

    let locked = false;
    if (updated.failedLoginAttempts >= max) {
      const until = new Date(Date.now() + lockoutMin * 60 * 1000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: until, failedLoginAttempts: 0 },
      });
      locked = true;
      await this.audit.recordEvent({
        userId,
        type: AuthEventType.ACCOUNT_LOCKED,
        meta,
        metadata: { until: until.toISOString() } as Prisma.InputJsonValue,
      });
    }

    await this.audit.recordLoginAttempt({
      email: dto.email,
      companySlug: dto.companySlug ?? null,
      userId,
      success: false,
      failureReason: locked ? 'locked_after_invalid' : 'invalid_credentials',
      meta,
    });
    await this.audit.recordEvent({
      userId,
      type: AuthEventType.LOGIN_FAILED,
      meta,
    });
  }

  private async issueTokenPair(userId: string, meta: AuthRequestMeta): Promise<AuthTokens> {
    const access = await this.signAccessToken(userId);
    const refresh = await this.refreshTokens.issue(userId, meta);
    return {
      accessToken: access.token,
      refreshToken: refresh.rawToken,
      accessTokenExpiresIn: access.expiresIn,
      refreshTokenExpiresIn: this.config.get<string>('jwt.refreshExpiresIn', '7d'),
    };
  }

  private async signAccessToken(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userModules: { include: { module: { select: { slug: true } } } } },
    });
    if (!u) throw new UnauthorizedException('User not found');

    const resolved = await this.permissions.resolveForUser(userId);
    const permissions = this.permissions.encode(resolved);

    const payload: AccessTokenPayload = {
      sub: u.id,
      email: u.email,
      companyId: u.companyId ?? null,
      isSuperAdmin: u.isSuperAdmin,
      roleType: u.roleType,
      departmentId: u.departmentId ?? null,
      branchId: u.branchId ?? null,
      permissions,
      enabledModuleSlugs: await this.resolveEnabledModuleSlugs(u),
      type: 'access',
    };

    const expiresIn = this.config.get<string>('jwt.accessExpiresIn', '15m');
    const token = await this.jwt.signAsync(payload, { expiresIn: expiresIn as any });
    return { token, expiresIn };
  }

  /**
   * Issues a refresh-typed JWT envelope around the opaque token id.
   * (Currently we ship the raw opaque token directly; this helper exists
   *  for code that wants a self-describing JWT later.)
   */
  async signRefreshJwt(userId: string, jti: string) {
    const payload: RefreshTokenPayload = { sub: userId, jti, type: 'refresh' };
    const expiresIn = this.config.get<string>('jwt.refreshExpiresIn', '7d');
    return this.jwt.signAsync(payload, { expiresIn: expiresIn as any });
  }

  private async publicUser(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: { select: { id: true, name: true } } } },
        userModules: { include: { module: true } },
      },
    });
    if (!u) throw new UnauthorizedException('User not found');

    const resolved = await this.permissions.resolveForUser(userId);
    const permissions = this.permissions.encode(resolved);
    const enabledModuleSlugs = await this.resolveEnabledModuleSlugs(u);

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      companyId: u.companyId,
      isSuperAdmin: u.isSuperAdmin,
      roleType: u.roleType,
      departmentId: u.departmentId,
      branchId: u.branchId,
      mfaEnabled: u.mfaEnabled,
      lastLoginAt: u.lastLoginAt,
      permissions,
      enabledModuleSlugs,
      roles: u.userRoles.map((ur) => ({ id: ur.role.id, name: ur.role.name })),
    };
  }

  private async resolveEnabledModuleSlugs(user: any): Promise<string[]> {
    if (user.isSuperAdmin) {
      const modules = await this.prisma.systemModule.findMany({ where: { isActive: true } });
      return modules.map((m) => m.slug);
    }
    if (!user.companyId) return [];

    if (
      user.roleType === UserRoleType.SUPER_ADMIN ||
      user.roleType === UserRoleType.COMPANY_ADMIN
    ) {
      const rows = await this.prisma.companyModule.findMany({
        where: { companyId: user.companyId, isEnabled: true },
        include: { module: { select: { slug: true } } },
      });
      return rows.map((r) => r.module.slug);
    }

    const companyEnabled = await this.prisma.companyModule.findMany({
      where: { companyId: user.companyId, isEnabled: true },
      select: { moduleId: true },
    });
    const enabledIds = new Set(companyEnabled.map((c) => c.moduleId));
    return (user.userModules ?? [])
      .filter((um: any) => enabledIds.has(um.moduleId))
      .map((um: any) => um.module.slug);
  }

}
