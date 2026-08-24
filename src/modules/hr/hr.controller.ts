import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, BadRequestException, UseGuards,
} from '@nestjs/common';
import { HrService } from './hr.service';
import { CreateHrRoleDto } from './dto/create-hr-role.dto';
import { CreateHrUserDto, UpdateHrUserDto } from './dto/create-hr-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { resolveCompanyId } from '../../common/tenancy/resolve-company-id';
import { RequireModule } from '../../common/decorators/module-access.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
@RequireModule('hr')
@Controller('hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  // ── HR Role Management ─────────────────────────────────────────────────────
  // hr:VIEW   → HR Viewer, HR Manager, HR Admin
  // hr:MANAGE → HR Admin only

  @RequirePermission('hr.view')
  @Get('roles')
  findAllHrRoles(@CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.findAllHrRoles(resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.view')
  @Get('roles/permissions/available')
  getHrAvailablePermissions(@CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.getHrAvailablePermissions(resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.view')
  @Get('roles/:id')
  findOneHrRole(@Param('id') id: string, @CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.findOneHrRole(id, resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.manage')
  @Post('roles')
  createHrRole(@Body() dto: CreateHrRoleDto, @CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.createHrRole(dto, resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.manage')
  @Patch('roles/:id')
  updateHrRole(
    @Param('id') id: string,
    @Body() dto: Partial<CreateHrRoleDto>,
    @CurrentUser() user: any,
    @Query('companyId') cid?: string,
  ) {
    return this.hrService.updateHrRole(id, dto, resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.manage')
  @Delete('roles/:id')
  removeHrRole(@Param('id') id: string, @CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.removeHrRole(id, resolveCompanyId(user, cid));
  }

  // ── HR User Management ─────────────────────────────────────────────────────
  // hr:VIEW   → read HR users
  // hr:CREATE → HR Manager + Admin can add users
  // hr:UPDATE → HR Manager + Admin can edit users
  // hr:DELETE → HR Manager + Admin can deactivate users
  // hr:MANAGE → HR Admin can reassign roles

  @RequirePermission('hr.view')
  @Get('users')
  findHrUsers(@CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.findHrUsers(resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.view')
  @Get('users/:id')
  findOneHrUser(@Param('id') id: string, @CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.findOneHrUser(id, resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.create')
  @Post('users')
  createHrUser(@Body() dto: CreateHrUserDto, @CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.createHrUser(dto, resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.update')
  @Patch('users/:id')
  updateHrUser(
    @Param('id') id: string,
    @Body() dto: UpdateHrUserDto,
    @CurrentUser() user: any,
    @Query('companyId') cid?: string,
  ) {
    return this.hrService.updateHrUser(id, dto, resolveCompanyId(user, cid));
  }

  @RequirePermission('hr.delete')
  @Delete('users/:id')
  removeHrUser(@Param('id') id: string, @CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.removeHrUser(id, resolveCompanyId(user, cid));
  }

  // ── Seed Default Roles ─────────────────────────────────────────────────────
  // Only HR Admin (hr:MANAGE) or a company Sub-Admin can trigger this.

  @RequirePermission('hr.manage')
  @Post('seed-defaults')
  seedDefaultHrRoles(@CurrentUser() user: any, @Query('companyId') cid?: string) {
    return this.hrService.seedDefaultHrRoles(resolveCompanyId(user, cid));
  }
}
