import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CreateShareLinkDto, OpenShareLinkDto } from './dto/document.dto';
import { ShareLinksService } from './share-links.service';

@Controller()
export class ShareLinksController {
  constructor(
    private readonly shareLinks: ShareLinksService,
    private readonly tenant: TenantContextService,
  ) {}

  // ── Admin endpoints (authenticated) ──────────────────────────────────────

  @RequirePermission('documents.share')
  @Post('documents/:documentId/share-links')
  create(
    @Param('documentId') documentId: string,
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shareLinks.create(this.tenant.requireCompanyId(), documentId, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('documents.view')
  @Get('documents/:documentId/share-links')
  list(@Param('documentId') documentId: string) {
    return this.shareLinks.list(this.tenant.requireCompanyId(), documentId);
  }

  @RequirePermission('documents.share')
  @Delete('share-links/:id')
  revoke(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.shareLinks.revoke(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }

  // ── Public endpoints — unauthenticated, scoped by opaque token ───────────

  @Public()
  @Get('share/:token')
  describe(@Param('token') token: string) {
    return this.shareLinks.describePublic(token);
  }

  @Public()
  @Post('share/:token/access')
  async access(
    @Param('token') token: string,
    @Body() dto: OpenShareLinkDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { buffer, document, version } = await this.shareLinks.openPublic(
      token,
      dto?.password,
      { actorId: null, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
    res
      .status(200)
      .setHeader('Content-Type', version.mimeType || 'application/octet-stream')
      .setHeader('Content-Length', String(buffer.byteLength))
      .setHeader('Content-Disposition', `attachment; filename="${document.name.replace(/[\r\n"\\]/g, '_')}"`)
      .end(buffer);
  }
}
