import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { resolveCompanyId } from '../../common/tenancy/resolve-company-id';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @RequirePermission('hr.view')
  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') qCompanyId?: string) {
    return this.departmentsService.findAll(resolveCompanyId(user, qCompanyId));
  }

  @RequirePermission('hr.view')
  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string, @Query('companyId') qCompanyId?: string) {
    return this.departmentsService.findOne(resolveCompanyId(user, qCompanyId), id);
  }

  @RequirePermission('hr.create')
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateDepartmentDto, @Query('companyId') qCompanyId?: string) {
    return this.departmentsService.create(resolveCompanyId(user, qCompanyId), dto);
  }

  @RequirePermission('hr.update')
  @Put(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @Query('companyId') qCompanyId?: string,
  ) {
    return this.departmentsService.update(resolveCompanyId(user, qCompanyId), id, dto);
  }

  @RequirePermission('hr.delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('companyId') qCompanyId?: string,
  ) {
    return this.departmentsService.remove(resolveCompanyId(user, qCompanyId), id);
  }
}
