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
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CreateFolderDto, MoveFolderDto, UpdateFolderDto } from './dto/folder.dto';
import { FoldersService } from './folders.service';

@Controller('folders')
export class FoldersController {
  constructor(
    private readonly folders: FoldersService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('documents.view')
  @Get()
  list() {
    return this.folders.list(this.tenant.requireCompanyId());
  }

  @RequirePermission('documents.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.folders.findOne(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('folders.manage')
  @Post()
  create(@Body() dto: CreateFolderDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.folders.create(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('folders.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.folders.update(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('folders.manage')
  @Post(':id/move')
  move(
    @Param('id') id: string,
    @Body() dto: MoveFolderDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.folders.move(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('folders.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.folders.remove(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
