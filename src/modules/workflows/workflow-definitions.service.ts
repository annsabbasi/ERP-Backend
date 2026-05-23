import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CloneWorkflowDefinitionDto,
  CreateWorkflowDefinitionDto,
  UpdateWorkflowDefinitionDto,
} from './dto/workflow-definition.dto';

/**
 * CRUD for WorkflowDefinition + cloning of system templates into per-company
 * versions. A company can have multiple versions of the same key; the engine
 * picks the highest active version unless an instance pins to a specific one.
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns system templates + the caller's company-specific definitions. */
  list(companyId: string) {
    return this.prisma.workflowDefinition.findMany({
      where: { OR: [{ isSystem: true }, { companyId }] },
      orderBy: [{ isSystem: 'desc' }, { key: 'asc' }, { version: 'desc' }],
    });
  }

  async findOne(id: string, companyId: string) {
    const def = await this.prisma.workflowDefinition.findFirst({
      where: { id, OR: [{ isSystem: true }, { companyId }] },
    });
    if (!def) throw new NotFoundException(`Workflow definition ${id} not found`);
    return def;
  }

  async create(dto: CreateWorkflowDefinitionDto, companyId: string) {
    const version = dto.version ?? (await this.nextVersion(companyId, dto.key));
    const conflict = await this.prisma.workflowDefinition.findFirst({
      where: { companyId, key: dto.key, version },
    });
    if (conflict) throw new BadRequestException(`Definition ${dto.key} v${version} already exists`);

    return this.prisma.workflowDefinition.create({
      data: {
        companyId,
        key: dto.key,
        name: dto.name,
        description: dto.description,
        entityType: dto.entityType,
        steps: dto.steps as Prisma.InputJsonValue,
        version,
        isActive: dto.isActive ?? true,
        isSystem: false,
      },
    });
  }

  async update(id: string, dto: UpdateWorkflowDefinitionDto, companyId: string) {
    const def = await this.findOne(id, companyId);
    if (def.isSystem) {
      throw new ForbiddenException('System workflow templates are immutable — clone into your company first');
    }
    return this.prisma.workflowDefinition.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        entityType: dto.entityType ?? undefined,
        steps: dto.steps === undefined ? undefined : (dto.steps as Prisma.InputJsonValue),
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async clone(id: string, dto: CloneWorkflowDefinitionDto, companyId: string) {
    const source = await this.findOne(id, companyId);
    const version = await this.nextVersion(companyId, source.key);
    return this.prisma.workflowDefinition.create({
      data: {
        companyId,
        key: source.key,
        name: dto.name ?? `${source.name} (copy)`,
        description: source.description,
        entityType: source.entityType,
        steps: source.steps as Prisma.InputJsonValue,
        version,
        isActive: true,
        isSystem: false,
      },
    });
  }

  async remove(id: string, companyId: string) {
    const def = await this.findOne(id, companyId);
    if (def.isSystem) throw new ForbiddenException('Cannot delete system templates');
    const inUse = await this.prisma.workflowInstance.count({ where: { definitionId: id } });
    if (inUse) {
      // Don't break running instances — soft-disable.
      await this.prisma.workflowDefinition.update({ where: { id }, data: { isActive: false } });
      return { message: `Definition ${id} disabled (${inUse} instance(s) still reference it)` };
    }
    await this.prisma.workflowDefinition.delete({ where: { id } });
    return { message: `Definition ${id} deleted` };
  }

  private async nextVersion(companyId: string, key: string): Promise<number> {
    const top = await this.prisma.workflowDefinition.findFirst({
      where: { companyId, key },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (top?.version ?? 0) + 1;
  }
}
