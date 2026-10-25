import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PrismaClient } from '@erp/db';
import type { Job, Queue } from 'bullmq';
import { OPS_DB } from './database';
import { OutboxDispatcher } from './outbox/outbox-dispatcher';
import { EVENTS_QUEUE, registerSchedules, SCHEDULES, SYSTEM_QUEUE } from './queues';
import { redisTarget } from './redis-connection';

/**
 * Scheduled system work. On start it registers the repeatable jobs (BullMQ job schedulers,
 * one per id however many workers run) and then handles them as they come due.
 */
@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProcessor.name);
  private readonly dispatcher: OutboxDispatcher;

  constructor(
    @Inject(OPS_DB) ops: PrismaClient,
    @InjectQueue(SYSTEM_QUEUE) private readonly system: Queue,
    @InjectQueue(EVENTS_QUEUE) events: Queue,
  ) {
    super();
    this.dispatcher = new OutboxDispatcher(ops, events);
  }

  async onApplicationBootstrap(): Promise<void> {
    // Resolves only once the worker's Redis connection is up.
    await this.worker.waitUntilReady();
    await registerSchedules(this.system);
    this.logger.log(
      `worker ready (queues: ${SYSTEM_QUEUE}, ${EVENTS_QUEUE}; schedules: ` +
        `${Object.values(SCHEDULES)
          .map((s) => s.id)
          .join(', ')}; redis: ${redisTarget()})`,
    );
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SCHEDULES.outboxDispatch.name: {
        const published = await this.dispatcher.dispatchBatch();
        if (published > 0) this.logger.log(`outbox: ${published} event(s) published`);
        return;
      }
      case SCHEDULES.maintenanceTick.name:
        // Expiries, reminders and scheduled changes are added by the stages that need them.
        return;
      default:
        this.logger.warn(`job ${job.id} (${job.name}) has no handler`);
    }
  }
}
