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

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('hr.view')
  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('managerId') managerId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.employees.findAll(user.companyId, {
      branchId,
      departmentId,
      managerId,
      status: status ? (status.toUpperCase() as EmployeeStatus) : undefined,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @RequirePermission('hr.view')
  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.employees.findOne(user.companyId, id);
  }

  @RequirePermission('hr.view')
  @Get(':id/reports')
  reports(@CurrentUser() user: any, @Param('id') id: string) {
    return this.employees.directReports(user.companyId, id);
  }

  @RequirePermission('hr.create')
  @Post()
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateEmployeeDto,
    @Req() req: Request,
  ) {
    return this.employees.create(user.companyId, dto, {
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
    return this.employees.update(user.companyId, id, dto, {
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
    return this.employees.terminate(user.companyId, id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.employee.hire')
  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: any, @Param('id') id: string, @Req() req: Request) {
    return this.employees.reactivate(user.companyId, id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('hr.delete')
  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string, @Req() req: Request) {
    return this.employees.remove(user.companyId, id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
