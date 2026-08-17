import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../common/crud/tenant-crud.service';

@Injectable()
export class PredefinedTextService extends TenantCrudService {
  protected readonly modelName = 'predefinedText';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Predefined text',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name', 'text'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class CountriesService extends TenantCrudService {
  protected readonly modelName = 'country';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Country',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: { regions: { orderBy: { name: 'asc' as const } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async addRegion(companyId: string, dto: { countryId: string; code: string; name: string }) {
    const cid = this.requireCompany(companyId);
    // Regions hang off a country, so tenant scoping is checked on the parent.
    const country = await this.prisma.country.findFirst({
      where: { id: dto.countryId, companyId: cid },
    });
    if (!country) throw new BadRequestException('Country not found in this company');
    return this.prisma.stateRegion.create({
      data: { countryId: dto.countryId, code: dto.code, name: dto.name },
    });
  }

  async removeRegion(companyId: string, regionId: string) {
    const cid = this.requireCompany(companyId);
    const region = await this.prisma.stateRegion.findFirst({
      where: { id: regionId, country: { companyId: cid } },
    });
    if (!region) throw new NotFoundException('Region not found');
    await this.prisma.stateRegion.delete({ where: { id: regionId } });
    return { id: regionId, message: 'Region deleted' };
  }
}

// ─── USER GROUPS ──────────────────────────────────────────────────────────────
@Injectable()
export class UserGroupsService extends TenantCrudService {
  protected readonly modelName = 'userGroup';
  protected readonly options: TenantCrudOptions = {
    entityName: 'User group',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, roleType: true } } },
      },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const memberIds = (dto.memberIds as string[] | undefined) ?? [];
    await this.assertUsers(cid, memberIds);
    return this.prisma.userGroup.create({
      data: {
        companyId: cid,
        code: dto.code as string,
        name: dto.name as string,
        description: (dto.description as string) ?? null,
        isActive: (dto.isActive as boolean) ?? true,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      ...this.readArgs(),
    });
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const memberIds = dto.memberIds as string[] | undefined;
    if (memberIds) await this.assertUsers(cid, memberIds);

    return this.prisma.$transaction(async (tx) => {
      if (memberIds) await tx.userGroupMember.deleteMany({ where: { groupId: id } });
      return tx.userGroup.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code as string } : {}),
          ...(dto.name !== undefined ? { name: dto.name as string } : {}),
          ...(dto.description !== undefined ? { description: dto.description as string } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive as boolean } : {}),
          ...(memberIds ? { members: { create: memberIds.map((userId) => ({ userId })) } } : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  private async assertUsers(companyId: string, userIds: string[]) {
    if (!userIds.length) return;
    const count = await this.prisma.user.count({ where: { id: { in: userIds }, companyId } });
    if (count !== new Set(userIds).size) {
      throw new BadRequestException('One or more users do not belong to this company.');
    }
  }
}

