import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountService } from './account.service';
import { AuthDatabase } from './auth-database.service';
import { AUTH_CONFIG, readAuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { LinksService } from './links.service';
import { MailerService } from './mailer.service';
import { MeController } from './me.controller';
import { MfaService } from './mfa.service';
import { RateLimitService } from './rate-limit.service';
import { SessionsService } from './sessions.service';
import { SignInService } from './sign-in.service';
import { StaffAuthController, StaffMeController } from './staff-auth.controller';
import { TokenService } from './token.service';

// Identity, sessions and MFA (Part 05, Part 10 §10.6). AuthDatabase, the app_auth connection, is
// deliberately not exported: no other module reaches sign-in secrets (ADR 0008).

@Module({
  controllers: [AuthController, MeController, StaffAuthController, StaffMeController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => readAuthConfig() },
    AuthDatabase,
    TokenService,
    SessionsService,
    MfaService,
    LinksService,
    MailerService,
    RateLimitService,
    SignInService,
    AccountService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, SessionsService, MailerService],
})
export class AuthModule {}
