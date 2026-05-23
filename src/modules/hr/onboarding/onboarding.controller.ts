import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import {
  CreateOnboardingTemplateDto,
  StartOnboardingDto,
  UpdateOnboardingItemDto,
  UpdateOnboardingTemplateDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller('hr/onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly tenant: TenantContextService,
  ) {}

  // ── Templates ────────────────────────────────────────────────────────────

  @RequirePermission('hr.view')
  @Get('templates')
  listTemplates() {
    return this.onboarding.listTemplates(this.tenant.requireCompanyId());
  }

  @RequirePermission('hr.view')
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.onboarding.findTemplate(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('hr.onboarding.manage')
  @Post('templates')
  createTemplate(
    @Body() dto: CreateOnboardingTemplateDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.onboarding.createTemplate(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.onboarding.manage')
  @Patch('templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingTemplateDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.onboarding.updateTemplate(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.onboarding.manage')
  @Delete('templates/:id')
  deleteTemplate(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.onboarding.deleteTemplate(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  // ── Instances ────────────────────────────────────────────────────────────

  @RequirePermission('hr.view')
  @Get('instances')
  listInstances(@Query('employeeId') employeeId?: string) {
    return this.onboarding.listInstances(this.tenant.requireCompanyId(), { employeeId });
  }

  @RequirePermission('hr.view')
  @Get('instances/:id')
  findInstance(@Param('id') id: string) {
    return this.onboarding.findInstance(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('hr.onboarding.manage')
  @Post('instances')
  startInstance(
    @Body() dto: StartOnboardingDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.onboarding.startInstance(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOnboardingItemDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.onboarding.updateItem(this.tenant.requireCompanyId(), itemId, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }
}
