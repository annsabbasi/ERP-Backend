import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service';
import { FlagsController } from './flags.controller';
import { FeatureFlagGuard } from './require-flag';

@Module({
  controllers: [FlagsController],
  providers: [FeatureFlagsService, { provide: APP_GUARD, useClass: FeatureFlagGuard }],
  exports: [FeatureFlagsService],
})
export class FlagsModule {}
