import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WebhookDeliveryStatus, WebhookEndpoint } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

interface DispatchInput {
  companyId: string;
  eventKey: string;
  payload: Record<string, unknown>;
}

/**
 * Outbound webhook bus (Section 6.10).
 *
 *   • Endpoints are per-tenant with HMAC-SHA256 signing.
 *   • Each dispatch creates a WebhookDelivery row, then attempts HTTP POST
 *     inline. 2xx → DELIVERED, 5xx / network → RETRYING (the caller can
 *     retry via `retry()`; a proper cron arrives with the scheduler module).
 *
 * Event filtering supports glob-ish patterns:
 *   "*"                      — match everything
 *   "workflow.*"             — anything starting with "workflow."
 *   "billing.invoice_issued" — exact match
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ── Endpoint CRUD ─────────────────────────────────────────────────────────

  listEndpoints(companyId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findEndpoint(companyId: string, id: string) {
    return this.prisma.webhookEndpoint.findFirst({
      where: { id, companyId },
    });
  }

  async createEndpoint(companyId: string, input: { name: string; url: string; eventFilters?: string[]; isActive?: boolean }) {
    return this.prisma.webhookEndpoint.create({
      data: {
        companyId,
        name: input.name,
        url: input.url,
        secret: randomBytes(32).toString('hex'),
        eventFilters: input.eventFilters ?? [],
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateEndpoint(
    companyId: string,
    id: string,
    patch: { name?: string; url?: string; eventFilters?: string[]; isActive?: boolean; secret?: string },
  ) {
    const ep = await this.findEndpoint(companyId, id);
    if (!ep) throw new Error(`Endpoint ${id} not found`);
    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        name: patch.name ?? undefined,
        url: patch.url ?? undefined,
        eventFilters: patch.eventFilters ?? undefined,
        isActive: patch.isActive ?? undefined,
        secret: patch.secret ?? undefined,
      },
    });
  }

  async removeEndpoint(companyId: string, id: string) {
    const ep = await this.findEndpoint(companyId, id);
    if (!ep) throw new Error(`Endpoint ${id} not found`);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return { message: `Endpoint ${id} deleted` };
  }

  listDeliveries(companyId: string, endpointId: string) {
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId, endpoint: { companyId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Find every active endpoint subscribed to `eventKey`, create a delivery row,
   * and attempt the HTTP POST inline. Failures don't throw — the caller is the
   * notification path and must not be blocked by webhook flakiness.
   */
  async dispatch(input: DispatchInput): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { companyId: input.companyId, isActive: true },
    });
    const matches = endpoints.filter((e) => this.matches(e.eventFilters, input.eventKey));
    if (!matches.length) return;

    await Promise.all(matches.map((ep) => this.attemptOne(ep, input)));
  }

  /** Retry a single delivery (manual from admin UI for now). */
  async retry(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery) throw new Error('Delivery not found');
    await this.attemptDelivery(delivery.endpoint, delivery.id, delivery.eventKey, delivery.payload as any);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private matches(patterns: string[], eventKey: string): boolean {
    if (!patterns.length) return true;
    return patterns.some((p) => {
      if (p === '*') return true;
      if (p.endsWith('.*')) {
        return eventKey.startsWith(p.slice(0, -2) + '.');
      }
      return p === eventKey;
    });
  }

  private async attemptOne(ep: WebhookEndpoint, input: DispatchInput) {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        eventKey: input.eventKey,
        payload: input.payload as Prisma.InputJsonValue,
        status: WebhookDeliveryStatus.PENDING,
      },
    });
    await this.attemptDelivery(ep, delivery.id, input.eventKey, input.payload);
  }

  private async attemptDelivery(
    ep: WebhookEndpoint,
    deliveryId: string,
    eventKey: string,
    payload: Record<string, unknown>,
  ) {
    const maxAttempts = this.config.get<number>('notifications.webhooks.maxAttempts', 5);
    const timeoutMs = this.config.get<number>('notifications.webhooks.timeoutMs', 5000);

    const body = JSON.stringify({ event: eventKey, payload, timestamp: new Date().toISOString() });
    const signature = createHmac('sha256', ep.secret).update(body).digest('hex');

    let attempts = (await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, select: { attempts: true } }))?.attempts ?? 0;
    attempts += 1;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let errorMessage: string | undefined;
    let ok = false;
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ERP-Event': eventKey,
          'X-ERP-Signature': `sha256=${signature}`,
          'X-ERP-Delivery': deliveryId,
        },
        body,
        signal: ac.signal,
      });
      responseStatus = res.status;
      const text = await res.text().catch(() => '');
      responseBody = text.slice(0, 4000);
      ok = res.ok;
    } catch (e) {
      errorMessage = (e as Error).message;
      this.logger.warn(`webhook ${deliveryId} attempt ${attempts} failed: ${errorMessage}`);
    } finally {
      clearTimeout(t);
    }

    const status: WebhookDeliveryStatus = ok
      ? WebhookDeliveryStatus.DELIVERED
      : attempts >= maxAttempts
        ? WebhookDeliveryStatus.FAILED
        : WebhookDeliveryStatus.RETRYING;

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        attempts,
        responseStatus,
        responseBody,
        errorMessage,
        lastAttemptedAt: new Date(),
        deliveredAt: ok ? new Date() : null,
      },
    });
  }
}
