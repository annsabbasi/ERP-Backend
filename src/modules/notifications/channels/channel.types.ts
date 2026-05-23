import type { Notification, NotificationChannel, User } from '@prisma/client';

/**
 * A channel adapter knows how to deliver a single Notification through one
 * channel (email, SMS, …). Each adapter is responsible for:
 *
 *   • Reporting `isConfigured()` so the NotificationsService can downgrade
 *     to IN_APP-only when the channel is not wired up.
 *   • Producing a DeliveryResult so the row's `status` / `failureReason` /
 *     `sentAt` can be persisted by the caller.
 *
 * Adapters MUST NOT throw — return `{ ok: false }` instead so the caller
 * can fan out across remaining channels.
 */
export interface DeliveryResult {
  ok: boolean;
  sentAt?: Date;
  failureReason?: string;
}

export interface NotificationChannelAdapter {
  readonly channel: NotificationChannel;
  isConfigured(): boolean;
  deliver(notification: Notification, recipient: User): Promise<DeliveryResult>;
}
