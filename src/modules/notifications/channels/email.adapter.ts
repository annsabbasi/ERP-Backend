import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification, NotificationChannel, User } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { DeliveryResult, NotificationChannelAdapter } from './channel.types';

/**
 * EMAIL delivery via SMTP (nodemailer). If SMTP_HOST is empty the adapter
 * reports `isConfigured() === false` and the NotificationsService skips it.
 *
 * We intentionally lazy-create the transport so a missing config doesn't
 * crash the app at boot — channels just gracefully drop to IN_APP.
 */
@Injectable()
export class EmailAdapter implements NotificationChannelAdapter {
  readonly channel = NotificationChannel.EMAIL;
  private readonly logger = new Logger(EmailAdapter.name);
  private transporter?: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('notifications.smtp.host');
  }

  async deliver(notification: Notification, recipient: User): Promise<DeliveryResult> {
    if (!this.isConfigured() || !recipient.email) {
      this.logger.log(`[email/skipped] to=${recipient.email ?? 'n/a'} subject="${notification.subject}"`);
      return { ok: false, failureReason: !this.isConfigured() ? 'smtp_not_configured' : 'no_recipient_email' };
    }

    try {
      const tx = this.transport();
      const from = this.config.get<string>('notifications.smtp.from', 'noreply@erp.local');
      const info = await tx.sendMail({
        from,
        to: recipient.email,
        subject: notification.subject ?? `[ERP] ${notification.category}`,
        text: notification.body,
      });
      this.logger.log(`[email] to=${recipient.email} id=${info.messageId}`);
      return { ok: true, sentAt: new Date() };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`[email/failed] to=${recipient.email}: ${msg}`);
      return { ok: false, failureReason: msg };
    }
  }

  private transport(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('notifications.smtp.host'),
      port: this.config.get<number>('notifications.smtp.port', 587),
      secure: this.config.get<boolean>('notifications.smtp.secure', false),
      auth: this.config.get<string>('notifications.smtp.user')
        ? {
            user: this.config.get<string>('notifications.smtp.user')!,
            pass: this.config.get<string>('notifications.smtp.pass')!,
          }
        : undefined,
    });
    return this.transporter;
  }
}
