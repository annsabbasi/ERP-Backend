import type { PrismaClient } from '@erp/db';
import type { Queue } from 'bullmq';

export type OutboxJob = {
  eventId: string;
  tenantId: string;
  type: string;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: unknown;
  occurredAt: string;
};

type OutboxRow = {
  id: string;
  tenant_id: string;
  type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: unknown;
  occurred_at: Date;
};

/**
 * Moves outbox rows to the events queue (Part 10 §10.9.1). Runs as app_ops, the BYPASSRLS
 * role, because it serves every tenant; consumers then work inside one tenant as app_user.
 * FOR UPDATE SKIP LOCKED lets several workers share the outbox. Delivery is at least once:
 * the job id is the event id (BullMQ ignores a duplicate) and consumers use runOnce.
 */
export class OutboxDispatcher {
  constructor(
    private readonly ops: PrismaClient,
    private readonly events: Queue,
  ) {}

  /** Publishes up to `limit` waiting events, oldest first; returns how many. */
  async dispatchBatch(limit = 100): Promise<number> {
    return this.ops.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id::text, tenant_id::text, type, aggregate_type, aggregate_id, payload, occurred_at
        FROM app.outbox
        WHERE dispatched_at IS NULL
        ORDER BY occurred_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return 0;
      for (const row of rows) {
        const job: OutboxJob = {
          eventId: row.id,
          tenantId: row.tenant_id,
          type: row.type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
          occurredAt: row.occurred_at.toISOString(),
        };
        await this.events.add(row.type, job, {
          jobId: row.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        });
      }
      const ids = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE app.outbox SET dispatched_at = now(), attempts = attempts + 1
        WHERE id = ANY(${ids}::uuid[])`;
      return rows.length;
    });
  }
}
