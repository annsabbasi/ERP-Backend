import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';

import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { FiscalPeriodsController } from './fiscal-periods/fiscal-periods.controller';
import { FiscalPeriodsService } from './fiscal-periods/fiscal-periods.service';
import { JournalEntriesController } from './journal-entries/journal-entries.controller';
import { JournalEntriesService } from './journal-entries/journal-entries.service';
import { FinancialReportsController } from './reports/financial-reports.controller';
import { FinancialReportsService } from './reports/financial-reports.service';
import { FixedAssetsController } from './fixed-assets/fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets/fixed-assets.service';
import * as SetupServices from './setup/setup.services';
import * as SetupControllers from './setup/setup.controllers';

const setupServices = [
  SetupServices.CurrenciesService,
  SetupServices.ExchangeRatesService,
  SetupServices.PaymentTermsService,
  SetupServices.FinanceProjectsService,
  SetupServices.TransactionCodesService,
  SetupServices.TaxCodesService,
  SetupServices.CashFlowLineItemsService,
  SetupServices.AccountDeterminationService,
  SetupServices.PostingTemplatesService,
  SetupServices.RecurringPostingsService,
  SetupServices.DimensionsService,
  SetupServices.CostCentersService,
  SetupServices.DistributionRulesService,
  SetupServices.BudgetScenariosService,
  SetupServices.BudgetDistributionMethodsService,
  SetupServices.BudgetLinesService,
  SetupServices.BanksService,
  SetupServices.HouseBankAccountsService,
  SetupServices.PaymentMethodsService,
  SetupServices.DunningTermsService,
];

const setupControllers = [
  SetupControllers.CurrenciesController,
  SetupControllers.ExchangeRatesController,
  SetupControllers.PaymentTermsController,
  SetupControllers.FinanceProjectsController,
  SetupControllers.TransactionCodesController,
  SetupControllers.TaxCodesController,
  SetupControllers.CashFlowLineItemsController,
  SetupControllers.AccountDeterminationController,
  SetupControllers.PostingTemplatesController,
  SetupControllers.RecurringPostingsController,
  SetupControllers.DimensionsController,
  SetupControllers.CostCentersController,
  SetupControllers.DistributionRulesController,
  SetupControllers.BudgetScenariosController,
  SetupControllers.BudgetDistributionMethodsController,
  SetupControllers.BudgetLinesController,
  SetupControllers.BanksController,
  SetupControllers.HouseBankAccountsController,
  SetupControllers.PaymentMethodsController,
  SetupControllers.DunningTermsController,
];

@Module({
  // Journal posting allocates document numbers, which the Administration
  // module owns. Importing it (rather than duplicating a numbering service)
  // keeps a single allocator, so numbers cannot collide across modules.
  imports: [AdministrationModule],
  controllers: [
    AccountsController,
    FiscalPeriodsController,
    JournalEntriesController,
    FinancialReportsController,
    FixedAssetsController,
    ...setupControllers,
  ],
  providers: [
    AccountsService,
    FiscalPeriodsService,
    JournalEntriesService,
    FinancialReportsService,
    FixedAssetsService,
    ...setupServices,
  ],
  // Exported so CRM (Customer 360) and future AR/AP modules can reuse the
  // ledger rather than writing their own GL access.
  exports: [
    AccountsService,
    FiscalPeriodsService,
    JournalEntriesService,
    FinancialReportsService,
    SetupServices.ExchangeRatesService,
    SetupServices.AccountDeterminationService,
    SetupServices.PaymentTermsService,
  ],
})
export class FinancialsModule {}
