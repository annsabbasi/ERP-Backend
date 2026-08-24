import { Module } from '@nestjs/common';
import { SettingsService } from './settings/settings.service';
import { NumberingService } from './numbering/numbering.service';
import { ApprovalsService } from './approvals/approvals.service';
import * as S from './administration.services';
import * as C from './administration.controllers';
import { ModuleGrantsService } from './module-grants/module-grants.service';
import { ModuleGrantsController } from './module-grants/module-grants.controller';

@Module({
  controllers: [
    ModuleGrantsController,
    C.SystemInitializationController,
    C.NumberingController,
    C.PredefinedTextController,
    C.CountriesController,
    C.UserGroupsController,
    C.UserDefaultsController,
    C.AlertsController,
    C.ApprovalsController,
    C.SubstituteAuthorizersController,
  ],
  providers: [
    ModuleGrantsService,
    SettingsService,
    NumberingService,
    ApprovalsService,
    S.PredefinedTextService,
    S.CountriesService,
    S.UserGroupsService,
    S.UserDefaultsService,
    S.AlertsService,
    S.SubstituteAuthorizersService,
  ],
  // NumberingService is the single document-number allocator; SettingsService
  // and ApprovalsService are needed by any module that posts documents.
  // AlertsService is exported so producers elsewhere can raise alerts.
  exports: [
    ModuleGrantsService,
    NumberingService,
    SettingsService,
    ApprovalsService,
    S.AlertsService,
  ],
})
export class AdministrationModule {}
