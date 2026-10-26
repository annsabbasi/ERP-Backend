import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EMAIL_QUEUE } from '@erp/contracts';
import { databaseProviders } from './database';
import { EmailProcessor } from './email/email.processor';
import { EventsProcessor } from './events.processor';
import { EVENTS_QUEUE, SYSTEM_QUEUE } from './queues';
import { redisConnection } from './redis-connection';
import { SystemProcessor } from './system.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({ connection: redisConnection() }),
    }),
    BullModule.registerQueue({ name: SYSTEM_QUEUE }, { name: EVENTS_QUEUE }, { name: EMAIL_QUEUE }),
  ],
  providers: [...databaseProviders, SystemProcessor, EventsProcessor, EmailProcessor],
})
export class WorkerModule {}
