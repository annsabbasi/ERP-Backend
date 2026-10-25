import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { databaseProviders } from './database';
import { EventsProcessor } from './events.processor';
import { EVENTS_QUEUE, SYSTEM_QUEUE } from './queues';
import { redisConnection } from './redis-connection';
import { SystemProcessor } from './system.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({ connection: redisConnection() }),
    }),
    BullModule.registerQueue({ name: SYSTEM_QUEUE }, { name: EVENTS_QUEUE }),
  ],
  providers: [...databaseProviders, SystemProcessor, EventsProcessor],
})
export class WorkerModule {}
