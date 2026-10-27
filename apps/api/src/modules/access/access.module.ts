import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessController } from './access.controller';
import {
  EntitlementGuard,
  PermissionGuard,
  StaffPermissionGuard,
  TenantGuard,
} from './access.guards';
import { AccessService } from './access.service';
import { LimitsService } from './limits.service';
import { ScopeService } from './scope.service';

// The access engine (Part 10 §10.7). Imported after AuthModule and FlagsModule, so its global
// guards run after authentication and after unfinished routes are hidden; their order here is
// the gate order.
@Global()
@Module({
  controllers: [AccessController],
  providers: [
    AccessService,
    ScopeService,
    LimitsService,
    { provide: APP_GUARD, useClass: StaffPermissionGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: EntitlementGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AccessService, ScopeService, LimitsService],
})
export class AccessModule {}
