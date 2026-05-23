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
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { CreatePositionDto, UpdatePositionDto } from './dto/position.dto';
import { PositionsService } from './positions.service';

@Controller('hr/positions')
export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('hr.position.view')
  @Get()
  list() {
    return this.positions.list(this.tenant.requireCompanyId());
  }

  @RequirePermission('hr.position.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.positions.findOne(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('hr.position.manage')
  @Post()
  create(@Body() dto: CreatePositionDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.positions.create(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.position.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.positions.update(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.position.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.positions.remove(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
