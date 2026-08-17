import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { FiscalPeriodsService } from './fiscal-periods.service';
import {
  CreatePeriodDto,
  GeneratePeriodsDto,
  SetPeriodStatusDto,
  UpdatePeriodDto,
} from './dto/fiscal-period.dto';

@ApiTags('Financials — Posting Periods')
@RequireModule('financials')
@Controller('financials/posting-periods')
export class FiscalPeriodsController extends TenantCrudController({
  permissionResource: 'financials.period',
  label: 'posting periods',
  createDto: CreatePeriodDto,
  updateDto: UpdatePeriodDto,
}) {
  constructor(protected readonly service: FiscalPeriodsService) {
    super();
  }

  @ApiOperation({ summary: 'Create a fiscal year and all of its sub-periods' })
  @RequirePermission('financials.period.create')
  @Post('generate')
  generate(@CurrentUser() user: AuthedUser, @Body() dto: GeneratePeriodsDto) {
    return this.service.generate(user.companyId as string, dto);
  }

  @ApiOperation({ summary: 'Which period covers a date, and is it open?' })
  @RequirePermission('financials.period.view')
  @Get('resolve')
  resolve(
    @CurrentUser() user: AuthedUser,
    @Query('date') date: string,
    @Query('area') area?: 'general' | 'sales' | 'purchasing' | 'inventory',
  ) {
    return this.service.resolveOpenPeriod(
      user.companyId as string,
      date ? new Date(date) : new Date(),
      area ?? 'general',
    );
  }

  @ApiOperation({ summary: 'Open, close or lock a period (optionally one area)' })
  @RequirePermission('finance.period.close')
  @Put(':id/status')
  setStatus(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: SetPeriodStatusDto,
  ) {
    return this.service.setStatus(
      user.companyId as string,
      id,
      dto.status,
      dto.area,
      user.sub,
    );
  }
}
