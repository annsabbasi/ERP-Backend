import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, ForbiddenException, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { resolveCompanyId } from '../../common/tenancy/resolve-company-id';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermission('administration.view')
  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('companyId') qCompanyId?: string,
    @Query('scope') scope?: string,
    @Query('search') search?: string,
  ) {
    // Scopes only a platform operator may ask for. A company user naming one
    // is refused rather than quietly downgraded to their own tenant, so a bug
    // in a client cannot turn into a cross-tenant read.
    if (scope === 'platform' || scope === 'all') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException(
          `The "${scope}" scope is for platform operators. You can only list users in your own company.`,
        );
      }
      return scope === 'platform'
        ? this.usersService.findPlatformUsers()
        : this.usersService.findAllAcrossCompanies(search);
    }
    if (scope) {
      throw new BadRequestException(`Unknown scope "${scope}". Use "platform" or "all".`);
    }
    return this.usersService.findAll(resolveCompanyId(user, qCompanyId));
  }

  @RequirePermission('administration.view')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any, @Query('companyId') qCompanyId?: string) {
    return this.usersService.findOne(id, resolveCompanyId(user, qCompanyId));
  }

  @RequirePermission('administration.create')
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: any, @Query('companyId') qCompanyId?: string) {
    return this.usersService.create(dto, resolveCompanyId(user, qCompanyId), user);
  }

  @RequirePermission('administration.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: any, @Query('companyId') qCompanyId?: string) {
    // The actor is passed through because a module grant on this payload is
    // routed for approval, and the approval record has to name who asked.
    return this.usersService.update(id, dto, resolveCompanyId(user, qCompanyId), user);
  }

  @RequirePermission('administration.delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any, @Query('companyId') qCompanyId?: string) {
    return this.usersService.remove(id, resolveCompanyId(user, qCompanyId));
  }
}
