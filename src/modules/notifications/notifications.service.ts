import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationDigest,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelRegistry } from './channels/channel.registry';
import { WebhooksService } from './webhooks.service';

export interface SendNotificationInput {
  companyId: string | null;
  userIds: string[];
  category: string;
  subject?: string;
  body: string;
  data?: Record<string, unknown>;
  refType?: string;
  refId?: string;
  /** Override channels — defaults to whatever each user's preferences allow. */
  forceChannels?: NotificationChannel[];
}

/**
 * Fans an event out to:
 *   • one row per (user, channel) in the `notifications` table (IN_APP always
 *     included, other channels gated on preferences + adapter configuration),
 *   • the WebhooksService for any company-level subscribers to `category`.
 *
 * Channels with digest = HOURLY/DAILY/WEEKLY are persisted as PENDING and
 * delivered by a future digest worker. IMMEDIATE channels are fired inline.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
    private readonly webhooks: WebhooksService,
  ) {}

  // ── DISPATCH ──────────────────────────────────────────────────────────────

  async send(input: SendNotificationInput): Promise<Notification[]> {
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: input.userIds }, isActive: true, deletedAt: null },
    });
    if (!recipients.length) return [];

    const created: Notification[] = [];

    for (const recipient of recipients) {
      const channels = await this.resolveChannelsForUser(recipient.id, input.category, input.forceChannels);
      for (const channel of channels) {
        const adapter = this.channels.get(channel.channel);
        const digestImmediate = channel.digest === NotificationDigest.IMMEDIATE;

        const row = await this.prisma.notification.create({
          data: {
            companyId: input.companyId ?? recipient.companyId ?? undefined,
            userId: recipient.id,
            channel: channel.channel,
            category: input.category,
            subject: input.subject,
            body: input.body,
            data: (input.data ?? null) as Prisma.InputJsonValue,
            refType: input.refType,
            refId: input.refId,
            status: NotificationStatus.PENDING,
          },
        });
        created.push(row);

        // IN_APP is "delivered" by row existence; non-immediate digests wait
        // for the digest worker; other immediate channels fire inline.
        if (!digestImmediate) continue;

        if (channel.channel === NotificationChannel.IN_APP) {
          await this.prisma.notification.update({
            where: { id: row.id },
            data: { status: NotificationStatus.SENT, sentAt: new Date() },
          });
          continue;
        }

        if (!adapter.isConfigured()) {
          await this.prisma.notification.update({
            where: { id: row.id },
            data: { status: NotificationStatus.FAILED, failureReason: 'adapter_not_configured' },
          });
          continue;
        }

        const result = await adapter.deliver(row, recipient);
        await this.prisma.notification.update({
          where: { id: row.id },
          data: {
            status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: result.sentAt ?? null,
            failureReason: result.failureReason ?? null,
          },
        });
      }
    }

    // Webhook fan-out is per-company, independent of individual user preferences.
    if (input.companyId) {
      try {
        await this.webhooks.dispatch({
          companyId: input.companyId,
          eventKey: input.category,
          payload: {
            recipients: recipients.map((r) => r.id),
            subject: input.subject,
            body: input.body,
            data: input.data ?? null,
            refType: input.refType ?? null,
            refId: input.refId ?? null,
          },
        });
      } catch (e) {
        this.logger.warn(`webhook dispatch failed for ${input.category}: ${(e as Error).message}`);
      }
    }

    return created;
  }

  // ── User inbox ────────────────────────────────────────────────────────────

  async listForUser(userId: string, opts: { unreadOnly?: boolean; page?: number; pageSize?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const where: Prisma.NotificationWhereInput = {
      userId,
      channel: NotificationChannel.IN_APP,
      ...(opts.unreadOnly ? { readAt: null, status: { not: NotificationStatus.DISMISSED } } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: {
        userId,
        channel: NotificationChannel.IN_APP,
        readAt: null,
        status: { notIn: [NotificationStatus.DISMISSED, NotificationStatus.FAILED] },
      },
    });
  }

  async markRead(id: string, userId: string) {
    const notif = await this.prisma.notification.findUnique({ where: { id } });
    if (!notif) throw new NotFoundException(`Notification ${id} not found`);
    if (notif.userId !== userId) throw new ForbiddenException();
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date(), status: NotificationStatus.READ },
    });
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
      data: { readAt: new Date(), status: NotificationStatus.READ },
    });
    return { updated: res.count };
  }

  async dismiss(id: string, userId: string) {
    const notif = await this.prisma.notification.findUnique({ where: { id } });
    if (!notif) throw new NotFoundException(`Notification ${id} not found`);
    if (notif.userId !== userId) throw new ForbiddenException();
    return this.prisma.notification.update({
      where: { id },
      data: { dismissedAt: new Date(), status: NotificationStatus.DISMISSED },
    });
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  listPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ category: 'asc' }, { channel: 'asc' }],
    });
  }

  upsertPreference(
    userId: string,
    input: { category?: string; channel: NotificationChannel; enabled: boolean; digest?: NotificationDigest },
  ) {
    const category = input.category ?? '*';
    return this.prisma.notificationPreference.upsert({
      where: { userId_category_channel: { userId, category, channel: input.channel } },
      update: {
        enabled: input.enabled,
        digest: input.digest ?? undefined,
      },
      create: {
        userId,
        category,
        channel: input.channel,
        enabled: input.enabled,
        digest: input.digest ?? NotificationDigest.IMMEDIATE,
      },
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Resolves which channels to deliver on for a (user, category).
   *
   *   • IN_APP is always included (the spec calls it the universal channel).
   *   • For non-IN_APP channels, look for a category-specific preference first
   *     and fall back to the wildcard "*" preference. Default = NOT enabled.
   *   • `forceChannels` from the caller overrides everything else.
   */
  private async resolveChannelsForUser(
    userId: string,
    category: string,
    forceChannels?: NotificationChannel[],
  ): Promise<{ channel: NotificationChannel; digest: NotificationDigest }[]> {
    if (forceChannels?.length) {
      return forceChannels.map((c) => ({ channel: c, digest: NotificationDigest.IMMEDIATE }));
    }

    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId, category: { in: [category, '*'] } },
    });
    const byChannel = new Map<NotificationChannel, { enabled: boolean; digest: NotificationDigest }>();
    // Wildcard first, then category-specific overrides.
    for (const p of prefs.filter((p) => p.category === '*')) {
      byChannel.set(p.channel, { enabled: p.enabled, digest: p.digest });
    }
    for (const p of prefs.filter((p) => p.category === category)) {
      byChannel.set(p.channel, { enabled: p.enabled, digest: p.digest });
    }

    const out: { channel: NotificationChannel; digest: NotificationDigest }[] = [
      { channel: NotificationChannel.IN_APP, digest: byChannel.get(NotificationChannel.IN_APP)?.digest ?? NotificationDigest.IMMEDIATE },
    ];
    for (const channel of [
      NotificationChannel.EMAIL,
      NotificationChannel.SMS,
      NotificationChannel.WHATSAPP,
      NotificationChannel.PUSH,
      NotificationChannel.DESKTOP_TOAST,
    ]) {
      const cfg = byChannel.get(channel);
      if (cfg?.enabled && cfg.digest !== NotificationDigest.OFF) {
        out.push({ channel, digest: cfg.digest });
      }
    }
    return out;
  }
}
