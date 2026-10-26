import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { EMAIL_QUEUE, EmailJobSchema, type EmailJob } from '@erp/contracts';
import { Queue } from 'bullmq';
import { redisConnection } from '../../common/redis-connection';

/**
 * Puts e-mails on the worker's `email` queue, which renders and sends them with retries
 * (§10.9.2). The queue opens on first use, so the OpenAPI build needs no Redis. Callers send
 * after their transaction commits; a failure to queue is logged and never shown to the user,
 * who can ask again.
 */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private queue?: Queue;

  private get emails(): Queue {
    if (!this.queue) {
      this.queue = new Queue(EMAIL_QUEUE, {
        connection: redisConnection(),
        prefix: process.env.QUEUE_PREFIX ?? 'bull',
      });
    }
    return this.queue;
  }

  async send(job: EmailJob): Promise<void> {
    const data = EmailJobSchema.parse(job);
    try {
      await this.emails.add(data.template, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
    } catch (error) {
      this.logger.error(`could not queue the ${data.template} e-mail: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
