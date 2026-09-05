import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/module-access.decorator';
import { TenantCrudController } from '../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../common/crud/tenant-crud.controller';
import { FinancialIndexesService } from './indexes/indexes.service';
import { LicenseService } from './license/license.service';
import { UtilitiesService } from './utilities/utilities.service';
import * as Dto from './administration.extra.dto';

// ─── EXCHANGE RATES & INDEXES → INDEXES TAB ───────────────────────────────────
@ApiTags('Administration — Indexes')
@RequireModule('administration')
@Controller('administration/indexes')
export class IndexesController extends TenantCrudController({
  permissionResource: 'administration.index',
  label: 'indexes',
  createDto: Dto.CreateFinancialIndexDto,
  updateDto: Dto.UpdateFinancialIndexDto,
}) {
  constructor(protected readonly service: FinancialIndexesService) {
    super();
  }

  /**
   * Declared before the inherited `:id` route would match. Nest resolves in
   * declaration order and subclass methods are registered first, so `grid`,
   * `years` and `save` are safe here; a route added after them would not be.
   */
  @ApiOperation({ summary: 'Years that carry index values — fills the year picker' })
  @RequirePermission('administration.index.view')
  @Get('years')
  years(@CurrentUser() u: AuthedUser) {
    return this.service.years(u.companyId as string);
  }

  @ApiOperation({ summary: 'The month × index grid for one year' })
  @RequirePermission('administration.index.view')
  @Get('grid')
  grid(@CurrentUser() u: AuthedUser, @Query('year', ParseIntPipe) year: number) {
    return this.service.grid(u.companyId as string, year);
  }

  @ApiOperation({ summary: 'Save edited grid cells and return the refreshed grid' })
  @RequirePermission('administration.index.update')
  @Put('grid')
  saveGrid(@CurrentUser() u: AuthedUser, @Body() dto: Dto.SaveIndexGridDto) {
    return this.service.saveGrid(u.companyId as string, dto.year, dto.cells ?? []);
  }

  @ApiOperation({ summary: 'One index with its full value history' })
  @RequirePermission('administration.index.view')
  @Get(':id/history')
  history(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.history(u.companyId as string, id);
  }
}

// ─── LICENSE ──────────────────────────────────────────────────────────────────
@ApiTags('Administration — License')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('administration')
@Controller('administration/license')
export class LicenseController {
  constructor(private readonly service: LicenseService) {}

  @ApiOperation({ summary: 'Every license held by the company' })
  @RequirePermission('administration.license.view')
  @Get()
  list(@CurrentUser() u: AuthedUser) {
    return this.service.list(u.companyId as string);
  }

  @ApiOperation({ summary: 'Allocation tab — components, live seat counts, users' })
  @RequirePermission('administration.license.view')
  @Get('allocation')
  allocation(@CurrentUser() u: AuthedUser) {
    return this.service.allocation(u.companyId as string);
  }

  @ApiOperation({ summary: 'License Information — totals and expiry' })
  @RequirePermission('administration.license.view')
  @Get('information')
  information(@CurrentUser() u: AuthedUser) {
    return this.service.information(u.companyId as string);
  }

