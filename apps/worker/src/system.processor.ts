import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SYSTEM_QUEUE } from './queues';
import { redisTarget } from './redis-connection';

@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProcessor.name);

  async onApplicationBootstrap(): Promise<void> {
    // Resolves only once the worker's Redis connection is up.
    await this.worker.waitUntilReady();
    this.logger.log(`worker ready (queue: ${SYSTEM_QUEUE}, redis: ${redisTarget()})`);
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`job ${job.id} (${job.name}) received`);
  }
}
