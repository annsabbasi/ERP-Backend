import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingItemStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  CreateOnboardingTemplateDto,
  StartOnboardingDto,
  UpdateOnboardingItemDto,
  UpdateOnboardingTemplateDto,
} from './dto/onboarding.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

/**
 * Onboarding templates + per-employee instances.
 *
 *   • Template = blueprint with items (title, category, due-day-from-start).
 *   • Instance = spawned for a new hire; items are deep-copied so changes
 *     to the template don't retroactively affect running onboardings.
 *
 * Spawning is manual today (`POST /hr/onboarding/instances`). Auto-spawn on
 * employee creation by position is straightforward to add later via an event
 * hook from EmployeesService.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Templates ────────────────────────────────────────────────────────────

  listTemplates(companyId: string) {
    return this.prisma.onboardingTemplate.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { items: true, instances: true } } },
    });
  }

  async findTemplate(companyId: string, id: string) {
    const t = await this.prisma.onboardingTemplate.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { ordering: 'asc' } } },
    });
    if (!t) throw new NotFoundException(`Template ${id} not found`);
    return t;
  }

  async createTemplate(
    companyId: string,
    dto: CreateOnboardingTemplateDto,
    meta: AuditMeta,
  ) {
    const conflict = await this.prisma.onboardingTemplate.findFirst({
      where: { companyId, name: dto.name },
    });
    if (conflict) throw new BadRequestException(`Template "${dto.name}" already exists`);

    const tpl = await this.prisma.$transaction(async (tx) => {
      const t = await tx.onboardingTemplate.create({
        data: {
          companyId,
          name: dto.name,
          description: dto.description,
          positionId: dto.positionId ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      await tx.onboardingTemplateItem.createMany({
        data: dto.items.map((i, idx) => ({
          templateId: t.id,
          title: i.title,
          description: i.description,
          category: i.category,
          assigneeRole: i.assigneeRole,
          daysFromStart: i.daysFromStart,
          ordering: i.ordering ?? idx,
        })),
      });
      return t;
    });

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.onboarding_template.created',
      refType: 'onboarding_template', refId: tpl.id,
      after: { name: tpl.name, itemCount: dto.items.length } as any,
      ip: meta.ip, module: 'hr',
    });
    return this.findTemplate(companyId, tpl.id);
  }

  async updateTemplate(
    companyId: string,
    id: string,
    dto: UpdateOnboardingTemplateDto,
    meta: AuditMeta,
  ) {
    const before = await this.findTemplate(companyId, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.onboardingTemplate.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          positionId: dto.positionId ?? undefined,
          isActive: dto.isActive ?? undefined,
        },
      });
      if (dto.items !== undefined) {
        await tx.onboardingTemplateItem.deleteMany({ where: { templateId: id } });
        if (dto.items.length) {
          await tx.onboardingTemplateItem.createMany({
            data: dto.items.map((i, idx) => ({
              templateId: id,
              title: i.title,
              description: i.description,
              category: i.category,
              assigneeRole: i.assigneeRole,
              daysFromStart: i.daysFromStart,
              ordering: i.ordering ?? idx,
            })),
          });
        }
      }
      return t;
    });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.onboarding_template.updated',
      refType: 'onboarding_template', refId: id,
      before: { name: before.name, itemCount: before.items.length } as any,
      after: { name: updated.name } as any,
      ip: meta.ip, module: 'hr',
    });
    return this.findTemplate(companyId, id);
  }

  async deleteTemplate(companyId: string, id: string, meta: AuditMeta) {
    await this.findTemplate(companyId, id);
    const inUse = await this.prisma.onboardingInstance.count({ where: { templateId: id } });
    if (inUse) {
      await this.prisma.onboardingTemplate.update({ where: { id }, data: { isActive: false } });
      return { message: `Template ${id} disabled (${inUse} instance(s) still reference it)` };
    }
    await this.prisma.onboardingTemplate.delete({ where: { id } });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.onboarding_template.deleted',
      refType: 'onboarding_template', refId: id,
      ip: meta.ip, module: 'hr',
    });
    return { message: `Template ${id} deleted` };
  }

  // ── Instances ────────────────────────────────────────────────────────────

  listInstances(companyId: string, opts: { employeeId?: string } = {}) {
    return this.prisma.onboardingInstance.findMany({
      where: { companyId, ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) },
      orderBy: { startedAt: 'desc' },
      include: {
        employee: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async findInstance(companyId: string, id: string) {
    const inst = await this.prisma.onboardingInstance.findFirst({
      where: { id, companyId },
      include: {
        employee: { select: { id: true, name: true, hireDate: true } },
        template: { select: { id: true, name: true } },
        items: { orderBy: { dueAt: 'asc' } },
      },
    });
    if (!inst) throw new NotFoundException(`Onboarding instance ${id} not found`);
    return inst;
  }

  async startInstance(companyId: string, dto: StartOnboardingDto, meta: AuditMeta) {
    const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
    if (!emp) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const template = dto.templateId
      ? await this.prisma.onboardingTemplate.findFirst({
          where: { id: dto.templateId, companyId, isActive: true },
          include: { items: { orderBy: { ordering: 'asc' } } },
        })
      : null;
    if (dto.templateId && !template) {
      throw new BadRequestException(`Template ${dto.templateId} not found`);
    }

    const hireDate = emp.hireDate ?? new Date();
    const targetEnd = dto.targetEndAt
      ? new Date(dto.targetEndAt)
      : template?.items?.reduce<Date | null>((latest, it) => {
          if (it.daysFromStart == null) return latest;
          const due = new Date(hireDate.getTime() + it.daysFromStart * 86_400_000);
          return latest && latest > due ? latest : due;
        }, null) ?? null;

    const instance = await this.prisma.$transaction(async (tx) => {
      const inst = await tx.onboardingInstance.create({
        data: {
          companyId,
          employeeId: dto.employeeId,
          templateId: template?.id ?? null,
          targetEndAt: targetEnd,
        },
      });

      if (template?.items?.length) {
        await tx.onboardingInstanceItem.createMany({
          data: template.items.map((it) => ({
            instanceId: inst.id,
            title: it.title,
            description: it.description,
            category: it.category,
            // assignee is resolved later — assigneeRole maps to an actual user
            // via HR config (defer until a real customer needs it).
            assigneeId: null,
            dueAt: it.daysFromStart != null
              ? new Date(hireDate.getTime() + it.daysFromStart * 86_400_000)
              : null,
            status: OnboardingItemStatus.PENDING,
          })),
        });
      }
      return inst;
    });

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.onboarding.started',
      refType: 'onboarding_instance', refId: instance.id,
      after: { employeeId: dto.employeeId, templateId: template?.id ?? null } as any,
      ip: meta.ip, module: 'hr',
    });
    return this.findInstance(companyId, instance.id);
  }

  async updateItem(
    companyId: string,
    itemId: string,
    dto: UpdateOnboardingItemDto,
    meta: AuditMeta,
  ) {
    const item = await this.prisma.onboardingInstanceItem.findFirst({
      where: { id: itemId, instance: { companyId } },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);

    const now = new Date();
    const updated = await this.prisma.onboardingInstanceItem.update({
      where: { id: itemId },
      data: {
        status: dto.status ?? undefined,
        assigneeId: dto.assigneeId ?? undefined,
        notes: dto.notes ?? undefined,
        completedAt:
          dto.status === OnboardingItemStatus.COMPLETED ? now : undefined,
        completedById:
          dto.status === OnboardingItemStatus.COMPLETED ? meta.actorId ?? undefined : undefined,
      },
    });

    // If every item is COMPLETED or SKIPPED, mark the instance complete.
    const open = await this.prisma.onboardingInstanceItem.count({
      where: {
        instanceId: item.instanceId,
        status: { notIn: [OnboardingItemStatus.COMPLETED, OnboardingItemStatus.SKIPPED] },
      },
    });
    if (open === 0) {
      await this.prisma.onboardingInstance.update({
        where: { id: item.instanceId },
        data: { completedAt: now },
      });
    }

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.onboarding_item.updated',
      refType: 'onboarding_instance_item', refId: itemId,
      after: { status: updated.status, assigneeId: updated.assigneeId } as any,
      ip: meta.ip, module: 'hr',
    });
    return updated;
  }
}
