import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsService } from './approvals.service';
import { CatalogueService } from './catalogue.service';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformDatabase } from './platform-database.service';
import {
  CatalogueController,
  ConsoleController,
  GovernanceController,
  StaffController,
} from './platform.controllers';
import { StaffAccessService, StaffPermissionGuard } from './staff-access.service';
import { StaffService } from './staff.service';
import { VersionsService } from './versions.service';

// Platform Console I (Part 03 §3.2–3.3, §3.11, §3.17): staff, catalogue, plans, industry
// templates, country packs, four-eyes approvals and the platform audit log, over the
// app_platform connection. Imported after the access module, so the staff guard runs after
// authentication and the release flags.
@Module({
  imports: [AuthModule],
  controllers: [ConsoleController, StaffController, CatalogueController, GovernanceController],
  providers: [
    PlatformDatabase,
    StaffAccessService,
    PlatformAuditService,
    ApprovalsService,
    CatalogueService,
    VersionsService,
    StaffService,
    { provide: APP_GUARD, useClass: StaffPermissionGuard },
  ],
})
export class PlatformModule {}
