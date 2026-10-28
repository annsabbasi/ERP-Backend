import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenClaims } from '@erp/contracts';
import { ProblemException } from '../../common/problem';
import { AuthDatabase } from './auth-database.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { LinksService } from './links.service';
import { MailerService } from './mailer.service';
import { SessionsService } from './sessions.service';

// What the Platform Console needs from staff sign-in, without reaching sign-in secrets itself
// (ADR 0008): setup links for invited staff, ending a staff member's sessions, and the step-up
// check before sensitive actions (Part 03 §3.3.1).

const SETUP_HOURS = 72;
const STEP_UP_MS = 10 * 60_000;

@Injectable()
export class StaffAccountsService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly authDb: AuthDatabase,
    private readonly links: LinksService,
    private readonly mailer: MailerService,
    private readonly sessions: SessionsService,
  ) {}

  /** E-mails a one-time setup link (72 hours); a newer link ends older ones. */
  async sendSetupLink(staff: { id: string; email: string; name: string }): Promise<void> {
    const token = await this.links.issue(
      this.authDb.store('staff'),
      staff.id,
      'setup',
      SETUP_HOURS * 60,
    );
    await this.mailer.send({
      template: 'staff_setup',
      to: staff.email,
      data: {
        name: staff.name,
        link: `${this.config.consoleUrl}/setup/${token}`,
        expires_hours: String(SETUP_HOURS),
      },
    });
  }

  /** Ends every session of a staff member at once (deactivation, role changes). */
  async endSessions(staffId: string, reason: string): Promise<number> {
    return (await this.sessions.revoke(this.authDb.store('staff'), { userId: staffId }, reason))
      .length;
  }

  /** When this session last checked MFA, or null. */
  async mfaVerifiedAt(claims: AccessTokenClaims): Promise<Date | null> {
    const session = await this.authDb.store('staff').findSession(claims.sid);
    return session?.mfaVerifiedAt ?? null;
  }

  /** Sensitive console actions need an MFA check within the last 10 minutes. */
  async assertStepUp(claims: AccessTokenClaims): Promise<void> {
    const at = (await this.mfaVerifiedAt(claims))?.getTime() ?? 0;
    if (Date.now() - at > STEP_UP_MS) {
      throw new ProblemException('step_up_required', 'Enter a code from your authenticator first');
    }
  }
}
