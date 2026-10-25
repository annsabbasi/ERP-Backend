import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ProblemFilter } from './common/problem.filter';
import { clsOptions } from './common/request-context';
import { DatabaseModule } from './modules/database/database.module';
import { FlagsModule } from './modules/flags/flags.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [ClsModule.forRoot(clsOptions), DatabaseModule, FlagsModule, HealthModule],
  providers: [ProblemFilter],
})
export class AppModule {}
