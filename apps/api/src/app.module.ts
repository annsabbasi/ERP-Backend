import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ProblemFilter } from './common/problem.filter';
import { clsOptions } from './common/request-context';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './modules/database/database.module';
import { FlagsModule } from './modules/flags/flags.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './modules/redis/redis.service';

@Module({
  // AuthModule first: its guard (authentication) runs before the release-flag guard.
  imports: [
    ClsModule.forRoot(clsOptions),
    RedisModule,
    DatabaseModule,
    AuthModule,
    FlagsModule,
    HealthModule,
  ],
  providers: [ProblemFilter],
})
export class AppModule {}
