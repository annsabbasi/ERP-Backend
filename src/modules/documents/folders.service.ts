import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Folder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateFolderDto, MoveFolderDto, UpdateFolderDto } from './dto/folder.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns the company's folder tree. Each row carries its direct children
   * via the `children` relation; the client can compose deeper trees by
   * paginating through subtrees if needed.
   */
  list(companyId: string) {
    return this.prisma.folder.findMany({
      where: { companyId },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { documents: true, children: true } } },
    });
  }

  async findOne(companyId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id, companyId },
      include: {
        children: { orderBy: { name: 'asc' } },
        _count: { select: { documents: true, children: true } },
      },
    });
    if (!folder) throw new NotFoundException(`Folder ${id} not found`);
    return folder;
  }

  async create(companyId: string, dto: CreateFolderDto, audit: AuditMeta) {
    if (dto.parentId) await this.requireParentInCompany(companyId, dto.parentId);
    const conflict = await this.prisma.folder.findFirst({
      where: { companyId, parentId: dto.parentId ?? null, name: dto.name },
    });
    if (conflict) throw new BadRequestException('A folder with this name exists in the parent');

    const folder = await this.prisma.folder.create({
      data: {
        companyId,
        parentId: dto.parentId ?? null,
        name: dto.name,
        description: dto.description,
        createdById: audit.actorId,
      },
    });
    await this.recordAudit(companyId, audit, 'folder.created', folder);
    return folder;
  }

  async update(companyId: string, id: string, dto: UpdateFolderDto, audit: AuditMeta) {
    const folder = await this.findOne(companyId, id);
    if (dto.name && dto.name !== folder.name) {
      const conflict = await this.prisma.folder.findFirst({
        where: { companyId, parentId: folder.parentId, name: dto.name, id: { not: id } },
      });
      if (conflict) throw new BadRequestException('A folder with this name exists in the parent');
    }
    const updated = await this.prisma.folder.update({
      where: { id },
      data: { name: dto.name ?? undefined, description: dto.description ?? undefined },
    });
    await this.recordAudit(companyId, audit, 'folder.updated', updated, folder);
    return updated;
  }

  async move(companyId: string, id: string, dto: MoveFolderDto, audit: AuditMeta) {
    const folder = await this.findOne(companyId, id);
    const newParentId = dto.parentId ?? null;
    if (newParentId === folder.parentId) return folder;
    if (newParentId === id) {
      throw new BadRequestException('Cannot move a folder into itself');
    }
    if (newParentId) {
      await this.requireParentInCompany(companyId, newParentId);
      if (await this.isDescendant(companyId, newParentId, id)) {
        throw new BadRequestException('Cannot move a folder into one of its descendants');
      }
    }
    const conflict = await this.prisma.folder.findFirst({
      where: { companyId, parentId: newParentId, name: folder.name, id: { not: id } },
    });
    if (conflict) throw new BadRequestException('A folder with this name already exists in the destination');

    const moved = await this.prisma.folder.update({ where: { id }, data: { parentId: newParentId } });
    await this.recordAudit(companyId, audit, 'folder.moved', moved, folder);
    return moved;
  }

  async remove(companyId: string, id: string, audit: AuditMeta) {
    const folder = await this.findOne(companyId, id);
    const childCount = await this.prisma.folder.count({ where: { parentId: id } });
    const docCount = await this.prisma.document.count({ where: { folderId: id } });
    if (childCount || docCount) {
      throw new BadRequestException(
        `Folder is not empty (${childCount} sub-folder(s), ${docCount} document(s)). Move or delete contents first.`,
      );
    }
    await this.prisma.folder.delete({ where: { id } });
    await this.recordAudit(companyId, audit, 'folder.deleted', null, folder);
    return { message: `Folder ${id} deleted` };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async requireParentInCompany(companyId: string, parentId: string) {
    const parent = await this.prisma.folder.findFirst({ where: { id: parentId, companyId } });
    if (!parent) throw new BadRequestException(`Parent folder ${parentId} not found`);
  }

  /** Walks up `id`'s ancestor chain looking for `candidateAncestorId`. */
  private async isDescendant(companyId: string, id: string, candidateAncestorId: string): Promise<boolean> {
    let current: string | null = id;
    const seen = new Set<string>();
    while (current) {
      if (current === candidateAncestorId) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      const next = await this.prisma.folder.findFirst({
        where: { id: current, companyId },
        select: { parentId: true },
      });
      current = next?.parentId ?? null;
    }
    return false;
  }

  private async recordAudit(
    companyId: string,
    meta: AuditMeta,
    action: string,
    after: Folder | null,
    before?: Folder,
  ) {
    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action,
      refType: 'folder',
      refId: after?.id ?? before?.id,
      before: before as any,
      after: after as any,
      ip: meta.ip,
      module: 'documents',
    });
  }
}
