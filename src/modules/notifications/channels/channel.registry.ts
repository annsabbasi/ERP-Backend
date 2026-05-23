import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { NotificationChannelAdapter } from './channel.types';
import { EmailAdapter } from './email.adapter';
import { InAppAdapter } from './in-app.adapter';
import {
  DesktopToastAdapter,
  PushAdapter,
  SmsAdapter,
  WhatsAppAdapter,
} from './stub.adapters';

@Injectable()
export class ChannelRegistry {
  private readonly byChannel: Map<NotificationChannel, NotificationChannelAdapter>;

  constructor(
    inApp: InAppAdapter,
    email: EmailAdapter,
    sms: SmsAdapter,
    whatsApp: WhatsAppAdapter,
    push: PushAdapter,
    desktop: DesktopToastAdapter,
  ) {
    this.byChannel = new Map([
      [NotificationChannel.IN_APP, inApp as NotificationChannelAdapter],
      [NotificationChannel.EMAIL, email],
      [NotificationChannel.SMS, sms],
      [NotificationChannel.WHATSAPP, whatsApp],
      [NotificationChannel.PUSH, push],
      [NotificationChannel.DESKTOP_TOAST, desktop],
    ]);
  }

  get(channel: NotificationChannel): NotificationChannelAdapter {
    const adapter = this.byChannel.get(channel);
    if (!adapter) throw new Error(`No adapter for channel ${channel}`);
    return adapter;
  }

  /** All adapters, in stable channel order — used by preference UI. */
  all(): NotificationChannelAdapter[] {
    return [...this.byChannel.values()];
  }
}
