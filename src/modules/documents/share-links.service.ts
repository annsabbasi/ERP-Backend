import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentAccessType, ShareLink } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateShareLinkDto } from './dto/document.dto';
import { STORAGE_ADAPTER } from './storage/storage.module';
import type { ObjectStorageAdapter } from './storage/storage.types';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
  userAgent?: string;
}

/**
 * Time-bound, password-protected external share links (Section 6.9).
 *
 *   • Tokens are 32 raw bytes encoded URL-safe; stored in plaintext as the
 *     unique key (they're effectively secrets distributed out-of-band).
 *   • Passwords are bcrypt-hashed before persistence.
 *   • Access counts are bounded by `maxAccesses` when present; expiry is
 *     enforced by `expiresAt` when present. Both are optional.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: ObjectStorageAdapter,
  ) {}

  async create(
    companyId: string,
    documentId: string,
    dto: CreateShareLinkDto,
    audit: AuditMeta,
  ): Promise<ShareLink & { token: string }> {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, companyId } });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    const token = randomBytes(32).toString('base64url');
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;

    const link = await this.prisma.shareLink.create({
      data: {
        documentId,
        token,
        passwordHash,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        maxAccesses: dto.maxAccesses ?? null,
        createdById: audit.actorId,
      },
    });

    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action: 'document.shared',
      refType: 'document',
      refId: documentId,
      after: {
        shareLinkId: link.id,
        hasPassword: !!passwordHash,
        expiresAt: link.expiresAt,
        maxAccesses: link.maxAccesses,
      } as any,
      ip: audit.ip,
      module: 'documents',
    });

    return link;
  }

  list(companyId: string, documentId: string) {
    return this.prisma.shareLink.findMany({
      where: { documentId, document: { companyId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(companyId: string, linkId: string, audit: AuditMeta) {
    const link = await this.prisma.shareLink.findFirst({
      where: { id: linkId, document: { companyId } },
      include: { document: { select: { id: true } } },
    });
    if (!link) throw new NotFoundException(`Share link ${linkId} not found`);
    if (link.revokedAt) return link;

    const updated = await this.prisma.shareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action: 'document.share_revoked',
      refType: 'document',
      refId: link.documentId,
      after: { shareLinkId: linkId } as any,
      ip: audit.ip,
      module: 'documents',
    });
    return updated;
  }

  // ── Public flow ───────────────────────────────────────────────────────────

  /**
   * Step 1 of the public flow: returns enough metadata for the client to
   * render the document name and prompt for a password if required.
   * Doesn't return the token, the bytes, or anything sensitive.
   */
  async describePublic(token: string) {
    const link = await this.findLive(token);
    const doc = await this.prisma.document.findUnique({
      where: { id: link.documentId },
      select: { name: true, mimeType: true, size: true, status: true },
    });
    if (!doc || doc.status === 'DELETED') throw new NotFoundException('Share link not found');
    return {
      name: doc.name,
      mimeType: doc.mimeType,
      size: doc.size,
      requiresPassword: !!link.passwordHash,
      expiresAt: link.expiresAt,
    };
  }

  /**
   * Step 2: verifies password, increments access count, logs the open, and
   * streams the underlying document bytes.
   */
  async openPublic(token: string, password: string | undefined, meta: AuditMeta) {
    const link = await this.findLive(token);
    if (link.passwordHash) {
      if (!password) throw new ForbiddenException('Password required');
      const ok = await bcrypt.compare(password, link.passwordHash);
      if (!ok) throw new ForbiddenException('Invalid password');
    }

    const doc = await this.prisma.document.findUnique({
      where: { id: link.documentId },
      include: { currentVersion: true },
    });
    if (!doc || doc.status !== 'ACTIVE' || !doc.currentVersion) {
      throw new NotFoundException('Document unavailable');
    }

    const buffer = await this.storage.get(doc.currentVersion.storageKey);

    await this.prisma.$transaction([
      this.prisma.shareLink.update({
        where: { id: link.id },
        data: { accessCount: { increment: 1 } },
      }),
      this.prisma.documentAccessLog.create({
        data: {
          documentId: doc.id,
          accessType: DocumentAccessType.SHARED_LINK_OPENED,
          shareLinkId: link.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      }),
    ]);

    return { buffer, document: doc, version: doc.currentVersion };
  }

  private async findLive(token: string): Promise<ShareLink> {
    const link = await this.prisma.shareLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('Share link not found');
    if (link.revokedAt) throw new ForbiddenException('Share link revoked');
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Share link expired');
    }
    if (link.maxAccesses != null && link.accessCount >= link.maxAccesses) {
      throw new ForbiddenException('Share link access limit reached');
    }
    return link;
  }
}
