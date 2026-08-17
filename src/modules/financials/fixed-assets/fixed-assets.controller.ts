import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { FixedAssetsService } from './fixed-assets.service';
import {
  CapitalizeAssetDto,
  CreateFixedAssetDto,
  DepreciationRunDto,
  UpdateFixedAssetDto,
} from '../setup/setup.dto';

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

  @ApiOperation({ summary: 'Run depreciation across capitalized assets' })
  @RequirePermission('financials.fixed_asset.update')
  @Post('depreciation-run')
  depreciationRun(@CurrentUser() user: AuthedUser, @Body() dto: DepreciationRunDto) {
    return this.service.depreciationRun(user.companyId as string, user.sub, dto);
  }

  @ApiOperation({ summary: 'Capitalize an asset and post it to the ledger' })
  @RequirePermission('financials.fixed_asset.update')
  @Post(':id/capitalize')
  capitalize(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CapitalizeAssetDto,
  ) {
    return this.service.capitalize(user.companyId as string, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Retire an asset' })
  @RequirePermission('financials.fixed_asset.update')
  @Post(':id/retire')
  retire(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: { postingDate: string; remarks?: string },
  ) {
    return this.service.retire(user.companyId as string, id, user.sub, dto);
  }

  @ApiOperation({ summary: 'Projected depreciation for the coming months' })
  @RequirePermission('financials.fixed_asset.view')
  @Get(':id/forecast')
  forecast(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query('months') months?: string,
  ) {
    return this.service.forecast(user.companyId as string, id, months ? Number(months) : 12);
  }
}
