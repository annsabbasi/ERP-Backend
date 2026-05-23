import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CreatePositionDto, UpdatePositionDto } from './dto/position.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string) {
    return this.prisma.position.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { employees: true } },
      },
    });
  }

  async findOne(companyId: string, id: string) {
    const pos = await this.prisma.position.findFirst({
      where: { id, companyId },
      include: {
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        employees: { select: { id: true, name: true, status: true } },
      },
    });
    if (!pos) throw new NotFoundException(`Position ${id} not found`);
    return pos;
  }

  async create(companyId: string, dto: CreatePositionDto, meta: AuditMeta) {
    const conflict = await this.prisma.position.findFirst({
      where: { companyId, title: dto.title },
    });
    if (conflict) throw new BadRequestException('A position with this title already exists');

    if (dto.departmentId) await this.assertDeptInCompany(companyId, dto.departmentId);
    if (dto.branchId) await this.assertBranchInCompany(companyId, dto.branchId);

    const pos = await this.prisma.position.create({
      data: {
        companyId,
        title: dto.title,
        code: dto.code,
        description: dto.description,
        level: dto.level,
        departmentId: dto.departmentId ?? null,
        branchId: dto.branchId ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.position.created',
      refType: 'position',
      refId: pos.id,
      after: { title: pos.title, code: pos.code, level: pos.level } as any,
      ip: meta.ip,
      module: 'hr',
    });
    return pos;
  }

  async update(companyId: string, id: string, dto: UpdatePositionDto, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    if (dto.title && dto.title !== before.title) {
      const conflict = await this.prisma.position.findFirst({
        where: { companyId, title: dto.title, id: { not: id } },
      });
      if (conflict) throw new BadRequestException('A position with this title already exists');
    }
    if (dto.departmentId) await this.assertDeptInCompany(companyId, dto.departmentId);
    if (dto.branchId) await this.assertBranchInCompany(companyId, dto.branchId);

    const updated = await this.prisma.position.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        code: dto.code ?? undefined,
        description: dto.description ?? undefined,
        level: dto.level ?? undefined,
        departmentId: dto.departmentId ?? undefined,
        branchId: dto.branchId ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });

    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.position.updated',
      refType: 'position',
      refId: id,
      before: { title: before.title, code: before.code, level: before.level, isActive: before.isActive } as any,
      after: { title: updated.title, code: updated.code, level: updated.level, isActive: updated.isActive } as any,
      ip: meta.ip,
      module: 'hr',
    });
    return updated;
  }

  async remove(companyId: string, id: string, meta: AuditMeta) {
    const pos = await this.findOne(companyId, id);
    const occupied = await this.prisma.employee.count({ where: { positionId: id } });
    if (occupied) {
      // Don't hard-delete a position that has employees attached — soft-disable.
      await this.prisma.position.update({ where: { id }, data: { isActive: false } });
      await this.audit.record({
        companyId,
        actorId: meta.actorId,
        action: 'hr.position.deactivated',
        refType: 'position',
        refId: id,
        before: pos as any,
        ip: meta.ip,
        module: 'hr',
      });
      return { message: `Position ${id} deactivated (${occupied} employee(s) still attached)` };
    }
    await this.prisma.position.delete({ where: { id } });
    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.position.deleted',
      refType: 'position',
      refId: id,
      before: pos as any,
      ip: meta.ip,
      module: 'hr',
    });
    return { message: `Position ${id} deleted` };
  }

  private async assertDeptInCompany(companyId: string, departmentId: string) {
    const dept = await this.prisma.department.findFirst({ where: { id: departmentId, companyId } });
    if (!dept) throw new BadRequestException(`Department ${departmentId} not found in this company`);
  }
  private async assertBranchInCompany(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!branch) throw new BadRequestException(`Branch ${branchId} not found in this company`);
  }
}
