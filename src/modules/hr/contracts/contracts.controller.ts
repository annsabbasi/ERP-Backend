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
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { ContractsService } from './contracts.service';

@Controller('hr/employees/:employeeId/contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('hr.contract.view')
  @Get()
  list(@Param('employeeId') employeeId: string) {
    return this.contracts.list(this.tenant.requireCompanyId(), employeeId);
  }

  @RequirePermission('hr.contract.view')
  @Get(':id')
  findOne(@Param('employeeId') employeeId: string, @Param('id') id: string) {
    return this.contracts.findOne(this.tenant.requireCompanyId(), employeeId, id);
  }

  @RequirePermission('hr.contract.manage')
  @Post()
  create(
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateContractDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.contracts.create(this.tenant.requireCompanyId(), employeeId, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.contract.manage')
  @Patch(':id')
  update(
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.contracts.update(this.tenant.requireCompanyId(), employeeId, id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.contract.manage')
  @Delete(':id')
  remove(
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.contracts.remove(this.tenant.requireCompanyId(), employeeId, id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