  @ApiOperation({ summary: 'Import a license file (Import License File)' })
  @RequirePermission('administration.license.manage')
  @Post('import')
  import(@CurrentUser() u: AuthedUser, @Body() dto: Dto.ImportLicenseDto) {
    return this.service.import(u.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Give a user a component seat' })
  @RequirePermission('administration.license.manage')
  @Post('assignments')
  assign(@CurrentUser() u: AuthedUser, @Body() dto: Dto.AssignLicenseSeatDto) {
    return this.service.assign(u.companyId as string, u.sub, dto.componentId, dto.userId);
  }

  @ApiOperation({ summary: 'Release a seat back to the pool' })
  @RequirePermission('administration.license.manage')
  @Delete('assignments/:id')
  unassign(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.unassign(u.companyId as string, u.sub, id);
  }

  // ── Add-On Identifier Generator ──
  @ApiOperation({ summary: 'Identifiers generated so far' })
  @RequirePermission('administration.license.view')
  @Get('add-ons')
  listAddOns(@CurrentUser() u: AuthedUser) {
    return this.service.listAddOns(u.companyId as string);
  }

  @ApiOperation({ summary: 'Generate an add-on identifier' })
  @RequirePermission('administration.license.manage')
  @Post('add-ons')
  generateAddOn(@CurrentUser() u: AuthedUser, @Body() dto: Dto.GenerateAddOnIdentifierDto) {
    return this.service.generateAddOn(u.companyId as string, u.sub, dto);
  }

  @ApiOperation({ summary: 'Delete an add-on identifier' })
  @RequirePermission('administration.license.manage')
  @Delete('add-ons/:id')
  removeAddOn(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.removeAddOn(u.companyId as string, id);
  }

  // ── Support User Log ──
  @ApiOperation({ summary: 'Support User Log' })
  @RequirePermission('administration.license.view')
  @Get('support-log')
  supportLog(
    @CurrentUser() u: AuthedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('take') take?: string,
  ) {
    return this.service.listSupportLog(u.companyId as string, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      userId,
      take: take ? Number(take) : undefined,
    });
  }
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
@ApiTags('Administration — Utilities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('administration')
@Controller('administration/utilities')
export class UtilitiesController {
  constructor(private readonly service: UtilitiesService) {}

  // ── Period-End Closing ──
  @ApiOperation({ summary: 'What a closing would post — nothing is written' })
  @RequirePermission('administration.utilities.view')
  @Post('period-end-closing/preview')
  previewClosing(@CurrentUser() u: AuthedUser, @Body() dto: Dto.PeriodEndClosingDto) {
    return this.service.previewPeriodEndClosing(u.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Execute the closing and post its journal' })
  @RequirePermission('administration.utilities.execute')
  @Post('period-end-closing/execute')
  executeClosing(@CurrentUser() u: AuthedUser, @Body() dto: Dto.PeriodEndClosingDto) {
    return this.service.executePeriodEndClosing(u.companyId as string, u.sub, dto);
  }

  @ApiOperation({ summary: 'Previous Report — closings already run' })
  @RequirePermission('administration.utilities.view')
  @Get('period-end-closing/runs')
  closingRuns(@CurrentUser() u: AuthedUser, @Query('take') take?: string) {
    return this.service.listPeriodEndClosingRuns(
      u.companyId as string,
      take ? Number(take) : undefined,
    );
  }

  @ApiOperation({ summary: 'One previous closing run' })
  @RequirePermission('administration.utilities.view')
  @Get('period-end-closing/runs/:id')
  closingRun(@CurrentUser() u: AuthedUser, @Param('id') id: string) {
    return this.service.getPeriodEndClosingRun(u.companyId as string, id);
  }

  // ── Check Document Numbering ──
  @ApiOperation({ summary: 'Check Document Numbering — series faults, gaps, duplicates' })
  @RequirePermission('administration.utilities.view')
  @Post('check-document-numbering')
  checkNumbering(@CurrentUser() u: AuthedUser, @Body() dto: Dto.CheckDocumentNumberingDto) {
    return this.service.checkDocumentNumbering(u.companyId as string, {
      documentTypes: dto.documentTypes,
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
    });
  }

  // ── Change Logs Cleanup ──
  @ApiOperation({ summary: 'How much history a cleanup would remove' })
  @RequirePermission('administration.utilities.view')
  @Post('change-logs/preview')
  previewCleanup(@CurrentUser() u: AuthedUser, @Body() dto: Dto.ChangeLogCleanupDto) {
    return this.service.previewChangeLogCleanup(u.companyId as string, new Date(dto.olderThan));
  }

  @ApiOperation({ summary: 'Remove activity history older than a cut-off' })
  @RequirePermission('administration.utilities.execute')
  @Post('change-logs/cleanup')
  runCleanup(@CurrentUser() u: AuthedUser, @Body() dto: Dto.ChangeLogCleanupDto) {
    return this.service.runChangeLogCleanup(
      u.companyId as string,
      u.sub,
      new Date(dto.olderThan),
    );
  }

  // ── Connected Clients ──
  @ApiOperation({ summary: 'Who is signed in right now' })
  @RequirePermission('administration.utilities.view')
  @Get('connected-clients')
  connectedClients(@CurrentUser() u: AuthedUser) {
    return this.service.connectedClients(u.companyId as string);
  }

  @ApiOperation({ summary: 'Sign a user out of every session' })
  @RequirePermission('administration.utilities.execute')
  @Post('connected-clients/:userId/disconnect')
  disconnect(@CurrentUser() u: AuthedUser, @Param('userId') userId: string) {
    return this.service.disconnectClient(u.companyId as string, u.sub, userId);
  }

  // ── Master Data Cleanup ──
  @ApiOperation({ summary: 'Inactive, unreferenced master data — report only' })
  @RequirePermission('administration.utilities.view')
  @Get('master-data-cleanup')
  masterDataCleanup(@CurrentUser() u: AuthedUser) {
    return this.service.masterDataCleanupCandidates(u.companyId as string);
  }
}
