import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import * as S from './setup.services';
import * as Dto from './setup.dto';

// Every catalog below shares the same five routes; only the path, the service
// and the permission resource differ. The bespoke behaviour each one needs is
// added as extra methods on the subclass.

@ApiTags('Financials — Currencies')
// Also reachable with `administration`: the Exchange Rates & Indexes window is
// an Administration screen and fills its currency picker from here.
@RequireModule('financials', 'administration')
@Controller('financials/currencies')
export class CurrenciesController extends TenantCrudController({
  permissionResource: 'financials.currency',
  label: 'currencies',
  createDto: Dto.CreateCurrencyDto,
  updateDto: Dto.UpdateCurrencyDto,
}) {
  constructor(protected readonly service: S.CurrenciesService) { super(); }
}

@ApiTags('Financials — Exchange Rates')
// Surfaced inside Administration → Exchange Rates & Indexes, whose other tab is
// gated on `administration`. Gating this half on `financials` alone left that
// window with one working tab and one that answered 403.
@RequireModule('financials', 'administration')
@Controller('financials/exchange-rates')
export class ExchangeRatesController extends TenantCrudController({
  permissionResource: 'financials.exchange_rate',
  label: 'exchange rates',
  createDto: Dto.CreateExchangeRateDto,
  updateDto: Dto.UpdateExchangeRateDto,
}) {
  constructor(protected readonly service: S.ExchangeRatesService) { super(); }

  @ApiOperation({ summary: 'Rate to apply for a currency on a date' })
  @RequirePermission('financials.exchange_rate.view')
  @Get('resolve')
  async resolve(
    @CurrentUser() user: AuthedUser,
    @Query('target') target: string,
    @Query('date') date?: string,
    @Query('base') base?: string,
  ) {
    const rate = await this.service.rateFor(
      user.companyId as string,
      target,
      date ? new Date(date) : new Date(),
      base ?? 'USD',
    );
    return { base: base ?? 'USD', target, date: date ?? null, rate: rate.toFixed(6) };
  }

  @ApiOperation({ summary: 'Save a grid of rates in one call' })
  @RequirePermission('financials.exchange_rate.create')
  @Post('bulk')
  bulk(
    @CurrentUser() user: AuthedUser,
    @Body() body: { rates: Dto.CreateExchangeRateDto[] },
  ) {
    return this.service.bulkUpsert(user.companyId as string, body.rates ?? []);
  }

  /**
   * One month of quotes, shaped as the Exchange Rates grid draws it: a row per
   * day, a column per currency.
   *
   * The window used to be expected to page the flat list and bucket it itself,
   * which meant a month with more quotes than the page size silently lost rows
   * off the bottom of the grid.
   */
  @ApiOperation({ summary: 'Exchange Rates grid for one month' })
  @RequirePermission('financials.exchange_rate.view')
  @Get('grid')
  grid(
    @CurrentUser() user: AuthedUser,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @Query('base') base?: string,
  ) {
    return this.service.monthGrid(user.companyId as string, year, month, base ?? 'USD');
  }

  @ApiOperation({ summary: 'Clear one quote (currency + day)' })
  @RequirePermission('financials.exchange_rate.delete')
  @Delete('cell')
  clearCell(
    @CurrentUser() user: AuthedUser,
    @Query('target') target: string,
    @Query('date') date: string,
    @Query('base') base?: string,
  ) {
    return this.service.clearCell(user.companyId as string, target, date, base ?? 'USD');
  }
}

@ApiTags('Financials — Payment Terms')
@RequireModule('financials')
@Controller('financials/payment-terms')
export class PaymentTermsController extends TenantCrudController({
  permissionResource: 'financials.payment_terms',
  label: 'payment terms',
  createDto: Dto.CreatePaymentTermsDto,
  updateDto: Dto.UpdatePaymentTermsDto,
}) {
  constructor(protected readonly service: S.PaymentTermsService) { super(); }
}

@ApiTags('Financials — Projects')
@RequireModule('financials')
@Controller('financials/projects')
export class FinanceProjectsController extends TenantCrudController({
  permissionResource: 'financials.project',
  label: 'projects',
  createDto: Dto.CreateFinanceProjectDto,
  updateDto: Dto.UpdateFinanceProjectDto,
}) {
  constructor(protected readonly service: S.FinanceProjectsService) { super(); }
}

@ApiTags('Financials — Transaction Codes')
@RequireModule('financials')
@Controller('financials/transaction-codes')
export class TransactionCodesController extends TenantCrudController({
  permissionResource: 'financials.transaction_code',
  label: 'transaction codes',
  createDto: Dto.CreateTransactionCodeDto,
  updateDto: Dto.UpdateTransactionCodeDto,
}) {
  constructor(protected readonly service: S.TransactionCodesService) { super(); }
}

