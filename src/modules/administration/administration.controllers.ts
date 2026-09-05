import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApprovalRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/module-access.decorator';
import { TenantCrudController } from '../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../common/crud/tenant-crud.controller';
import { SettingsService } from './settings/settings.service';
import { NumberingService } from './numbering/numbering.service';
import { ApprovalsService } from './approvals/approvals.service';
import * as S from './administration.services';
import * as Dto from './administration.dto';

// ─── SYSTEM INITIALIZATION: COMPANY DETAILS + GENERAL SETTINGS ────────────────
@ApiTags('Administration — System Initialization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('administration')
@Controller('administration')
export class SystemInitializationController {
  constructor(private readonly settings: SettingsService) {}

  @ApiOperation({ summary: 'Company details for the Company Details window' })
  @RequirePermission('administration.view')
  @Get('company-details')
  getCompany(@CurrentUser() user: AuthedUser) {
    return this.settings.getCompanyDetails(user.companyId as string);
  }

  @ApiOperation({ summary: 'Update company details' })
  @RequirePermission('administration.update')
  @Put('company-details')
  updateCompany(@CurrentUser() user: AuthedUser, @Body() dto: Dto.UpdateCompanyDetailsDto) {
    return this.settings.updateCompanyDetails(user.companyId as string, dto);
  }

  @ApiOperation({
    summary: 'Save the Company Details window (company row + detail fields) in one transaction',
  })
  @RequirePermission('administration.update')
  @Put('company-details/save')
  saveCompany(@CurrentUser() user: AuthedUser, @Body() dto: Dto.SaveCompanyDetailsDto) {
    return this.settings.saveCompanyDetails(user.companyId as string, user.sub, dto);
  }

  @ApiOperation({ summary: 'All settings groups, defaults merged with overrides' })
  @RequirePermission('administration.view')
  @Get('settings')
  allSettings(@CurrentUser() user: AuthedUser) {
    return this.settings.getAll(user.companyId as string);
  }

  @ApiOperation({ summary: 'One settings group' })
  @RequirePermission('administration.view')
  @Get('settings/:group')
  group(@CurrentUser() user: AuthedUser, @Param('group') group: string) {
    return this.settings.getGroup(user.companyId as string, group);
  }

  @ApiOperation({ summary: 'Merge values into a settings group' })
  @RequirePermission('administration.update')
  @Put('settings')
  upsertSettings(@CurrentUser() user: AuthedUser, @Body() dto: Dto.UpsertSettingsDto) {
    return this.settings.upsertGroup(user.companyId as string, user.sub, dto);
  }

  @ApiOperation({ summary: 'Reset a settings group (or one key) to defaults' })
  @RequirePermission('administration.update')
  @Delete('settings/:group')
  resetSettings(
    @CurrentUser() user: AuthedUser,
    @Param('group') group: string,
    @Query('key') key?: string,
  ) {
    return this.settings.reset(user.companyId as string, group, key);
  }

  @ApiOperation({ summary: 'Document settings, all types' })
  @RequirePermission('administration.view')
  @Get('document-settings')
  listDocSettings(@CurrentUser() user: AuthedUser, @Query('documentType') documentType?: string) {
    return documentType
      ? this.settings.getDocumentSettings(user.companyId as string, documentType)
      : this.settings.listDocumentSettings(user.companyId as string);
  }

  @ApiOperation({ summary: 'Merge document settings for a type (omit type for General)' })
  @RequirePermission('administration.update')
  @Put('document-settings')
  upsertDocSettings(
    @CurrentUser() user: AuthedUser,
    @Body() dto: Dto.UpsertDocumentSettingsDto,
  ) {
    return this.settings.upsertDocumentSettings(user.companyId as string, dto);
  }
}

// ─── DOCUMENT NUMBERING ───────────────────────────────────────────────────────
@ApiTags('Administration — Document Numbering')
@RequireModule('administration')
@Controller('administration/numbering-series')
export class NumberingController extends TenantCrudController({
  permissionResource: 'administration.numbering',
  label: 'numbering series',
  createDto: Dto.CreateNumberingSeriesDto,
  updateDto: Dto.UpdateNumberingSeriesDto,
}) {
  constructor(protected readonly service: NumberingService) { super(); }

  @ApiOperation({ summary: 'Document types available for numbering' })
  @RequirePermission('administration.numbering.view')
  @Get('document-types')
  documentTypes(@CurrentUser() user: AuthedUser) {
    return this.service.documentTypes(user.companyId as string);
  }

  @ApiOperation({ summary: 'Check Document Numbering — report series problems' })
  @RequirePermission('administration.numbering.view')
  @Get('check')
  check(@CurrentUser() user: AuthedUser) {
    return this.service.check(user.companyId as string);
  }

  @ApiOperation({ summary: 'Make a series the default for its document type' })
  @RequirePermission('administration.numbering.update')
  @Post(':id/set-default')
  setDefault(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.setDefault(user.companyId as string, id);
  }
}

// ─── SETUP CATALOGS ───────────────────────────────────────────────────────────
@ApiTags('Administration — Predefined Text')
@RequireModule('administration')
@Controller('administration/predefined-text')
export class PredefinedTextController extends TenantCrudController({
  permissionResource: 'administration.predefined_text',
  label: 'predefined texts',
  createDto: Dto.CreatePredefinedTextDto,
  updateDto: Dto.UpdatePredefinedTextDto,
}) {
  constructor(protected readonly service: S.PredefinedTextService) { super(); }
}

@ApiTags('Administration — Countries & Regions')
@RequireModule('administration')
@Controller('administration/countries')
export class CountriesController extends TenantCrudController({
  permissionResource: 'administration.country',
  label: 'countries',
  createDto: Dto.CreateCountryDto,
  updateDto: Dto.UpdateCountryDto,
}) {
  constructor(protected readonly service: S.CountriesService) { super(); }

  @ApiOperation({ summary: 'Add a state/region to a country' })
  @RequirePermission('administration.country.update')
  @Post('regions')
  addRegion(@CurrentUser() user: AuthedUser, @Body() dto: Dto.CreateStateRegionDto) {
    return this.service.addRegion(user.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Delete a state/region' })
  @RequirePermission('administration.country.update')
  @Delete('regions/:regionId')
  removeRegion(@CurrentUser() user: AuthedUser, @Param('regionId') regionId: string) {
    return this.service.removeRegion(user.companyId as string, regionId);
  }
}

@ApiTags('Administration — User Groups')
@RequireModule('administration')
@Controller('administration/user-groups')
export class UserGroupsController extends TenantCrudController({
  permissionResource: 'administration.user_group',
  label: 'user groups',
  createDto: Dto.CreateUserGroupDto,
  updateDto: Dto.UpdateUserGroupDto,
}) {
  constructor(protected readonly service: S.UserGroupsService) { super(); }
}

@ApiTags('Administration — User Defaults')
@RequireModule('administration')
@Controller('administration/user-defaults')
export class UserDefaultsController extends TenantCrudController({
  permissionResource: 'administration.user_defaults',
  label: 'user defaults groups',
  createDto: Dto.CreateUserDefaultsGroupDto,
  updateDto: Dto.UpdateUserDefaultsGroupDto,
}) {
  constructor(protected readonly service: S.UserDefaultsService) { super(); }

  @ApiOperation({ summary: 'Effective defaults for a user' })
  @RequirePermission('administration.user_defaults.view')
  @Get('for-user/:userId')
  forUser(@CurrentUser() user: AuthedUser, @Param('userId') userId: string) {
    return this.service.forUser(user.companyId as string, userId);
  }

  @ApiOperation({ summary: 'Assign users to a defaults group' })
  @RequirePermission('administration.user_defaults.update')
  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: { userIds: string[] },
  ) {
    return this.service.assign(user.companyId as string, id, body.userIds ?? []);
  }
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────
@ApiTags('Administration — Alerts Management')
@RequireModule('administration')
@Controller('administration/alerts')
export class AlertsController extends TenantCrudController({
  permissionResource: 'administration.alert',
  label: 'alerts',
  createDto: Dto.CreateAlertDto,
  updateDto: Dto.UpdateAlertDto,
}) {
  constructor(protected readonly service: S.AlertsService) { super(); }

  @ApiOperation({ summary: "The signed-in user's alert inbox" })
  @RequirePermission('administration.alert.view')
  @Get('inbox')
  inbox(@CurrentUser() user: AuthedUser, @Query('unreadOnly') unreadOnly?: string) {
    return this.service.inbox(user.companyId as string, user.sub, unreadOnly === 'true');
  }

  @ApiOperation({ summary: 'Mark alert instances as read' })
  @RequirePermission('administration.alert.view')
  @Post('inbox/mark-read')
  markRead(@CurrentUser() user: AuthedUser, @Body() body: { instanceIds: string[] }) {
    return this.service.markRead(user.companyId as string, user.sub, body.instanceIds ?? []);
  }
}

// ─── APPROVALS ────────────────────────────────────────────────────────────────
@ApiTags('Administration — Approval Process')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('administration')
@Controller('administration/approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  // ── Stages ──
  @ApiOperation({ summary: 'List approval stages' })
  @RequirePermission('administration.approval.view')
  @Get('stages')
  listStages(@CurrentUser() u: AuthedUser) {
    return this.service.listStages(u.companyId as string);
  }

  @ApiOperation({ summary: 'Get an approval stage' })
  @RequirePermission('administration.approval.view')
  @Get('stages/:id')
  getStage(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.getStage(u.companyId as string, id);
  }

  @ApiOperation({ summary: 'Create an approval stage' })
  @RequirePermission('administration.approval.manage')
  @Post('stages')
  createStage(@CurrentUser() u: AuthedUser, @Body() dto: Dto.CreateApprovalStageDto) {
    return this.service.createStage(u.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Update an approval stage' })
  @RequirePermission('administration.approval.manage')
  @Put('stages/:id')
  updateStage(
    @CurrentUser() u: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.UpdateApprovalStageDto,
  ) {
    return this.service.updateStage(u.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Delete an approval stage' })
  @RequirePermission('administration.approval.manage')
  @Delete('stages/:id')
  removeStage(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.removeStage(u.companyId as string, id);
  }

  // ── Templates ──
  @ApiOperation({ summary: 'List approval templates' })
  @RequirePermission('administration.approval.view')
  @Get('templates')
  listTemplates(@CurrentUser() u: AuthedUser) {
    return this.service.listTemplates(u.companyId as string);
  }

  @ApiOperation({ summary: 'Get an approval template' })
  @RequirePermission('administration.approval.view')
  @Get('templates/:id')
  getTemplate(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.getTemplate(u.companyId as string, id);
  }

  @ApiOperation({ summary: 'Create an approval template' })
  @RequirePermission('administration.approval.manage')
  @Post('templates')
  createTemplate(@CurrentUser() u: AuthedUser, @Body() dto: Dto.CreateApprovalTemplateDto) {
    return this.service.createTemplate(u.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Update an approval template' })
  @RequirePermission('administration.approval.manage')
  @Put('templates/:id')
  updateTemplate(
    @CurrentUser() u: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.UpdateApprovalTemplateDto,
  ) {
    return this.service.updateTemplate(u.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Delete an approval template' })
  @RequirePermission('administration.approval.manage')
  @Delete('templates/:id')
  removeTemplate(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.removeTemplate(u.companyId as string, id);
  }

  // ── Requests & decisions ──
  @ApiOperation({ summary: 'Submit a document for approval' })
  @RequirePermission('administration.approval.submit')
  @Post('requests')
  submit(@CurrentUser() u: AuthedUser, @Body() dto: Dto.SubmitForApprovalDto) {
    return this.service.submit(u.companyId as string, u.sub, dto);
  }

  @ApiOperation({ summary: 'Approval Status Report' })
  @RequirePermission('administration.approval.view')
  @Get('requests')
  listRequests(
    @CurrentUser() u: AuthedUser,
    @Query('status') status?: ApprovalRequestStatus,
    @Query('documentType') documentType?: string,
    @Query('originatorId') originatorId?: string,
  ) {
    return this.service.listRequests(u.companyId as string, { status, documentType, originatorId });
  }

  @ApiOperation({ summary: 'Requests waiting on the signed-in user' })
  @RequirePermission('administration.approval.view')
  @Get('requests/my-queue')
  myQueue(@CurrentUser() u: AuthedUser) {
    return this.service.myQueue(u.companyId as string, u.sub);
  }

  /**
   * A company user acts inside their own tenant. A platform operator is inside
   * none, so the company comes from the request they named.
   */
  private async companyFor(u: AuthedUser, requestId: string): Promise<string> {
    if (u.companyId) return u.companyId as string;
    return this.service.companyIdForRequest(requestId);
  }

  @ApiOperation({ summary: 'Get one approval request' })
  @RequirePermission('administration.approval.view')
  @Get('requests/:id')
  async getRequest(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.getRequest(await this.companyFor(u, id), id);
  }

  @ApiOperation({ summary: 'Approve or reject the current stage' })
  @RequirePermission('administration.approval.decide')
  @Post('requests/:id/decide')
  async decide(
    @CurrentUser() u: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ApprovalDecisionDto,
  ) {
    return this.service.decide(await this.companyFor(u, id), id, u.sub, dto);
  }

  @ApiOperation({ summary: 'Withdraw a request (originator only)' })
  @RequirePermission('administration.approval.submit')
  @Post('requests/:id/cancel')
  async cancel(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.cancel(await this.companyFor(u, id), id, u.sub);
  }

  @ApiOperation({ summary: 'Approval Decision Report' })
  @RequirePermission('administration.approval.view')
  @Get('decisions/report')
  decisions(
    @CurrentUser() u: AuthedUser,
    @Query('approverId') approverId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listDecisions(u.companyId as string, {
      approverId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}

@ApiTags('Administration — Substitute Authorizers')
@RequireModule('administration')
@Controller('administration/substitute-authorizers')
export class SubstituteAuthorizersController extends TenantCrudController({
  permissionResource: 'administration.approval',
  label: 'substitute authorizers',
  createDto: Dto.CreateSubstituteAuthorizerDto,
  updateDto: Dto.UpdateSubstituteAuthorizerDto,
}) {
  constructor(protected readonly service: S.SubstituteAuthorizersService) { super(); }
}
