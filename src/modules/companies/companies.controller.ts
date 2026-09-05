import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequirePermission,
  SuperAdminOnly,
} from '../../common/decorators/permissions.decorator';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { OnboardCompanyDto } from './dto/onboard-company.dto';
import {
  AssignModulesDto,
  UpdateBrandingDto,
  UpdateCompanyDto,
} from './dto/update-company.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @SuperAdminOnly()
  @Get()
  findAll() {
    return this.companies.findAll();
  }

  /**
   * Declared before `:id` on purpose — Nest matches routes in declaration
   * order, so a later `available` would be swallowed by the `:id` param.
   */
  @Get('available')
  available(@CurrentUser() user: any) {
    return this.companies.available(user ?? {});
  }

  @RequirePermission('administration.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.companies.findOne(id);
  }

  @SuperAdminOnly()
  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companies.create(dto);
  }

  @SuperAdminOnly()
  @Post('onboard')
  onboard(
    @Body() dto: OnboardCompanyDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.companies.onboard(dto, { actorId: user?.sub ?? null, ip: req.ip });
  }

  @SuperAdminOnly()
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(id, dto);
  }

  @RequirePermission('tenancy.branding.update')
  @Patch(':id/branding')
  updateBranding(
    @Param('id') id: string,
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.companies.updateBranding(id, dto, { actorId: user?.sub ?? null, ip: req.ip });
  }

  @SuperAdminOnly()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.companies.remove(id);
  }

  @SuperAdminOnly()
  @Post(':id/modules')
  assignModules(
    @Param('id') id: string,
    @Body() dto: AssignModulesDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.companies.assignModules(id, dto, { actorId: user?.sub ?? null, ip: req.ip });
  }

  @RequirePermission('tenancy.module.activate')
  @Patch(':id/modules/:moduleId/toggle')
  toggleModule(
    @Param('id') companyId: string,
    @Param('moduleId') moduleId: string,
    @Body('isEnabled') isEnabled: boolean,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.companies.toggleModule(companyId, moduleId, isEnabled, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
