import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BpCardType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/module-access.decorator';
import { TenantCrudController } from '../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../common/crud/tenant-crud.controller';
import { DtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { BusinessPartnersService } from './business-partners/business-partners.service';
import { Customer360Service } from './customer-360/customer-360.service';
import * as S from './crm.services';
import * as Dto from './crm.dto';

// ─── BUSINESS PARTNERS ────────────────────────────────────────────────────────
@ApiTags('CRM — Business Partner Master Data')
@RequireModule('crm')
@Controller('crm/business-partners')
export class BusinessPartnersController extends TenantCrudController({
  permissionResource: 'crm.business_partner',
  label: 'business partners',
  createDto: Dto.CreateBusinessPartnerDto,
  updateDto: Dto.UpdateBusinessPartnerDto,
}) {
  constructor(protected readonly service: BusinessPartnersService) { super(); }

  @ApiOperation({ summary: 'Lightweight partner lookup for pickers' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'cardType', required: false, enum: BpCardType })
  @RequirePermission('crm.business_partner.view')
  @Get('lookup')
  lookup(
    @CurrentUser() user: AuthedUser,
    @Query('search') search?: string,
    @Query('cardType') cardType?: BpCardType,
    @Query('take') take?: string,
  ) {
    return this.service.lookup(user.companyId as string, {
      search,
      cardType,
      take: take ? Number(take) : undefined,
    });
  }

  @ApiOperation({ summary: 'Recompute running balances from the ledger' })
  @RequirePermission('crm.business_partner.update')
  @Post(':id/refresh-balances')
  refresh(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.refreshBalances(user.companyId as string, id);
  }
}

// ─── SALES ORGANISATION ───────────────────────────────────────────────────────
@ApiTags('CRM — Territories')
@RequireModule('crm')
@Controller('crm/territories')
export class TerritoriesController extends TenantCrudController({
  permissionResource: 'crm.territory',
  label: 'territories',
  createDto: Dto.CreateTerritoryDto,
  updateDto: Dto.UpdateTerritoryDto,
}) {
  constructor(protected readonly service: S.TerritoriesService) { super(); }

  @ApiOperation({ summary: 'Territories as a tree' })
  @RequirePermission('crm.territory.view')
  @Get('tree')
  tree(@CurrentUser() user: AuthedUser) {
    return this.service.tree(user.companyId as string);
  }
}

@ApiTags('CRM — Commission Groups')
@RequireModule('crm')
@Controller('crm/commission-groups')
export class CommissionGroupsController extends TenantCrudController({
  permissionResource: 'crm.commission_group',
  label: 'commission groups',
  createDto: Dto.CreateCommissionGroupDto,
  updateDto: Dto.UpdateCommissionGroupDto,
}) {
  constructor(protected readonly service: S.CommissionGroupsService) { super(); }
}

@ApiTags('CRM — Sales Employees')
@RequireModule('crm')
@Controller('crm/sales-employees')
export class SalesEmployeesController extends TenantCrudController({
  permissionResource: 'crm.sales_employee',
  label: 'sales employees / buyers',
  createDto: Dto.CreateSalesEmployeeDto,
  updateDto: Dto.UpdateSalesEmployeeDto,
}) {
  constructor(protected readonly service: S.SalesEmployeesService) { super(); }
}

// ─── SETUP CATALOGS ───────────────────────────────────────────────────────────
@ApiTags('CRM — Business Partner Groups')
@RequireModule('crm')
@Controller('crm/bp-groups')
export class BpGroupsController extends TenantCrudController({
  permissionResource: 'crm.bp_group',
  label: 'business partner groups',
  createDto: Dto.CreateBpGroupDto,
  updateDto: Dto.UpdateBpGroupDto,
}) {
  constructor(protected readonly service: S.BpGroupsService) { super(); }
}

@ApiTags('CRM — Opportunity Stages')
@RequireModule('crm')
@Controller('crm/opportunity-stages')
export class OpportunityStageDefsController extends TenantCrudController({
  permissionResource: 'crm.opportunity',
  label: 'opportunity stages',
  createDto: Dto.CreateOpportunityStageDefDto,
  updateDto: Dto.UpdateOpportunityStageDefDto,
}) {
  constructor(protected readonly service: S.OpportunityStageDefsService) { super(); }
}

@ApiTags('CRM — Competitors')
@RequireModule('crm')
@Controller('crm/competitors')
export class CompetitorsController extends TenantCrudController({
  permissionResource: 'crm.opportunity',
  label: 'competitors',
  createDto: Dto.CreateCompetitorDto,
  updateDto: Dto.UpdateCompetitorDto,
}) {
  constructor(protected readonly service: S.CompetitorsService) { super(); }
}

@ApiTags('CRM — Partners')
@RequireModule('crm')
@Controller('crm/partners')
export class CrmPartnersController extends TenantCrudController({
  permissionResource: 'crm.opportunity',
  label: 'opportunity partners',
  createDto: Dto.CreateCrmPartnerDto,
  updateDto: Dto.UpdateCrmPartnerDto,
}) {
  constructor(protected readonly service: S.CrmPartnersService) { super(); }
}

@ApiTags('CRM — Information Sources')
@RequireModule('crm')
@Controller('crm/information-sources')
export class InformationSourcesController extends TenantCrudController({
  permissionResource: 'crm.opportunity',
  label: 'information sources',
  createDto: Dto.CreateInformationSourceDto,
  updateDto: Dto.UpdateInformationSourceDto,
}) {
  constructor(protected readonly service: S.InformationSourcesService) { super(); }
}

@ApiTags('CRM — Relationship Types')
@RequireModule('crm')
@Controller('crm/relationship-types')
export class BpRelationshipTypesController extends TenantCrudController({
  permissionResource: 'crm.bp_group',
  label: 'relationship types',
  createDto: Dto.CreateBpRelationshipTypeDto,
  updateDto: Dto.UpdateBpRelationshipTypeDto,
}) {
  constructor(protected readonly service: S.BpRelationshipTypesService) { super(); }
}

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────
@ApiTags('CRM — Activities')
@RequireModule('crm')
@Controller('crm/activities')
export class ActivitiesController extends TenantCrudController({
  permissionResource: 'crm.activity',
  label: 'activities',
  createDto: Dto.CreateActivityDto,
  updateDto: Dto.UpdateActivityDto,
}) {
  constructor(protected readonly service: S.ActivitiesService) { super(); }

  // Overridden because creating an activity needs the acting user for
  // ownership and default assignment.
  @RequirePermission('crm.activity.create')
  @Post()
  create(
    @CurrentUser() user: AuthedUser,
    @Body(new DtoValidationPipe(Dto.CreateActivityDto)) dto: Dto.CreateActivityDto,
  ) {
    return this.service.createForUser(user.companyId as string, user.sub, dto);
  }

  @ApiOperation({ summary: 'My Activities' })
  @RequirePermission('crm.activity.view')
  @Get('mine')
  mine(@CurrentUser() user: AuthedUser, @Query('openOnly') openOnly?: string) {
    return this.service.myActivities(
      user.companyId as string,
      user.sub,
      openOnly !== 'false',
    );
  }

  @ApiOperation({ summary: 'Activities in a date window, for the calendar view' })
  @RequirePermission('crm.activity.view')
  @Get('calendar')
  calendar(
    @CurrentUser() user: AuthedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('mine') mine?: string,
  ) {
    return this.service.calendar(
      user.companyId as string,
      from ? new Date(from) : new Date(),
      to ? new Date(to) : new Date(Date.now() + 30 * 86_400_000),
      mine === 'true' ? user.sub : undefined,
    );
  }

  @ApiOperation({ summary: 'Activities Overview report' })
  @RequirePermission('crm.activity.view')
  @Get('overview')
  overview(
    @CurrentUser() user: AuthedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.overview(
      user.companyId as string,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}

// ─── OPPORTUNITIES ────────────────────────────────────────────────────────────
@ApiTags('CRM — Opportunities')
@RequireModule('crm')
@Controller('crm/opportunities')
export class OpportunitiesController extends TenantCrudController({
  permissionResource: 'crm.opportunity',
  label: 'opportunities',
  createDto: Dto.CreateOpportunityDto,
  updateDto: Dto.UpdateOpportunityDto,
}) {
  constructor(protected readonly service: S.OpportunitiesService) { super(); }

  @ApiOperation({ summary: 'Opportunities Pipeline — open value by stage' })
  @RequirePermission('crm.opportunity.view')
  @Get('pipeline')
  pipeline(@CurrentUser() user: AuthedUser, @Query('salesEmployeeId') salesEmployeeId?: string) {
    return this.service.pipeline(user.companyId as string, salesEmployeeId);
  }

  @ApiOperation({ summary: 'Opportunities Statistics — win rate and totals' })
  @RequirePermission('crm.opportunity.view')
  @Get('statistics')
  statistics(
    @CurrentUser() user: AuthedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.statistics(
      user.companyId as string,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @ApiOperation({ summary: 'Close an opportunity as won or lost' })
  @RequirePermission('crm.opportunity.update')
  @Post(':id/close')
  close(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body(new DtoValidationPipe(Dto.CloseOpportunityDto)) dto: Dto.CloseOpportunityDto,
  ) {
    return this.service.close(user.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Reopen a closed opportunity' })
  @RequirePermission('crm.opportunity.update')
  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.reopen(user.companyId as string, id);
  }
}

// ─── CAMPAIGNS ────────────────────────────────────────────────────────────────
@ApiTags('CRM — Campaigns')
@RequireModule('crm')
@Controller('crm/campaigns')
export class CampaignsController extends TenantCrudController({
  permissionResource: 'crm.campaign',
  label: 'campaigns',
  createDto: Dto.CreateCampaignDto,
  updateDto: Dto.UpdateCampaignDto,
}) {
  constructor(protected readonly service: S.CampaignsService) { super(); }
}

// ─── CUSTOMER 360 & CRM REPORTS ───────────────────────────────────────────────
@ApiTags('CRM — Customer 360 & Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('crm')
@Controller('crm')
export class Customer360Controller {
  constructor(private readonly service: Customer360Service) {}

  @ApiOperation({ summary: 'Everything about one business partner, in one call' })
  @RequirePermission('crm.business_partner.view')
  @Get('customer-360/:bpId')
  overview(@CurrentUser() user: AuthedUser, @Param('bpId') bpId: string) {
    return this.service.overview(user.companyId as string, bpId);
  }

  @ApiOperation({ summary: 'Inactive Customers report' })
  @RequirePermission('crm.business_partner.view')
  @Get('reports/inactive-customers')
  inactive(@CurrentUser() user: AuthedUser, @Query('sinceDays') sinceDays?: string) {
    return this.service.inactiveCustomers(
      user.companyId as string,
      sinceDays ? Number(sinceDays) : 90,
    );
  }

  @ApiOperation({ summary: 'Customers Credit Limit Deviation report' })
  @RequirePermission('crm.business_partner.view')
  @Get('reports/credit-limit-deviation')
  creditLimit(@CurrentUser() user: AuthedUser) {
    return this.service.creditLimitDeviation(user.companyId as string);
  }
}
