import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmployeeStatus } from '@prisma/client';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { TerminateEmployeeDto } from './dto/terminate-employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { TenantContextService } from '../../common/context/tenant-context.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('hr.view')
  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('managerId') managerId?: string,
    @Query('status') status?: string,
    @Query('employeeCategoryId') employeeCategoryId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.employees.findAll(this.tenant.requireCompanyId(), {
      branchId,
      departmentId,
      managerId,
      employeeCategoryId,
      status: status ? (status.toUpperCase() as EmployeeStatus) : undefined,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @RequirePermission('hr.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('hr.view')
  @Get(':id/reports')
  reports(@Param('id') id: string) {
    return this.employees.directReports(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('hr.create')
  @Post()
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateEmployeeDto,
    @Req() req: Request,
  ) {
    return this.employees.create(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.update')
  @Put(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: Request,
  ) {
    return this.employees.update(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.employee.terminate')
  @Patch(':id/terminate')
  terminate(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: TerminateEmployeeDto,
    @Req() req: Request,
  ) {
    return this.employees.terminate(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.employee.hire')
  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: any, @Param('id') id: string, @Req() req: Request) {
    return this.employees.reactivate(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.delete')
  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string, @Req() req: Request) {
    return this.employees.remove(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
