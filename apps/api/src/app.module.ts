import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ProblemFilter } from './common/problem.filter';
import { clsOptions } from './common/request-context';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './modules/database/database.module';
import { FlagsModule } from './modules/flags/flags.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './modules/redis/redis.service';

@Module({
  // Guards run in import order: authentication, then the release flags (an unfinished route is
  // not found for everyone), then the access gates.
  imports: [
    ClsModule.forRoot(clsOptions),
    RedisModule,
    DatabaseModule,
    AuthModule,
    FlagsModule,
    AccessModule,
    HealthModule,
  ],
  providers: [ProblemFilter],
})
export class AppModule {}
