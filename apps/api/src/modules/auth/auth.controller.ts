import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AcceptedSchema,
  DoneSchema,
  ForgotPasswordRequestSchema,
  JwksSchema,
  LinkTokenRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MfaVerifyRequestSchema,
  RefreshRequestSchema,
  ResetPasswordRequestSchema,
  SignedInSchema,
  StepUpRequestSchema,
  SwitchRequestSchema,
  type AccessTokenClaims,
} from '@erp/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ApiZodResponse } from '../../common/openapi';
import { ProblemException } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AccountService } from './account.service';
import { AuthDatabase } from './auth-database.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { Auth, bearerToken, Public } from './auth.guard';
import { sha256 } from './crypto';
import { clearRefreshCookie, clientMeta, deliver, refreshTokenOf } from './http';
import { LIMITS, RateLimitService } from './rate-limit.service';
import { SessionsService } from './sessions.service';
import { SignInService, type SignInResult } from './sign-in.service';
import { TokenService } from './token.service';

// Sign-in for company members (Part 11 §11.10.2), audience `app`.

@ApiTags('auth')
@Controller('auth')
export class AuthController {
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
  @Get('jwks')
  @ApiZodResponse(200, JwksSchema, 'Public keys that verify access tokens')
  jwks() {
    return this.tokens.jwks();
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodResponse(200, LoginResponseSchema, 'Signed in, or the second factor is needed')
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: z.infer<typeof LoginRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.loginPerIp, request.ip ?? 'unknown', response);
    return this.answer(
      request,
      response,
      await this.signIn.login('member', body, clientMeta(request)),
    );
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
    await this.limits.enforce(LIMITS.mfaPerIp, request.ip ?? 'unknown', response);
    return this.answer(request, response, await this.signIn.verifyMfa('member', body));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiZodResponse(200, SignedInSchema, 'A new access token; the refresh token is rotated')
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: z.infer<typeof RefreshRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.refreshPerIp, request.ip ?? 'unknown', response);
    const raw = refreshTokenOf(request, 'app', this.config, body.refresh_token);
    if (!raw) throw new ProblemException('unauthenticated', 'Sign in again');
    try {
      const started = await this.sessions.refresh(this.authDb.store('member'), raw);
      return deliver(request, response, 'app', this.config, started.body, started.refreshToken);
    } catch (error) {
      clearRefreshCookie(response, 'app', this.config);
      throw error;
    }
  }

  /** Ends this session, found from the access token or the refresh token. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'Signed out')
  async logout(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: z.infer<typeof RefreshRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const store = this.authDb.store('member');
    const access = bearerToken(request);
    const claims = access ? await this.tokens.verify(access, 'app') : null;
    if (claims) {
      await this.sessions.revoke(store, { userId: claims.sub, id: claims.sid }, 'signed_out');
    } else {
      const raw = refreshTokenOf(request, 'app', this.config, body.refresh_token);
      if (raw) await this.revokeByRefresh(raw);
    }
    clearRefreshCookie(response, 'app', this.config);
    return { status: 'done' as const };
  }

  @Post('logout-all')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'Every session of this person ended')
  async logoutAll(
    @Auth() claims: AccessTokenClaims,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.revoke(
      this.authDb.store('member'),
      { userId: claims.sub },
      'signed_out_all',
    );
    clearRefreshCookie(response, 'app', this.config);
    return { status: 'done' as const };
  }

  @Post('switch')
  @HttpCode(200)
  @ApiZodResponse(200, SignedInSchema, 'An access token for the chosen company')
  switch(
    @Auth() claims: AccessTokenClaims,
    @Body(new ZodValidationPipe(SwitchRequestSchema)) body: z.infer<typeof SwitchRequestSchema>,
  ) {
    return this.sessions.switch(this.authDb.store('member'), claims, body.membership_id);
  }

  @Post('step-up')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'MFA checked again; sensitive actions are open for 10 minutes')
  async stepUp(
    @Auth() claims: AccessTokenClaims,
    @Body(new ZodValidationPipe(StepUpRequestSchema)) body: z.infer<typeof StepUpRequestSchema>,
  ) {
    await this.account.stepUp('member', claims, body);
    return { status: 'done' as const };
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @ApiZodResponse(202, AcceptedSchema, 'The same answer whether or not the address has an account')
  async forgot(
    @Body(new ZodValidationPipe(ForgotPasswordRequestSchema))
    body: z.infer<typeof ForgotPasswordRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.forgotPerIp, request.ip ?? 'unknown', response);
    await this.account.forgotPassword(body.email);
    return { status: 'accepted' as const };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'Password set; every session ended')
  async reset(
    @Body(new ZodValidationPipe(ResetPasswordRequestSchema))
    body: z.infer<typeof ResetPasswordRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.linkPerIp, request.ip ?? 'unknown', response);
    await this.account.resetPassword(body.token, body.password);
    return { status: 'done' as const };
  }

  @Public()
  @Post('email/confirm')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'The new address is in use')
  async confirmEmail(
    @Body(new ZodValidationPipe(LinkTokenRequestSchema))
    body: z.infer<typeof LinkTokenRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce(LIMITS.linkPerIp, request.ip ?? 'unknown', response);
    await this.account.confirmEmailChange(body.token);
    return { status: 'done' as const };
  }

  private answer(request: Request, response: Response, result: SignInResult) {
    if (result.response.status !== 'signed_in') return result.response;
    return deliver(request, response, 'app', this.config, result.response, result.refreshToken);
  }

  private async revokeByRefresh(raw: string): Promise<void> {
    const store = this.authDb.store('member');
    const row = await store.t.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    const session = row ? await store.findSession(row.sessionId) : null;
    if (session)
      await this.sessions.revoke(store, { userId: session.userId, id: session.id }, 'signed_out');
  }
}
