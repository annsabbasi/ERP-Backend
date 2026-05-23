import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { DeliveryResult, NotificationChannelAdapter } from './channel.types';

/**
 * IN_APP delivery is implicit — the Notification row IS the delivery, surfaced
 * by `GET /notifications`. This adapter just stamps the row as SENT.
 */
@Injectable()
export class InAppAdapter implements NotificationChannelAdapter {
  readonly channel = NotificationChannel.IN_APP;

  isConfigured(): boolean {
    return true;
  }

  async deliver(): Promise<DeliveryResult> {
    return { ok: true, sentAt: new Date() };
  }
}
