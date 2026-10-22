import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SYSTEM_QUEUE } from './queues';
import { redisConnection } from './redis-connection';
import { SystemProcessor } from './system.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({ connection: redisConnection() }),
    }),
    BullModule.registerQueue({ name: SYSTEM_QUEUE }),
  ],
  providers: [SystemProcessor],
})
export class WorkerModule {}