@ApiTags('Financials — Tax Codes')
@RequireModule('financials')
@Controller('financials/tax-codes')
export class TaxCodesController extends TenantCrudController({
  permissionResource: 'financials.tax_code',
  label: 'tax codes',
  createDto: Dto.CreateTaxCodeDto,
  updateDto: Dto.UpdateTaxCodeDto,
}) {
  constructor(protected readonly service: S.TaxCodesService) { super(); }
}

@ApiTags('Financials — Cash Flow Line Items')
@RequireModule('financials')
@Controller('financials/cash-flow-line-items')
export class CashFlowLineItemsController extends TenantCrudController({
  permissionResource: 'financials.cash_flow_item',
  label: 'cash flow line items',
  createDto: Dto.CreateCashFlowLineItemDto,
  updateDto: Dto.UpdateCashFlowLineItemDto,
}) {
  constructor(protected readonly service: S.CashFlowLineItemsService) { super(); }
}

@ApiTags('Financials — Banks')
@RequireModule('financials')
@Controller('financials/banks')
export class BanksController extends TenantCrudController({
  permissionResource: 'financials.bank',
  label: 'banks',
  createDto: Dto.CreateBankDto,
  updateDto: Dto.UpdateBankDto,
}) {
  constructor(protected readonly service: S.BanksService) { super(); }
}

@ApiTags('Financials — House Bank Accounts')
@RequireModule('financials')
@Controller('financials/house-bank-accounts')
export class HouseBankAccountsController extends TenantCrudController({
  permissionResource: 'financials.house_bank_account',
  label: 'house bank accounts',
  createDto: Dto.CreateHouseBankAccountDto,
  updateDto: Dto.UpdateHouseBankAccountDto,
}) {
  constructor(protected readonly service: S.HouseBankAccountsService) { super(); }
}

@ApiTags('Financials — Payment Methods')
@RequireModule('financials')
@Controller('financials/payment-methods')
export class PaymentMethodsController extends TenantCrudController({
  permissionResource: 'financials.payment_method',
  label: 'payment methods',
  createDto: Dto.CreatePaymentMethodDto,
  updateDto: Dto.UpdatePaymentMethodDto,
}) {
  constructor(protected readonly service: S.PaymentMethodsService) { super(); }
}

@ApiTags('Financials — Dunning Terms')
@RequireModule('financials')
@Controller('financials/dunning-terms')
export class DunningTermsController extends TenantCrudController({
  permissionResource: 'financials.dunning_term',
  label: 'dunning terms',
  createDto: Dto.CreateDunningTermDto,
  updateDto: Dto.UpdateDunningTermDto,
}) {
  constructor(protected readonly service: S.DunningTermsService) { super(); }
}

// ─── COST ACCOUNTING ──────────────────────────────────────────────────────────
@ApiTags('Financials — Dimensions')
@RequireModule('financials')
@Controller('financials/dimensions')
export class DimensionsController extends TenantCrudController({
  permissionResource: 'financials.dimension',
  label: 'dimensions',
  createDto: Dto.CreateDimensionDto,
  updateDto: Dto.UpdateDimensionDto,
}) {
  constructor(protected readonly service: S.DimensionsService) { super(); }
}

@ApiTags('Financials — Cost Centers')
@RequireModule('financials')
@Controller('financials/cost-centers')
export class CostCentersController extends TenantCrudController({
  permissionResource: 'financials.cost_center',
  label: 'cost centers',
  createDto: Dto.CreateCostCenterDto,
  updateDto: Dto.UpdateCostCenterDto,
}) {
  constructor(protected readonly service: S.CostCentersService) { super(); }

  @ApiOperation({ summary: 'Cost centers as a tree, optionally for one dimension' })
  @RequirePermission('financials.cost_center.view')
  @Get('hierarchy')
  hierarchy(@CurrentUser() user: AuthedUser, @Query('dimensionId') dimensionId?: string) {
    return this.service.hierarchy(user.companyId as string, dimensionId);
  }
}

@ApiTags('Financials — Distribution Rules')
@RequireModule('financials')
@Controller('financials/distribution-rules')
export class DistributionRulesController extends TenantCrudController({
  permissionResource: 'financials.distribution_rule',
  label: 'distribution rules',
  createDto: Dto.CreateDistributionRuleDto,
  updateDto: Dto.UpdateDistributionRuleDto,
}) {
  constructor(protected readonly service: S.DistributionRulesService) { super(); }

  @ApiOperation({ summary: 'Preview how an amount splits across cost centers' })
  @RequirePermission('financials.distribution_rule.view')
  @Get(':id/split')
  async split(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query('amount') amount: string,
  ) {
    const parts = await this.service.split(
      user.companyId as string,
      id,
      new (await import('@prisma/client')).Prisma.Decimal(amount ?? 0),
    );
    return parts.map((p) => ({ costCenterId: p.costCenterId, amount: p.amount.toFixed(2) }));
  }
}

