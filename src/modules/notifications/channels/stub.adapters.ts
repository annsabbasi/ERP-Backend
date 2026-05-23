import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationChannel, User } from '@prisma/client';
import { DeliveryResult, NotificationChannelAdapter } from './channel.types';

/**
 * Log-only adapters for channels we don't yet have provider integrations for.
 * They report `isConfigured() === false` so the NotificationsService treats
 * them as unavailable for actual delivery — but they're present in the
 * registry so a future Twilio/FCM/etc. wire-up is a single-file change.
 */

abstract class LogOnlyAdapter implements NotificationChannelAdapter {
  abstract readonly channel: NotificationChannel;
  private readonly logger = new Logger(this.constructor.name);

  isConfigured(): boolean { return false; }

  async deliver(notification: Notification, recipient: User): Promise<DeliveryResult> {
    this.logger.log(
      `[${this.channel}/stub] userId=${recipient.id} subject="${notification.subject}" body="${notification.body.slice(0, 120)}"`,
    );
    return { ok: false, failureReason: `${this.channel}_adapter_not_configured` };
  }
}

@Injectable() export class SmsAdapter        extends LogOnlyAdapter { readonly channel = NotificationChannel.SMS; }
@Injectable() export class WhatsAppAdapter   extends LogOnlyAdapter { readonly channel = NotificationChannel.WHATSAPP; }
@Injectable() export class PushAdapter       extends LogOnlyAdapter { readonly channel = NotificationChannel.PUSH; }
@Injectable() export class DesktopToastAdapter extends LogOnlyAdapter { readonly channel = NotificationChannel.DESKTOP_TOAST; }