// ─── USER DEFAULTS ────────────────────────────────────────────────────────────
@Injectable()
export class UserDefaultsService extends TenantCrudService {
  protected readonly modelName = 'userDefaultsGroup';
  protected readonly options: TenantCrudOptions = {
    entityName: 'User defaults group',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    uniqueBy: ['code'],
    include: { users: { select: { id: true, name: true, email: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const userIds = (dto.userIds as string[] | undefined) ?? [];
    const created = await this.prisma.userDefaultsGroup.create({
      data: {
        companyId: cid,
        code: dto.code as string,
        name: dto.name as string,
        defaults: (dto.defaults ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (userIds.length) await this.assign(cid, created.id, userIds);
    return this.findOne(cid, created.id);
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const existing = (await this.findOne(cid, id)) as unknown as { defaults: Record<string, unknown> };

    await this.prisma.userDefaultsGroup.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code as string } : {}),
        ...(dto.name !== undefined ? { name: dto.name as string } : {}),
        // Merge so one tab of the window can save without wiping the others.
        ...(dto.defaults !== undefined
          ? {
              defaults: {
                ...(existing.defaults ?? {}),
                ...(dto.defaults as Record<string, unknown>),
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });

    if (dto.userIds) await this.assign(cid, id, dto.userIds as string[]);
    return this.findOne(cid, id);
  }

  /** Points the listed users at this defaults group, clearing anyone dropped. */
  async assign(companyId: string, groupId: string, userIds: string[]) {
    if (userIds.length) {
      const count = await this.prisma.user.count({ where: { id: { in: userIds }, companyId } });
      if (count !== new Set(userIds).size) {
        throw new BadRequestException('One or more users do not belong to this company.');
      }
    }
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { companyId, userDefaultsGroupId: groupId, id: { notIn: userIds } },
        data: { userDefaultsGroupId: null },
      }),
      this.prisma.user.updateMany({
        where: { companyId, id: { in: userIds } },
        data: { userDefaultsGroupId: groupId },
      }),
    ]);
    return { groupId, assigned: userIds.length };
  }

  /** Effective defaults for one user — their group's block, or an empty object. */
  async forUser(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      include: { userDefaultsGroup: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      userId,
      groupId: user.userDefaultsGroupId,
      groupName: user.userDefaultsGroup?.name ?? null,
      defaults: user.userDefaultsGroup?.defaults ?? {},
    };
  }
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────
@Injectable()
export class AlertsService extends TenantCrudService {
  protected readonly modelName = 'alertDefinition';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Alert',
    orderBy: { name: 'asc' },
    searchFields: ['name', 'description'],
    filterableFields: ['isActive', 'priority', 'frequency'],
    uniqueBy: ['name'],
    include: {
      subscriptions: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { instances: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async create(companyId: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    const recipientIds = (dto.recipientIds as string[] | undefined) ?? [];
    return this.prisma.alertDefinition.create({
      data: {
        companyId: cid,
        name: dto.name as string,
        description: (dto.description as string) ?? null,
        priority: (dto.priority as never) ?? 'NORMAL',
        frequency: (dto.frequency as never) ?? 'ON_EVENT',
        frequencyValue: (dto.frequencyValue as number) ?? null,
        eventKey: (dto.eventKey as string) ?? null,
        savedQuery: (dto.savedQuery as string) ?? null,
        isActive: (dto.isActive as boolean) ?? true,
        subscriptions: { create: recipientIds.map((userId) => ({ userId })) },
      },
      ...this.readArgs(),
    });
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const recipientIds = dto.recipientIds as string[] | undefined;

    return this.prisma.$transaction(async (tx) => {
      if (recipientIds) await tx.alertSubscription.deleteMany({ where: { alertId: id } });
      return tx.alertDefinition.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name as string } : {}),
          ...(dto.description !== undefined ? { description: dto.description as string } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
          ...(dto.frequency !== undefined ? { frequency: dto.frequency as never } : {}),
          ...(dto.frequencyValue !== undefined ? { frequencyValue: dto.frequencyValue as number } : {}),
          ...(dto.eventKey !== undefined ? { eventKey: dto.eventKey as string } : {}),
          ...(dto.savedQuery !== undefined ? { savedQuery: dto.savedQuery as string } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive as boolean } : {}),
          ...(recipientIds ? { subscriptions: { create: recipientIds.map((userId) => ({ userId })) } } : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  /** Raises an alert instance for every subscriber. Called by event producers. */
  async fire(companyId: string, eventKey: string, subject: string, payload?: Record<string, unknown>) {
    const alerts = await this.prisma.alertDefinition.findMany({
      where: { companyId, eventKey, isActive: true },
      include: { subscriptions: true },
    });
    if (!alerts.length) return { fired: 0 };

    let fired = 0;
    for (const a of alerts) {
      if (!a.subscriptions.length) continue;
      await this.prisma.alertInstance.createMany({
        data: a.subscriptions.map((s) => ({
          alertId: a.id,
          userId: s.userId,
          subject,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
        })),
      });
      await this.prisma.alertDefinition.update({
        where: { id: a.id },
        data: { lastRunAt: new Date() },
      });
      fired += a.subscriptions.length;
    }
    return { fired };
  }

  /** The signed-in user's inbox. */
  inbox(companyId: string, userId: string, unreadOnly = false) {
    return this.prisma.alertInstance.findMany({
      where: {
        userId,
        alert: { companyId },
        ...(unreadOnly ? { readAt: null } : {}),
      },
      include: { alert: { select: { id: true, name: true, priority: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async markRead(companyId: string, userId: string, instanceIds: string[]) {
    const result = await this.prisma.alertInstance.updateMany({
      // Scoped to the caller so one user cannot clear another's alerts.
      where: { id: { in: instanceIds }, userId, alert: { companyId } },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }
}

// ─── SUBSTITUTE AUTHORIZERS ───────────────────────────────────────────────────
@Injectable()
export class SubstituteAuthorizersService extends TenantCrudService {
  protected readonly modelName = 'substituteAuthorizer';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Substitute authorizer',
    orderBy: { validFrom: 'desc' },
    filterableFields: ['isActive', 'templateId', 'originalUserId', 'substituteUserId'],
    include: {
      template: { select: { id: true, name: true } },
      original: { select: { id: true, name: true, email: true } },
      substitute: { select: { id: true, name: true, email: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>) {
    const out = super.beforeWrite(dto);
    for (const k of ['validFrom', 'validTo']) {
      if (out[k]) out[k] = new Date(out[k] as string);
    }
    if (
      out.validFrom instanceof Date &&
      out.validTo instanceof Date &&
      out.validTo < out.validFrom
    ) {
      throw new BadRequestException('validTo must be on or after validFrom.');
    }
    // A person standing in for themselves is a no-op that silently hides a typo.
    if (out.originalUserId && out.originalUserId === out.substituteUserId) {
      throw new BadRequestException('The substitute must be a different user.');
    }
    return out;
  }
}
