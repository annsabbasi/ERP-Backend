import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { runOnce, withTenant, type TenantClient, type TenantTransaction } from '@erp/db';
import type { Job } from 'bullmq';
import { APP_DB } from './database';
import type { OutboxJob } from './outbox/outbox-dispatcher';
import { EVENTS_QUEUE } from './queues';

/** A consumer of one event type. `consumer` names it in processed_events. */
export type EventHandler = {
  consumer: string;
  type: string;
  handle: (event: OutboxJob, tx: TenantTransaction) => Promise<void>;
};

/** Handlers by event type. Modules register theirs as they arrive (Stage 2 on). */
export const EVENT_HANDLERS: EventHandler[] = [];

/**
 * Runs every handler of an event inside the event's tenant (one transaction each, RLS on),
 * at most once per handler thanks to processed_events.
 */
@Processor(EVENTS_QUEUE)
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(@Inject(APP_DB) private readonly db: TenantClient) {
    super();
  }

  async process(job: Job<OutboxJob>): Promise<void> {
    const event = job.data;
    const handlers = EVENT_HANDLERS.filter((h) => h.type === event.type);
    if (handlers.length === 0) {
      this.logger.debug(`event ${event.type} (${event.eventId}) has no handler`);
      return;
    }
    for (const handler of handlers) {
      const outcome = await withTenant(this.db, event.tenantId, (tx) =>
        runOnce(tx, handler.consumer, event.eventId, () => handler.handle(event, tx)),
      );
      if (!outcome.ran) this.logger.debug(`${handler.consumer} already handled ${event.eventId}`);
    }
  }
}
