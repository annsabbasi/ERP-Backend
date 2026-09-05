import { Module, forwardRef } from '@nestjs/common';
import { SettingsService } from './settings/settings.service';
import { NumberingService } from './numbering/numbering.service';
import { ApprovalsService } from './approvals/approvals.service';
import * as S from './administration.services';
import * as C from './administration.controllers';
import * as XC from './administration.extra.controllers';
import { FinancialIndexesService } from './indexes/indexes.service';
import { LicenseService } from './license/license.service';
import { UtilitiesService } from './utilities/utilities.service';
import { ModuleGrantsService } from './module-grants/module-grants.service';
import { ModuleGrantsController } from './module-grants/module-grants.controller';
import { FinancialsModule } from '../financials/financials.module';

@Module({
  // Period-End Closing posts through the ledger's own JournalEntriesService
  // rather than writing journal rows itself, so Administration depends on
  // Financials. Financials already depends back on Administration for
  // numbering, hence forwardRef on both sides.
  imports: [forwardRef(() => FinancialsModule)],
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
    XC.IndexesController,
    XC.LicenseController,
    XC.UtilitiesController,
  ],
  providers: [
    ModuleGrantsService,
    SettingsService,
    NumberingService,
    ApprovalsService,
    FinancialIndexesService,
    LicenseService,
    UtilitiesService,
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
