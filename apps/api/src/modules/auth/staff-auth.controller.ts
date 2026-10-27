import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  DoneSchema,
  LinkTokenRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MfaEnrolConfirmRequestSchema,
  MfaVerifyRequestSchema,
  RefreshRequestSchema,
  SignedInSchema,
  StaffEnrolledSchema,
  StaffMeSchema,
  StaffSetupInfoSchema,
  StaffSetupRequestSchema,
  type AccessTokenClaims,
} from '@erp/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ApiZodResponse } from '../../common/openapi';
import { SignedIn } from '../access/access.decorators';
import { ProblemException } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AccountService } from './account.service';
import { AuthDatabase } from './auth-database.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { Auth, bearerToken, ForAudience, Public } from './auth.guard';
import { sha256 } from './crypto';
import { clearRefreshCookie, clientMeta, deliver, refreshTokenOf } from './http';
import { LIMITS, RateLimitService } from './rate-limit.service';
import { SessionsService } from './sessions.service';
import { SignInService } from './sign-in.service';
import { TokenService } from './token.service';

// Platform staff sign-in (D5): built-in accounts, TOTP enrolled at the first sign-in, sessions
// ending after 30 minutes without use. Served under /api/platform/v1 (§11.9), audience `console`.

export const PLATFORM_PREFIX = 'api/platform/v1';

@ApiTags('platform auth')
@ForAudience('console')
@Controller(`${PLATFORM_PREFIX}/auth`)
export class StaffAuthController {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly signIn: SignInService,
    private readonly sessions: SessionsService,
    private readonly account: AccountService,
    private readonly authDb: AuthDatabase,
    private readonly tokens: TokenService,
    private readonly limits: RateLimitService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodResponse(200, LoginResponseSchema, 'Staff always continue with MFA (verify or enrol)')
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: z.infer<typeof LoginRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.loginPerIp, `staff:${request.ip ?? 'unknown'}`, response);
    return (await this.signIn.login('staff', body, clientMeta(request))).response;
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiZodResponse(200, SignedInSchema, 'Signed in')
  async verifyMfa(
    @Body(new ZodValidationPipe(MfaVerifyRequestSchema))
    body: z.infer<typeof MfaVerifyRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.mfaPerIp, `staff:${request.ip ?? 'unknown'}`, response);
    const result = await this.signIn.verifyMfa('staff', body);
    if (result.response.status !== 'signed_in') throw new ProblemException('mfa_invalid');
    return deliver(request, response, 'console', this.config, result.response, result.refreshToken);
  }

  @Public()
  @Post('mfa/enrol')
  @HttpCode(200)
  @ApiZodResponse(
    200,
    StaffEnrolledSchema,
    'Authenticator confirmed; signed in; recovery codes shown once',
  )
  async enrol(
    @Body(new ZodValidationPipe(MfaEnrolConfirmRequestSchema))
    body: z.infer<typeof MfaEnrolConfirmRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.mfaPerIp, `staff:${request.ip ?? 'unknown'}`, response);
    const result = await this.signIn.confirmEnrolment(body);
    if (result.response.status !== 'signed_in') throw new ProblemException('mfa_invalid');
    const signedIn = deliver(
      request,
      response,
      'console',
      this.config,
      result.response,
      result.refreshToken,
    );
    return { ...signedIn, recovery_codes: result.recoveryCodes };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiZodResponse(
    200,
    SignedInSchema,
    'A new access token, unless the session has been idle 30 minutes',
  )
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: z.infer<typeof RefreshRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.refreshPerIp, `staff:${request.ip ?? 'unknown'}`, response);
    const presented = refreshTokenOf(request, 'console', this.config, body.refresh_token);
    if (!presented) throw new ProblemException('unauthenticated', 'Sign in again');
    try {
      const started = await this.sessions.refresh(this.authDb.store('staff'), presented.token);
      return deliver(
        request,
        response,
        'console',
        this.config,
        started.body,
        started.refreshToken,
        presented,
      );
    } catch (error) {
      clearRefreshCookie(response, 'console', this.config);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'Signed out')
  async logout(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: z.infer<typeof RefreshRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const store = this.authDb.store('staff');
    const access = bearerToken(request);
    const claims = access ? await this.tokens.verify(access, 'console') : null;
    if (claims) {
      await this.sessions.revoke(store, { userId: claims.sub, id: claims.sid }, 'signed_out');
    } else {
      const presented = refreshTokenOf(request, 'console', this.config, body.refresh_token);
      const row = presented
        ? await store.t.refreshToken.findUnique({ where: { tokenHash: sha256(presented.token) } })
        : null;
      const session = row ? await store.findSession(row.sessionId) : null;
      if (session)
        await this.sessions.revoke(store, { userId: session.userId, id: session.id }, 'signed_out');
    }
    clearRefreshCookie(response, 'console', this.config);
    return { status: 'done' as const };
  }

  /** The person a setup link is for, to greet them by name (§5.3.1 step 2). */
  @Public()
  @Get('setup')
  @ApiZodResponse(200, StaffSetupInfoSchema, 'Who the setup link is for')
  async setupInfo(
    @Query(new ZodValidationPipe(LinkTokenRequestSchema))
    query: z.infer<typeof LinkTokenRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.linkPerIp, `staff:${request.ip ?? 'unknown'}`, response);
    return this.account.staffSetupInfo(query.token);
  }

  @Public()
  @Post('setup')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'Password set; sign in to enrol the authenticator')
  async setup(
    @Body(new ZodValidationPipe(StaffSetupRequestSchema))
    body: z.infer<typeof StaffSetupRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.linkPerIp, `staff:${request.ip ?? 'unknown'}`, response);
    await this.account.completeStaffSetup(body.token, body.password);
    return { status: 'done' as const };
  }
}

@ApiTags('platform me')
@ForAudience('console')
@SignedIn()
@Controller(`${PLATFORM_PREFIX}/me`)
export class StaffMeController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiZodResponse(200, StaffMeSchema, 'The signed-in staff member and their roles')
  me(@Auth() claims: AccessTokenClaims) {
    return this.account.staffMe(claims);
  }
}