// ─── POSTING & RECURRING ──────────────────────────────────────────────────────
@ApiTags('Financials — Posting Templates')
@RequireModule('financials')
@Controller('financials/posting-templates')
export class PostingTemplatesController extends TenantCrudController({
  permissionResource: 'financials.posting_template',
  label: 'posting templates',
  createDto: Dto.CreatePostingTemplateDto,
  updateDto: Dto.UpdatePostingTemplateDto,
}) {
  constructor(protected readonly service: S.PostingTemplatesService) { super(); }
}

@ApiTags('Financials — Recurring Postings')
@RequireModule('financials')
@Controller('financials/recurring-postings')
export class RecurringPostingsController extends TenantCrudController({
  permissionResource: 'financials.recurring_posting',
  label: 'recurring postings',
  createDto: Dto.CreateRecurringPostingDto,
  updateDto: Dto.UpdateRecurringPostingDto,
}) {
  constructor(protected readonly service: S.RecurringPostingsService) { super(); }

  @ApiOperation({ summary: 'Recurring postings due for confirmation' })
  @RequirePermission('financials.recurring_posting.view')
  @Get('due')
  due(@CurrentUser() user: AuthedUser, @Query('asOf') asOf?: string) {
    return this.service.due(user.companyId as string, asOf ? new Date(asOf) : new Date());
  }

  @ApiOperation({ summary: 'Advance the schedule after executing' })
  @RequirePermission('financials.recurring_posting.update')
  @Post(':id/advance')
  advance(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.advance(user.companyId as string, id);
  }
}

// ─── BUDGETS ──────────────────────────────────────────────────────────────────
@ApiTags('Financials — Budget Scenarios')
@RequireModule('financials')
@Controller('financials/budget-scenarios')
export class BudgetScenariosController extends TenantCrudController({
  permissionResource: 'financials.budget',
  label: 'budget scenarios',
  createDto: Dto.CreateBudgetScenarioDto,
  updateDto: Dto.UpdateBudgetScenarioDto,
}) {
  constructor(protected readonly service: S.BudgetScenariosService) { super(); }
}

@ApiTags('Financials — Budget Distribution Methods')
@RequireModule('financials')
@Controller('financials/budget-distribution-methods')
export class BudgetDistributionMethodsController extends TenantCrudController({
  permissionResource: 'financials.budget',
  label: 'budget distribution methods',
  createDto: Dto.CreateBudgetDistributionMethodDto,
  updateDto: Dto.UpdateBudgetDistributionMethodDto,
}) {
  constructor(protected readonly service: S.BudgetDistributionMethodsService) { super(); }
}

@ApiTags('Financials — Budget')
@RequireModule('financials')
@Controller('financials/budget-lines')
export class BudgetLinesController extends TenantCrudController({
  permissionResource: 'financials.budget',
  label: 'budget lines',
  createDto: Dto.CreateBudgetLineDto,
  updateDto: Dto.UpdateBudgetLineDto,
}) {
  constructor(protected readonly service: S.BudgetLinesService) { super(); }

  @ApiOperation({ summary: 'Budget versus actual for a scenario' })
  @RequirePermission('financials.budget.view')
  @Get('versus-actual/:scenarioId')
  versusActual(@CurrentUser() user: AuthedUser, @Param('scenarioId') scenarioId: string) {
    return this.service.versusActual(user.companyId as string, scenarioId);
  }
}

// ─── ACCOUNT DETERMINATION ────────────────────────────────────────────────────
@ApiTags('Financials — G/L Account Determination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@Controller('financials/account-determination')
export class AccountDeterminationController {
  constructor(private readonly service: S.AccountDeterminationService) {}

  @ApiOperation({ summary: 'Current G/L determinations, optionally for one area' })
  @RequirePermission('financials.account_determination.view')
  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('area') area?: string) {
    return this.service.list(user.companyId as string, area);
  }

  @ApiOperation({ summary: 'Map a determination key to a G/L account' })
  @RequirePermission('financials.account_determination.update')
  @Post()
  set(@CurrentUser() user: AuthedUser, @Body() dto: Dto.SetAccountDeterminationDto) {
    return this.service.set(user.companyId as string, dto as never);
  }

  @ApiOperation({ summary: 'Clear a determination' })
  @RequirePermission('financials.account_determination.update')
  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.remove(user.companyId as string, id);
  }
}
