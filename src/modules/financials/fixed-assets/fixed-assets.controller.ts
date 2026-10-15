import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../../common/decorators/idempotency-key.decorator';
import { KeyBoundWrite } from '../../../common/decorators/key-bound-write.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { DtoValidationPipe } from '../../../common/pipes/dto-validation.pipe';
import { FixedAssetsService } from './fixed-assets.service';
import {
  AssetClassesService,
  DepreciationAreasService,
  DEPRECIATION_METHODS,
} from './asset-setup.services';
import { AssetCapitalizationsService } from './asset-capitalizations.service';
import {
  CancelAssetCapitalizationDto,
  CreateAssetCapitalizationDto,
  CreateAssetClassDto,
  CreateDepreciationAreaDto,
  CreateFixedAssetDto,
  DepreciationRunDto,
  ListAssetCapitalizationsQuery,
  UpdateAssetClassDto,
  UpdateDepreciationAreaDto,
  UpdateFixedAssetDto,
} from './fixed-assets.dto';

// ─── ASSET MASTER DATA ────────────────────────────────────────────────────────
@ApiTags('Financials — Fixed Assets')
@RequireModule('financials')
@Controller('financials/fixed-assets')
export class FixedAssetsController extends TenantCrudController({
  permissionResource: 'financials.fixed_asset',
  label: 'fixed assets',
  createDto: CreateFixedAssetDto,
  updateDto: UpdateFixedAssetDto,
}) {
  constructor(protected readonly service: FixedAssetsService) {
    super();
  }

  // This class's routes are registered ahead of the inherited ':id', so the
  // literal 'lookups' is never read as an asset id (same as crm 'lookup').
  @ApiOperation({
    summary: 'Everything the Asset Master Data window offers in its dropdowns',
  })
  @RequirePermission('financials.fixed_asset.view')
  @Get('lookups')
  lookups(@CurrentUser() user: AuthedUser) {
    return this.service.lookups(user.companyId as string);
  }

  @ApiOperation({
    summary:
      'Run depreciation across capitalized assets, per depreciation area',
  })
  // Posting to the G/L is its own right, not part of editing an asset (B12).
  @RequirePermission('financials.fixed_asset.depreciate')
  @Post('depreciation-run')
  depreciationRun(
    @CurrentUser() user: AuthedUser,
    @Body(new DtoValidationPipe(DepreciationRunDto)) dto: DepreciationRunDto,
  ) {
    return this.service.depreciationRun(
      user.companyId as string,
      user.sub,
      dto,
    );
  }

  @ApiOperation({
    summary: "The asset's values per fiscal year, per depreciation area",
  })
  @RequirePermission('financials.fixed_asset.view')
  @Get(':id/values')
  values(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.values(user.companyId as string, id);
  }

  @ApiOperation({
    summary: 'Planned depreciation for the coming months, for one area',
  })
  @RequirePermission('financials.fixed_asset.view')
  @Get(':id/forecast')
  forecast(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query('months') months?: string,
    @Query('areaId') areaId?: string,
  ) {
    return this.service.forecast(
      user.companyId as string,
      id,
      Math.min(Math.max(Math.trunc(Number(months) || 12), 1), 600),
      areaId || undefined,
    );
  }

  @ApiOperation({
    summary: 'Retire an asset (not available yet: refused with 409)',
  })
  @RequirePermission('financials.fixed_asset.update')
  @Post(':id/retire')
  retire() {
    return this.service.retire();
  }
}

// ─── SETUP: ASSET CLASSES ─────────────────────────────────────────────────────
@ApiTags('Financials — Fixed Assets Setup')
@RequireModule('financials')
@Controller('financials/asset-classes')
export class AssetClassesController extends TenantCrudController({
  permissionResource: 'financials.asset_class',
  label: 'asset classes',
  createDto: CreateAssetClassDto,
  updateDto: UpdateAssetClassDto,
}) {
  constructor(protected readonly service: AssetClassesService) {
    super();
  }

  @ApiOperation({
    summary:
      'Postable accounts and depreciation methods for the Asset Classes window',
  })
  @RequirePermission('financials.asset_class.view')
  @Get('lookups')
  async lookups(@CurrentUser() user: AuthedUser) {
    return {
      accounts: await this.service.lookups(user.companyId as string),
      depreciationMethods: DEPRECIATION_METHODS,
    };
  }
}

// ─── SETUP: DEPRECIATION AREAS ────────────────────────────────────────────────
@ApiTags('Financials — Fixed Assets Setup')
@RequireModule('financials')
@Controller('financials/depreciation-areas')
export class DepreciationAreasController extends TenantCrudController({
  permissionResource: 'financials.depreciation_area',
  label: 'depreciation areas',
  createDto: CreateDepreciationAreaDto,
  updateDto: UpdateDepreciationAreaDto,
}) {
  constructor(protected readonly service: DepreciationAreasService) {
    super();
  }
}

// ─── CAPITALIZATION / CAPITALIZATION CREDIT MEMO ──────────────────────────────
@ApiTags('Financials — Fixed Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('financials')
@Controller('financials/asset-capitalizations')
export class AssetCapitalizationsController {
  constructor(private readonly service: AssetCapitalizationsService) {}

  @ApiOperation({
    summary:
      'List capitalizations or credit memos (?kind=CAPITALIZATION|CREDIT_MEMO)',
  })
  @RequirePermission('financials.fixed_asset_document.view')
  @Get()
  findAll(
    @CurrentUser() user: AuthedUser,
    @Query(new DtoValidationPipe(ListAssetCapitalizationsQuery))
    q: ListAssetCapitalizationsQuery,
  ) {
    return this.service.findAll(user.companyId as string, q.kind);
  }

  @ApiOperation({
    summary:
      'Series, areas, assets, A/P invoices and base documents for the window',
  })
  @RequirePermission('financials.fixed_asset_document.view')
  @Get('lookups')
  lookups(
    @CurrentUser() user: AuthedUser,
    @Query(new DtoValidationPipe(ListAssetCapitalizationsQuery))
    q: ListAssetCapitalizationsQuery,
  ) {
    return this.service.lookups(user.companyId as string, q.kind);
  }

  @ApiOperation({
    summary: 'One capitalization document with its lines and journal entry',
  })
  @RequirePermission('financials.fixed_asset_document.view')
  @Get(':id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId as string, id);
  }

  @ApiOperation({
    summary: 'Add (post) a capitalization or capitalization credit memo',
  })
  // The document stores the key under a unique index, so a reclaimed stale
  // key cannot post twice (see KeyBoundWrite).
  @RequirePermission('financials.fixed_asset_document.create')
  @KeyBoundWrite()
  @Post()
  create(
    @CurrentUser() user: AuthedUser,
    @Body(new DtoValidationPipe(CreateAssetCapitalizationDto))
    dto: CreateAssetCapitalizationDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.service.create(
      user.companyId as string,
      user.sub,
      dto,
      idempotencyKey,
    );
  }

  @ApiOperation({
    summary:
      'Cancel a document: reverses its journal entry and its effect on the assets',
  })
  @RequirePermission('financials.fixed_asset_document.cancel')
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body(new DtoValidationPipe(CancelAssetCapitalizationDto))
    dto: CancelAssetCapitalizationDto,
  ) {
    return this.service.cancel(user.companyId as string, id, user.sub, dto);
  }
}
