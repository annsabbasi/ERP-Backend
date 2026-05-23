import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { DocumentStatus } from '@prisma/client';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { DocumentsService, UploadedFile as DocUpload } from './documents.service';
import { UpdateDocumentDto, UploadMetadataDto } from './dto/document.dto';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly tenant: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  // ── List / Get ───────────────────────────────────────────────────────────

  @RequirePermission('documents.view')
  @Get()
  list(
    @Query('folderId') folderId?: string,
    @Query('refType') refType?: string,
    @Query('refId') refId?: string,
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.documents.list(this.tenant.requireCompanyId(), {
      folderId: folderId === 'root' ? null : folderId,
      refType,
      refId,
      status: status ? (status.toUpperCase() as DocumentStatus) : undefined,
      tag,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @RequirePermission('documents.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documents.findOne(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('documents.view')
  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.documents.listVersions(this.tenant.requireCompanyId(), id);
  }

  @RequirePermission('documents.view')
  @Get(':id/access-log')
  accessLog(@Param('id') id: string) {
    return this.documents.listAccessLog(this.tenant.requireCompanyId(), id);
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  @RequirePermission('documents.create')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage is fine for typical ERP documents (contracts, invoices,
      // a few MB tops). The limit is enforced by config; large-file uploads
      // can switch to disk storage later.
      limits: {},
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: UploadMetadataDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    this.enforceSizeLimit(file);
    return this.documents.upload(
      this.tenant.requireCompanyId(),
      toAdapterFile(file),
      meta ?? new UploadMetadataDto(),
      { actorId: user?.sub ?? null, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
  }

  @RequirePermission('documents.create')
  @Post(':id/versions')
  @UseInterceptors(FileInterceptor('file'))
  async uploadVersion(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    this.enforceSizeLimit(file);
    return this.documents.uploadNewVersion(
      this.tenant.requireCompanyId(),
      id,
      toAdapterFile(file),
      notes,
      { actorId: user?.sub ?? null, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
  }

  // ── Update / Delete / Restore ────────────────────────────────────────────

  @RequirePermission('documents.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.documents.update(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('documents.delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.documents.softDelete(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('documents.delete')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.documents.restore(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  // ── Download (current version + specific version) ────────────────────────

  @RequirePermission('documents.view')
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { buffer, document, version } = await this.documents.download(
      this.tenant.requireCompanyId(),
      id,
      { actorId: user?.sub ?? null, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
    sendFile(res, buffer, document.name, version.mimeType);
  }

  @RequirePermission('documents.view')
  @Get(':id/versions/:versionId/download')
  async downloadVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { buffer, document, version } = await this.documents.download(
      this.tenant.requireCompanyId(),
      id,
      { actorId: user?.sub ?? null, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
      versionId,
    );
    sendFile(res, buffer, `${document.name} (v${version.versionNumber})`, version.mimeType);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private enforceSizeLimit(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('No file uploaded under field "file"');
    const max = this.config.get<number>('storage.maxUploadBytes', 50 * 1024 * 1024);
    if (file.size > max) {
      throw new BadRequestException(`File exceeds size limit (${max} bytes)`);
    }
  }
}

function toAdapterFile(file: Express.Multer.File): DocUpload {
  return {
    originalname: file.originalname,
    mimetype: file.mimetype,
    buffer: file.buffer,
    size: file.size,
  };
}

function sendFile(res: Response, buffer: Buffer, filename: string, mimeType: string) {
  res
    .status(200)
    .setHeader('Content-Type', mimeType || 'application/octet-stream')
    .setHeader('Content-Length', String(buffer.byteLength))
    .setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`)
    .end(buffer);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_');
}
