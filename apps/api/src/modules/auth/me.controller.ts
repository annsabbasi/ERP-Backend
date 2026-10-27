import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AcceptedSchema,
  ChangePasswordRequestSchema,
  DoneSchema,
  EmailChangeRequestSchema,
  MembershipsSchema,
  MeSchema,
  RecoveryCodesSchema,
  SessionsSchema,
  TotpConfirmRequestSchema,
  TotpEnrolmentSchema,
  type AccessTokenClaims,
} from '@erp/contracts';
import type { z } from 'zod';
import { ApiZodResponse } from '../../common/openapi';
import { SignedIn } from '../access/access.decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { summary } from './account-store';
import { AccountService } from './account.service';
import { AuthDatabase } from './auth-database.service';
import { Auth } from './auth.guard';

// The signed-in person's own account (Part 05 §5.3.10, Part 11 §11.10.2), audience `app`.

@ApiTags('me')
@SignedIn()
@Controller('me')
export class MeController {
  constructor(
    private readonly account: AccountService,
    private readonly authDb: AuthDatabase,
  ) {}

  @Get()
  @ApiZodResponse(200, MeSchema, 'Profile and account security status')
  me(@Auth() claims: AccessTokenClaims) {
    return this.account.me(claims);
  }

  @Get('memberships')
  @ApiZodResponse(200, MembershipsSchema, 'Companies this person can open')
  async memberships(@Auth() claims: AccessTokenClaims) {
    const rows = await this.authDb.store('member').memberships(claims.sub);
    return { data: rows.map(summary) };
  }

  @Get('sessions')
  @ApiZodResponse(200, SessionsSchema, 'Signed-in sessions, the current one marked')
  async sessions(@Auth() claims: AccessTokenClaims) {
    return { data: await this.account.listSessions('member', claims) };
  }

  @Delete('sessions/:id')
  @ApiZodResponse(200, DoneSchema, 'That session is signed out')
  async revokeSession(
    @Auth() claims: AccessTokenClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.account.revokeSession('member', claims, id);
    return { status: 'done' as const };
  }

  @Post('password')
  @HttpCode(200)
  @ApiZodResponse(200, DoneSchema, 'Password changed; other sessions signed out')
  async changePassword(
    @Auth() claims: AccessTokenClaims,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema))
    body: z.infer<typeof ChangePasswordRequestSchema>,
  ) {
    await this.account.changePassword(claims, body.current_password, body.new_password);
    return { status: 'done' as const };
  }

  @Post('mfa/totp')
  @HttpCode(200)
  @ApiZodResponse(200, TotpEnrolmentSchema, 'A new authenticator secret, active once confirmed')
  startTotp(@Auth() claims: AccessTokenClaims) {
    return this.account.startTotp(claims);
  }

  @Post('mfa/totp/confirm')
  @HttpCode(200)
  @ApiZodResponse(200, RecoveryCodesSchema, 'MFA is on; the recovery codes are shown once')
  async confirmTotp(
    @Auth() claims: AccessTokenClaims,
    @Body(new ZodValidationPipe(TotpConfirmRequestSchema))
    body: z.infer<typeof TotpConfirmRequestSchema>,
  ) {
    return { recovery_codes: await this.account.confirmTotp(claims, body.code) };
  }

  @Delete('mfa')
  @ApiZodResponse(200, DoneSchema, 'MFA turned off (needs a step-up and a 15-character password)')
  async disableMfa(@Auth() claims: AccessTokenClaims) {
    await this.account.disableMfa(claims);
    return { status: 'done' as const };
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @ApiZodResponse(200, RecoveryCodesSchema, 'New recovery codes; the old ones stop working')
  async recoveryCodes(@Auth() claims: AccessTokenClaims) {
    return { recovery_codes: await this.account.regenerateRecoveryCodes(claims) };
  }

  @Post('email')
  @HttpCode(202)
  @ApiZodResponse(202, AcceptedSchema, 'A confirmation link went to the new address')
  async changeEmail(
    @Auth() claims: AccessTokenClaims,
    @Body(new ZodValidationPipe(EmailChangeRequestSchema))
    body: z.infer<typeof EmailChangeRequestSchema>,
  ) {
    await this.account.requestEmailChange(claims, body.new_email, body.password);
    return { status: 'accepted' as const };
  }
}
