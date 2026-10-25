import { currentTenantId, TenantContextMissingError, type TenantTransaction } from './tenant';

// Domain events (Part 10 §10.9.1): written to app.outbox in the same transaction as the
// change, published by the worker's dispatcher, and handled at most once per consumer.

/** Event names are module.entity.verb, for example restaurant.bill.paid. */
export const EVENT_TYPE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type DomainEventInput = {
  type: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
};

/** Adds an event to the outbox of the current tenant, inside the caller's transaction. */
export async function addOutboxEvent(tx: TenantTransaction, event: DomainEventInput) {
  if (!EVENT_TYPE.test(event.type))
    throw new Error(`event type must be module.entity.verb: ${event.type}`);
  return tx.outboxEvent.create({
    data: {
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: (event.payload ?? {}) as object,
    } as never,
  });
}

/**
 * Runs `work` for an event only if this consumer has not handled it before. The
 * processed_events row is written in the same transaction as the work, so a failed attempt
 * leaves no mark and the retry runs again; a repeated delivery is skipped.
 */
export async function runOnce<T>(
  tx: TenantTransaction,
  consumer: string,
  eventId: string,
  work: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const tenantId = currentTenantId();
  if (!tenantId) throw new TenantContextMissingError('ProcessedEvent', 'runOnce');
  const inserted = await tx.$executeRaw`
    INSERT INTO app.processed_events (tenant_id, consumer, event_id)
    VALUES (${tenantId}::uuid, ${consumer}, ${eventId}::uuid)
    ON CONFLICT DO NOTHING`;
  if (inserted === 0) return { ran: false };
  return { ran: true, result: await work() };
}
