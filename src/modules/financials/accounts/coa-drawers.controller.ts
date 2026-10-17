import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../../common/guards/module-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { CoaDrawersService } from './coa-drawers.service';

class CoaDrawerItemDto {
  @IsEnum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'])
  type!: AccountType;

  @IsString()
  @Length(2, 2)
  code!: string;

  @IsString()
  @Length(1, 40)
  label!: string;

  @IsBoolean()
  visible!: boolean;

  @IsInt()
  @Min(0)
  order!: number;
}

class SetCoaDrawersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoaDrawerItemDto)
  drawers!: CoaDrawerItemDto[];
}

@ApiTags('Financials — COA Drawers')
@RequireModule('financials')
@UseGuards(JwtAuthGuard, ModuleAccessGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller('financials/coa-drawers')
export class CoaDrawersController {
  constructor(private readonly service: CoaDrawersService) {}

  @ApiOperation({
    summary: 'Get the Chart of Accounts drawer (tab) configuration for the active company',
  })
  @RequirePermission('financials.account.view')
  @Get()
  get(@CurrentUser() user: AuthedUser) {
    return this.service.get(user.companyId as string);
  }

  @ApiOperation({
    summary: 'Save the Chart of Accounts drawer (tab) configuration for the active company',
  })
  @RequirePermission('financials.account.update')
  @Put()
  set(@CurrentUser() user: AuthedUser, @Body() body: SetCoaDrawersDto) {
    return this.service.set(user.companyId as string, body.drawers, user.sub);
  }
}
