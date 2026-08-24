import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { resolveCompanyId } from '../../../common/tenancy/resolve-company-id';
import { ModuleGrantsService } from './module-grants.service';

export class RequestModuleGrantDto {
  @ApiProperty() @IsString() @IsNotEmpty() userId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() moduleId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

@ApiTags('Administration - Module Access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('administration/module-grants')
export class ModuleGrantsController {
  constructor(private readonly service: ModuleGrantsService) {}

  @ApiOperation({ summary: 'Ask for a user to be given a module' })
  @RequirePermission('administration.update')
  @Post()
  request(
    @CurrentUser() user: any,
    @Body() dto: RequestModuleGrantDto,
    @Query('companyId') qCompanyId?: string,
  ) {
    return this.service.request(resolveCompanyId(user, qCompanyId), user, dto);
  }

  @ApiOperation({ summary: 'Grant requests awaiting approval' })
  @RequirePermission('administration.view')
  @Get('pending')
  pending(
    @CurrentUser() user: any,
    @Query('companyId') qCompanyId?: string,
    @Query('scope') scope?: string,
  ) {
    // The platform operator approves for every tenant, so their queue cannot be
    // scoped to one. Same cross-company read the user listing needed.
    if (scope === 'all') {
      if (!user.isSuperAdmin) {
        return this.service.pending(resolveCompanyId(user, qCompanyId));
      }
      return this.service.pendingAcrossCompanies();
    }
    return this.service.pending(resolveCompanyId(user, qCompanyId));
  }

  @ApiOperation({ summary: 'Remove a user module access' })
  @RequirePermission('administration.update')
  @Delete(':userId/:moduleId')
  revoke(
    @CurrentUser() user: any,
    @Param('userId') userId: string,
    @Param('moduleId') moduleId: string,
    @Query('companyId') qCompanyId?: string,
  ) {
    return this.service.revoke(resolveCompanyId(user, qCompanyId), userId, moduleId);
  }
}
