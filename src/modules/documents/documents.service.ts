import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Document,
  DocumentAccessType,
  DocumentStatus,
  DocumentVersion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_ADAPTER } from './storage/storage.module';
import { storageKeyFor } from './storage/storage.types';
import type { ObjectStorageAdapter } from './storage/storage.types';
import { UpdateDocumentDto, UploadMetadataDto } from './dto/document.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
  userAgent?: string;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: ObjectStorageAdapter,
  ) {}

  // ── List / Get ───────────────────────────────────────────────────────────

  async list(
    companyId: string,
    opts: {
      folderId?: string | null;
      refType?: string;
      refId?: string;
      status?: DocumentStatus;
      tag?: string;
      q?: string;            // simple substring on name
      page?: number;
      pageSize?: number;
    },
  ) {
    const where: Prisma.DocumentWhereInput = {
      companyId,
      ...(opts.folderId === null ? { folderId: null } : opts.folderId ? { folderId: opts.folderId } : {}),
      ...(opts.refType ? { refType: opts.refType } : {}),
      ...(opts.refId ? { refId: opts.refId } : {}),
      status: opts.status ?? { not: DocumentStatus.DELETED },
      ...(opts.tag ? { tags: { has: opts.tag } } : {}),
      ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' } } : {}),
    };
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));

    const [total, items] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { folder: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async findOne(companyId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, companyId },
      include: {
        folder: { select: { id: true, name: true } },
        currentVersion: true,
      },
    });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  listVersions(companyId: string, id: string) {
    return this.prisma.documentVersion.findMany({
      where: { document: { id, companyId } },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async listAccessLog(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.documentAccessLog.findMany({
      where: { documentId: id },
      orderBy: { at: 'desc' },
      take: 200,
    });
  }

  // ── Upload (new document) ───────────────────────────────────────────────

  async upload(
    companyId: string,
    file: UploadedFile,
    meta: UploadMetadataDto,
    audit: AuditMeta,
  ): Promise<Document> {
    if (!file || !file.buffer) throw new BadRequestException('No file uploaded');
    if (meta.folderId) await this.requireFolderInCompany(companyId, meta.folderId);

    const name = meta.name?.trim() || file.originalname || `document-${Date.now()}`;

    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          companyId,
          folderId: meta.folderId ?? null,
          name,
          description: meta.description,
          mimeType: file.mimetype,
          size: file.size,
          status: DocumentStatus.ACTIVE,
          ownerId: audit.actorId,
          refType: meta.refType,
          refId: meta.refId,
          tags: meta.tags ?? [],
          metadata: (meta.metadata ?? null) as Prisma.InputJsonValue,
        },
      });

      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 1,
          storageKey: storageKeyFor(companyId, doc.id, 'v1'),
          size: file.size,
          checksum: '',  // backfilled after storage put below
          mimeType: file.mimetype,
          uploadedById: audit.actorId,
        },
      });

      const put = await this.storage.put(version.storageKey, file.buffer, file.mimetype);

      const finalized = await tx.documentVersion.update({
        where: { id: version.id },
        data: { size: put.size, checksum: put.checksum },
      });
      await tx.document.update({
        where: { id: doc.id },
        data: { currentVersionId: finalized.id, size: put.size, mimeType: file.mimetype },
      });

      await this.audit.record({
        companyId,
        actorId: audit.actorId,
        action: 'document.uploaded',
        refType: 'document',
        refId: doc.id,
        after: { name, size: put.size, mimeType: file.mimetype, folderId: meta.folderId ?? null } as any,
        ip: audit.ip,
        userAgent: audit.userAgent,
        module: 'documents',
      });

      return doc;
    });
  }

  // ── Upload new version of an existing document ──────────────────────────

  async uploadNewVersion(
    companyId: string,
    documentId: string,
    file: UploadedFile,
    notes: string | undefined,
    audit: AuditMeta,
  ): Promise<DocumentVersion> {
    if (!file || !file.buffer) throw new BadRequestException('No file uploaded');
    const doc = await this.findOne(companyId, documentId);
    if (doc.status === DocumentStatus.DELETED) {
      throw new BadRequestException('Cannot upload a new version to a deleted document');
    }

    const last = await this.prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const nextVersion = (last?.versionNumber ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.documentVersion.create({
        data: {
          documentId,
          versionNumber: nextVersion,
          storageKey: storageKeyFor(companyId, documentId, `v${nextVersion}`),
          size: file.size,
          checksum: '',
          mimeType: file.mimetype,
          uploadedById: audit.actorId,
          notes,
        },
      });
      const put = await this.storage.put(version.storageKey, file.buffer, file.mimetype);
      const finalized = await tx.documentVersion.update({
        where: { id: version.id },
        data: { size: put.size, checksum: put.checksum },
      });
      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: finalized.id, size: put.size, mimeType: file.mimetype },
      });

      await this.audit.record({
        companyId,
        actorId: audit.actorId,
        action: 'document.version_uploaded',
        refType: 'document',
        refId: documentId,
        after: { versionNumber: nextVersion, size: put.size, mimeType: file.mimetype } as any,
        ip: audit.ip,
        userAgent: audit.userAgent,
        module: 'documents',
      });
      return finalized;
    });
  }

  // ── Update / Move / Delete / Restore ─────────────────────────────────────

  async update(companyId: string, id: string, dto: UpdateDocumentDto, audit: AuditMeta) {
    const doc = await this.findOne(companyId, id);
    if (dto.folderId !== undefined && dto.folderId !== null) {
      await this.requireFolderInCompany(companyId, dto.folderId);
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        folderId: dto.folderId === undefined ? undefined : dto.folderId,
        tags: dto.tags ?? undefined,
        metadata: dto.metadata === undefined ? undefined : (dto.metadata as Prisma.InputJsonValue),
      },
    });
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action: 'document.updated',
      refType: 'document',
      refId: id,
      before: pickAudit(doc),
      after: pickAudit(updated),
      ip: audit.ip,
      module: 'documents',
    });
    return updated;
  }

  async softDelete(companyId: string, id: string, audit: AuditMeta) {
    const doc = await this.findOne(companyId, id);
    if (doc.status === DocumentStatus.DELETED) return doc;
    const updated = await this.prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.DELETED },
    });
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action: 'document.deleted',
      refType: 'document',
      refId: id,
      ip: audit.ip,
      module: 'documents',
    });
    return updated;
  }

  async restore(companyId: string, id: string, audit: AuditMeta) {
    const doc = await this.findOne(companyId, id);
    if (doc.status !== DocumentStatus.DELETED) return doc;
    const updated = await this.prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.ACTIVE },
    });
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action: 'document.restored',
      refType: 'document',
      refId: id,
      ip: audit.ip,
      module: 'documents',
    });
    return updated;
  }

  // ── Download ─────────────────────────────────────────────────────────────

  /**
   * Returns the bytes for the document's current version (or a specific
   * version), recording an access log entry. Caller (controller) is
   * responsible for streaming and content-disposition headers.
   */
  async download(
    companyId: string,
    id: string,
    audit: AuditMeta,
    versionId?: string,
  ): Promise<{ buffer: Buffer; document: Document; version: DocumentVersion }> {
    const doc = await this.findOne(companyId, id);
    if (doc.status === DocumentStatus.DELETED) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    const version = versionId
      ? await this.prisma.documentVersion.findFirst({ where: { id: versionId, documentId: id } })
      : doc.currentVersionId
        ? await this.prisma.documentVersion.findUnique({ where: { id: doc.currentVersionId } })
        : null;
    if (!version) throw new NotFoundException('Version not found');

    const buffer = await this.storage.get(version.storageKey);

    await this.prisma.documentAccessLog.create({
      data: {
        documentId: id,
        userId: audit.actorId ?? undefined,
        accessType: DocumentAccessType.DOWNLOADED,
        ip: audit.ip,
        userAgent: audit.userAgent,
      },
    });
    return { buffer, document: doc, version };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async requireFolderInCompany(companyId: string, folderId: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, companyId } });
    if (!folder) throw new BadRequestException(`Folder ${folderId} not found`);
  }
}

function pickAudit(d: Document) {
  return {
    name: d.name,
    description: d.description,
    folderId: d.folderId,
    tags: d.tags,
    metadata: d.metadata,
  } as any;
}
