import {
  Body,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ModuleAccessGuard } from '../guards/module-access.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequirePermission } from '../decorators/permissions.decorator';
import { DtoValidationPipe } from '../pipes/dto-validation.pipe';
import type { ListQuery, TenantCrudService } from './tenant-crud.service';

export interface AuthedUser {
  sub: string;
  email: string;
  companyId: string | null;
  isSuperAdmin: boolean;
  roleType: string;
  departmentId: string | null;
  branchId: string | null;
  permissions: string[];
  enabledModuleSlugs: string[];
}

/**
 * Builds an abstract controller exposing the five standard tenant-scoped routes
 * against a {@link TenantCrudService}. A concrete controller extends it and adds
 * only its own `@Controller()` path plus any bespoke routes.
 *
 * Route decorators declared here are picked up through the prototype chain, so
 * subclasses inherit the full route table without restating it. Permission keys
 * are supplied per-resource so a catalog can be gated independently of its
 * parent module.
 */
export function TenantCrudController<TService extends TenantCrudService>(opts: {
  /** Permission resource, e.g. 'crm.territory' → 'crm.territory.view'. */
  permissionResource: string;
  /** Label used in Swagger summaries, e.g. 'territories'. */
  label: string;
  /** Body shape for POST. Validated with whitelist + forbidNonWhitelisted. */
  createDto: Type<object>;
  /** Body shape for PUT. Defaults to `createDto` with all fields optional. */
  updateDto?: Type<object>;
}): Type<{
  findAll(user: AuthedUser, query: ListQuery): Promise<unknown>;
  findOne(user: AuthedUser, id: string): Promise<unknown>;
  // `any` on the bodies so a subclass may re-declare a route with its own DTO
  // class (as ActivitiesController does) without tripping override checks.
  create(user: AuthedUser, dto: any): Promise<unknown>;
  update(user: AuthedUser, id: string, dto: any): Promise<unknown>;
  remove(user: AuthedUser, id: string): Promise<unknown>;
}> {
  const { permissionResource, label, createDto } = opts;
  const updateDto = opts.updateDto ?? createDto;
  const createPipe = new DtoValidationPipe(createDto);
  // PUT bodies are partial: only the fields the window actually changed are
  // sent, so missing properties must not trip @IsNotEmpty on the create shape.
  const updatePipe = new DtoValidationPipe(updateDto, { skipMissingProperties: true });

  @UseGuards(JwtAuthGuard, PermissionsGuard, ModuleAccessGuard)
  @ApiBearerAuth()
  abstract class TenantCrudControllerHost {
    protected abstract readonly service: TService;

    @ApiOperation({ summary: `List ${label}` })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'skip', required: false })
    @ApiQuery({ name: 'take', required: false })
    @RequirePermission(`${permissionResource}.view`)
    @Get()
    findAll(@CurrentUser() user: AuthedUser, @Query() query: ListQuery) {
      return this.service.findAll(user.companyId as string, query);
    }

    @ApiOperation({ summary: `Count ${label}` })
    @RequirePermission(`${permissionResource}.view`)
    @Get('count')
    count(@CurrentUser() user: AuthedUser, @Query() query: ListQuery) {
      return this.service
        .count(user.companyId as string, query)
        .then((total) => ({ total }));
    }

    @ApiOperation({ summary: `Get one of ${label}` })
    @RequirePermission(`${permissionResource}.view`)
    @Get(':id')
    findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
      return this.service.findOne(user.companyId as string, id);
    }

    @ApiOperation({ summary: `Create ${label}` })
    @RequirePermission(`${permissionResource}.create`)
    @Post()
    create(
      @CurrentUser() user: AuthedUser,
      @Body(createPipe) dto: Record<string, unknown>,
    ) {
      return this.service.create(user.companyId as string, dto);
    }

    @ApiOperation({ summary: `Update ${label}` })
    @RequirePermission(`${permissionResource}.update`)
    @Put(':id')
    update(
      @CurrentUser() user: AuthedUser,
      @Param('id') id: string,
      @Body(updatePipe) dto: Record<string, unknown>,
    ) {
      return this.service.update(user.companyId as string, id, dto);
    }

    @ApiOperation({ summary: `Delete ${label}` })
    @RequirePermission(`${permissionResource}.delete`)
    @Delete(':id')
    remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
      return this.service.remove(user.companyId as string, id);
    }
  }

  return TenantCrudControllerHost as unknown as Type<any>;
}
