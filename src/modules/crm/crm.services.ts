import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ActivityStatus, OpportunityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../administration/numbering/numbering.service';
import {
  TenantCrudService,
  TenantCrudOptions,
} from '../../common/crud/tenant-crud.service';
import {
  CloseOpportunityDto,
  CreateActivityDto,
  CreateCampaignDto,
  CreateOpportunityDto,
  OpportunityStageEntryDto,
  UpdateActivityDto,
  UpdateOpportunityDto,
} from './crm.dto';

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);

/** A node in the territory tree returned by TerritoriesService.tree(). */
export interface TerritoryNode {
  id: string;
  name: string;
  isActive: boolean;
  children: TerritoryNode[];
}

// ─── SALES ORGANISATION ───────────────────────────────────────────────────────
@Injectable()
export class TerritoriesService extends TenantCrudService {
  protected readonly modelName = 'territory';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Territory',
    orderBy: { name: 'asc' },
    searchFields: ['name'],
    filterableFields: ['isActive', 'parentId'],
    uniqueBy: ['name'],
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { children: true, partners: true, salesEmployees: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  /** Territories are shown as a tree in the setup window. */
  async tree(companyId: string): Promise<TerritoryNode[]> {
    const cid = this.requireCompany(companyId);
    const rows = await this.prisma.territory.findMany({
      where: { companyId: cid },
      orderBy: { name: 'asc' },
    });

    const byId = new Map<string, TerritoryNode>(
      rows.map((r) => [r.id, { id: r.id, name: r.name, isActive: r.isActive, children: [] }]),
    );
    const roots: TerritoryNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      const parent = r.parentId ? byId.get(r.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async update(companyId: string, id: string, dto: Record<string, unknown>) {
    const cid = this.requireCompany(companyId);
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('A territory cannot be its own parent.');
      }
      // Re-parenting into your own subtree would orphan the branch from the tree.
      let cursor = dto.parentId as string | null;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) {
          throw new BadRequestException(
            'That parent sits inside this territory’s own subtree, which would create a cycle.',
          );
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const next: { parentId: string | null } | null = await this.prisma.territory.findFirst({
          where: { id: cursor, companyId: cid },
          select: { parentId: true },
        });
        cursor = next?.parentId ?? null;
      }
    }
    return super.update(cid, id, dto);
  }
}

@Injectable()
export class CommissionGroupsService extends TenantCrudService {
  protected readonly modelName = 'commissionGroup';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Commission group',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: { _count: { select: { salesEmployees: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class SalesEmployeesService extends TenantCrudService {
  protected readonly modelName = 'salesEmployee';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Sales employee',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name', 'email', 'jobTitle'],
    filterableFields: ['isActive', 'territoryId', 'commissionGroupId'],
    uniqueBy: ['code'],
    include: {
      commissionGroup: { select: { id: true, code: true, name: true, commissionPercent: true } },
      territory: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
      // Employee carries a single `name`, not firstName/lastName — selecting
      // the latter made Prisma reject every list query, so Administration →
      // Sales Employees/Buyers answered 400 and never opened.
      employee: { select: { id: true, name: true, employeeNumber: true } },
      _count: { select: { partners: true, opportunities: true } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>) {
    const out = super.beforeWrite(dto);
    // userId and employeeId are unique; '' would collide across rows, so the
    // base class's ''→null conversion matters here.
    return out;
  }
}

// ─── CRM SETUP CATALOGS ───────────────────────────────────────────────────────
@Injectable()
export class BpGroupsService extends TenantCrudService {
  protected readonly modelName = 'businessPartnerGroup';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Business partner group',
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
    searchFields: ['code', 'name'],
    filterableFields: ['type', 'isActive'],
    uniqueBy: ['type', 'code'],
    include: { _count: { select: { partners: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class OpportunityStageDefsService extends TenantCrudService {
  protected readonly modelName = 'opportunityStageDef';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Opportunity stage',
    orderBy: { stageNo: 'asc' },
    searchFields: ['name'],
    filterableFields: ['isActive'],
    uniqueBy: ['stageNo'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class CompetitorsService extends TenantCrudService {
  protected readonly modelName = 'competitor';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Competitor',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class CrmPartnersService extends TenantCrudService {
  protected readonly modelName = 'crmPartner';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Partner',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive', 'type'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class InformationSourcesService extends TenantCrudService {
  protected readonly modelName = 'informationSource';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Information source',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

@Injectable()
export class BpRelationshipTypesService extends TenantCrudService {
  protected readonly modelName = 'bpRelationshipType';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Relationship type',
    orderBy: { name: 'asc' },
    searchFields: ['code', 'name'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────
@Injectable()
export class ActivitiesService extends TenantCrudService {
  protected readonly modelName = 'activity';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Activity',
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    searchFields: ['subject', 'content', 'remarks', 'location'],
    filterableFields: ['kind', 'status', 'priority', 'bpId', 'assignedToUserId', 'ownerId'],
    include: {
      bp: { select: { id: true, cardCode: true, cardName: true } },
      contactPerson: { select: { id: true, name: true, email: true, phone1: true } },
      owner: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  };

  constructor(
    prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {
    super(prisma);
  }

  /**
   * Named separately from the base `create` because an activity needs the
   * acting user for ownership and default assignment — a third argument the
   * generic CRUD contract does not carry.
   */
  async createForUser(companyId: string, userId: string, dto: CreateActivityDto) {
    const cid = this.requireCompany(companyId);
    const data = this.mapDto(dto);

    return this.prisma.$transaction(async (tx) => {
      let docNumber: number | null = null;
      try {
        docNumber = (await this.numbering.allocate(tx, cid, 'activity')).numeric;
      } catch {
        // No activity series configured — carry on without a doc number rather
        // than blocking the save on optional setup.
        docNumber = null;
      }

      return tx.activity.create({
        data: {
          ...data,
          companyId: cid,
          docNumber,
          ownerId: userId,
          assignedToUserId: dto.assignedToUserId ?? userId,
        } as Prisma.ActivityUncheckedCreateInput,
        ...this.readArgs(),
      });
    });
  }

  async update(companyId: string, id: string, dto: UpdateActivityDto) {
    const cid = this.requireCompany(companyId);
    await this.findOne(cid, id);
    const data = this.mapDto(dto);

    // Closing stamps the time so "Activities Overview" can report cycle times.
    if (dto.status !== undefined) {
      data.closedAt = dto.status === ActivityStatus.CLOSED ? new Date() : null;
    }

    return this.prisma.activity.update({ where: { id }, data, ...this.readArgs() });
  }

  /** My Activities — what the signed-in user owns or is assigned. */
  myActivities(companyId: string, userId: string, openOnly = true) {
    return this.prisma.activity.findMany({
      where: {
        companyId,
        OR: [{ ownerId: userId }, { assignedToUserId: userId }],
        ...(openOnly ? { status: { in: ['OPEN', 'IN_PROGRESS'] } } : {}),
      },
      include: this.options.include as never,
      orderBy: [{ startDate: 'asc' }],
    });
  }

  /** Calendar feed for a date window. */
  calendar(companyId: string, from: Date, to: Date, userId?: string) {
    return this.prisma.activity.findMany({
      where: {
        companyId,
        startDate: { gte: from, lte: to },
        ...(userId ? { OR: [{ ownerId: userId }, { assignedToUserId: userId }] } : {}),
      },
      include: this.options.include as never,
      orderBy: { startDate: 'asc' },
    });
  }

  /** Activities Overview report — counts by status, kind and assignee. */
  async overview(companyId: string, from?: Date, to?: Date) {
    const where: Prisma.ActivityWhereInput = {
      companyId,
      ...(from || to
        ? { startDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const [byStatus, byKind, byAssignee, total] = await Promise.all([
      this.prisma.activity.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.activity.groupBy({ by: ['kind'], where, _count: { _all: true } }),
      this.prisma.activity.groupBy({ by: ['assignedToUserId'], where, _count: { _all: true } }),
      this.prisma.activity.count({ where }),
    ]);

    const userIds = byAssignee.map((a) => a.assignedToUserId).filter(Boolean) as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return {
      total,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      byKind: byKind.map((r) => ({ kind: r.kind, count: r._count._all })),
      byAssignee: byAssignee.map((r) => ({
        userId: r.assignedToUserId,
        name: r.assignedToUserId ? nameById.get(r.assignedToUserId) ?? 'Unknown' : 'Unassigned',
        count: r._count._all,
      })),
    };
  }

  private mapDto(dto: Partial<CreateActivityDto>): Record<string, unknown> {
    const { startDate, endDate, recurrence, assignedToUserId, ...rest } = dto;
    void assignedToUserId;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) out[k] = v === '' ? null : v;
    if (startDate) out.startDate = new Date(startDate);
    if (endDate !== undefined) out.endDate = endDate ? new Date(endDate) : null;
    if (recurrence !== undefined) out.recurrence = recurrence as Prisma.InputJsonValue;
    if (dto.assignedToUserId !== undefined) out.assignedToUserId = dto.assignedToUserId || null;
    return out;
  }
}

// ─── OPPORTUNITIES ────────────────────────────────────────────────────────────
@Injectable()
export class OpportunitiesService extends TenantCrudService {
  protected readonly modelName = 'opportunity';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Opportunity',
    orderBy: [{ startDate: 'desc' }],
    searchFields: ['name', 'remarks'],
    filterableFields: ['status', 'bpId', 'salesEmployeeId', 'territoryId', 'currentStageId'],
    include: {
      bp: { select: { id: true, cardCode: true, cardName: true } },
      contactPerson: { select: { id: true, name: true, email: true } },
      salesEmployee: { select: { id: true, code: true, name: true } },
      territory: { select: { id: true, name: true } },
      currentStage: { select: { id: true, stageNo: true, name: true, closingPercent: true } },
      informationSource: { select: { id: true, code: true, name: true } },
      stages: {
        orderBy: { ordering: 'asc' as const },
        include: {
          stageDef: { select: { id: true, stageNo: true, name: true } },
          salesEmployee: { select: { id: true, name: true } },
        },
      },
      competitors: { include: { competitor: { select: { id: true, code: true, name: true } } } },
      partners: { include: { partner: { select: { id: true, code: true, name: true } } } },
    },
  };

  constructor(
    prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {
    super(prisma);
  }

  async create(companyId: string, dto: CreateOpportunityDto) {
    const cid = this.requireCompany(companyId);
    const { potentialAmount, closePercent, weightedAmount } = this.weight(dto);

    return this.prisma.$transaction(async (tx) => {
      let docNumber: number | null = null;
      try {
        docNumber = (await this.numbering.allocate(tx, cid, 'opportunity')).numeric;
      } catch {
        docNumber = null;
      }

      return tx.opportunity.create({
        data: {
          companyId: cid,
          docNumber,
          name: dto.name,
          bpId: dto.bpId,
          contactPersonId: dto.contactPersonId || null,
          salesEmployeeId: dto.salesEmployeeId || null,
          territoryId: dto.territoryId || null,
          currentStageId: dto.currentStageId || null,
          status: dto.status ?? OpportunityStatus.OPEN,
          level: dto.level ?? 1,
          startDate: new Date(dto.startDate),
          closingDate: dto.closingDate ? new Date(dto.closingDate) : null,
          predictedClosingDate: dto.predictedClosingDate ? new Date(dto.predictedClosingDate) : null,
          currency: dto.currency ?? 'USD',
          potentialAmount,
          closePercent,
          weightedAmount,
          grossProfit: dto.grossProfit !== undefined ? D(dto.grossProfit) : null,
          informationSourceId: dto.informationSourceId || null,
          industry: dto.industry || null,
          interestField: dto.interestField || null,
          interestLevel: dto.interestLevel || null,
          reasonId: dto.reasonId || null,
          remarks: dto.remarks || null,
          stages: { create: (dto.stages ?? []).map((s, i) => this.mapStage(s, i)) },
          competitors: { create: (dto.competitors ?? []).map((c) => ({ ...c })) },
          partners: { create: (dto.partners ?? []).map((p) => ({ ...p })) },
        },
        ...this.readArgs(),
      });
    });
  }

  async update(companyId: string, id: string, dto: UpdateOpportunityDto) {
    const cid = this.requireCompany(companyId);
    const existing = (await this.findOne(cid, id)) as unknown as {
      potentialAmount: Prisma.Decimal; closePercent: Prisma.Decimal; status: OpportunityStatus;
    };

    if (existing.status !== OpportunityStatus.OPEN && dto.status === undefined) {
      throw new ConflictException(
        `This opportunity is already ${existing.status.toLowerCase()}. Reopen it before editing.`,
      );
    }

    const { potentialAmount, closePercent, weightedAmount } = this.weight({
      potentialAmount:
        dto.potentialAmount ?? Number(existing.potentialAmount),
      closePercent: dto.closePercent ?? Number(existing.closePercent),
    });

    return this.prisma.$transaction(async (tx) => {
      if (dto.stages) await tx.opportunityStageEntry.deleteMany({ where: { opportunityId: id } });
      if (dto.competitors) await tx.opportunityCompetitor.deleteMany({ where: { opportunityId: id } });
      if (dto.partners) await tx.opportunityPartner.deleteMany({ where: { opportunityId: id } });

      return tx.opportunity.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.bpId !== undefined ? { bpId: dto.bpId } : {}),
          ...(dto.contactPersonId !== undefined ? { contactPersonId: dto.contactPersonId || null } : {}),
          ...(dto.salesEmployeeId !== undefined ? { salesEmployeeId: dto.salesEmployeeId || null } : {}),
          ...(dto.territoryId !== undefined ? { territoryId: dto.territoryId || null } : {}),
          ...(dto.currentStageId !== undefined ? { currentStageId: dto.currentStageId || null } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.level !== undefined ? { level: dto.level } : {}),
          ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
          ...(dto.closingDate !== undefined ? { closingDate: dto.closingDate ? new Date(dto.closingDate) : null } : {}),
          ...(dto.predictedClosingDate !== undefined
            ? { predictedClosingDate: dto.predictedClosingDate ? new Date(dto.predictedClosingDate) : null }
            : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          potentialAmount,
          closePercent,
          weightedAmount,
          ...(dto.grossProfit !== undefined ? { grossProfit: D(dto.grossProfit) } : {}),
          ...(dto.informationSourceId !== undefined ? { informationSourceId: dto.informationSourceId || null } : {}),
          ...(dto.industry !== undefined ? { industry: dto.industry } : {}),
          ...(dto.interestField !== undefined ? { interestField: dto.interestField } : {}),
          ...(dto.interestLevel !== undefined ? { interestLevel: dto.interestLevel } : {}),
          ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
          ...(dto.stages ? { stages: { create: dto.stages.map((s, i) => this.mapStage(s, i)) } } : {}),
          ...(dto.competitors ? { competitors: { create: dto.competitors.map((c) => ({ ...c })) } } : {}),
          ...(dto.partners ? { partners: { create: dto.partners.map((p) => ({ ...p })) } } : {}),
        },
        ...this.readArgs(),
      });
    });
  }

  /** Won/Lost. A closed opportunity stops contributing to the pipeline. */
  async close(companyId: string, id: string, dto: CloseOpportunityDto) {
    const cid = this.requireCompany(companyId);
    const opp = (await this.findOne(cid, id)) as unknown as { status: OpportunityStatus; name: string };

    if (opp.status !== OpportunityStatus.OPEN) {
      throw new ConflictException(`"${opp.name}" is already ${opp.status.toLowerCase()}.`);
    }
    if (dto.status === OpportunityStatus.OPEN) {
      throw new BadRequestException('Use status WON or LOST to close an opportunity.');
    }

    const closingDate = dto.closingDate ? new Date(dto.closingDate) : new Date();
    const won = dto.status === OpportunityStatus.WON;

    return this.prisma.opportunity.update({
      where: { id },
      data: {
        status: dto.status,
        closingDate,
        // Won deals are certain; lost deals contribute nothing to the forecast.
        closePercent: new Prisma.Decimal(won ? 100 : 0),
        weightedAmount: won
          ? undefined // keep the potential as the weighted figure
          : new Prisma.Decimal(0),
        wonLostReason: dto.reason ?? null,
      },
      ...this.readArgs(),
    });
  }

  async reopen(companyId: string, id: string) {
    const cid = this.requireCompany(companyId);
    return this.prisma.opportunity.update({
      where: { id },
      data: { status: OpportunityStatus.OPEN, closingDate: null, wonLostReason: null },
      ...this.readArgs(),
    });
  }

  /** Opportunities Pipeline — open value grouped by stage. */
  async pipeline(companyId: string, salesEmployeeId?: string) {
    const rows = await this.prisma.opportunity.groupBy({
      by: ['currentStageId'],
      where: {
        companyId,
        status: OpportunityStatus.OPEN,
        ...(salesEmployeeId ? { salesEmployeeId } : {}),
      },
      _sum: { potentialAmount: true, weightedAmount: true },
      _count: { _all: true },
    });

    const stageIds = rows.map((r) => r.currentStageId).filter(Boolean) as string[];
    const stages = stageIds.length
      ? await this.prisma.opportunityStageDef.findMany({
          where: { id: { in: stageIds } },
          select: { id: true, stageNo: true, name: true, closingPercent: true },
        })
      : [];
    const byId = new Map(stages.map((s) => [s.id, s]));

    return rows
      .map((r) => ({
        stage: r.currentStageId
          ? byId.get(r.currentStageId) ?? { id: r.currentStageId, stageNo: 999, name: 'Unknown' }
          : { id: null, stageNo: 0, name: 'No stage' },
        count: r._count._all,
        potential: (r._sum.potentialAmount ?? new Prisma.Decimal(0)).toFixed(2),
        weighted: (r._sum.weightedAmount ?? new Prisma.Decimal(0)).toFixed(2),
      }))
      .sort((a, b) => (a.stage.stageNo ?? 0) - (b.stage.stageNo ?? 0));
  }

  /** Opportunities Statistics / Won / Lost reports. */
  async statistics(companyId: string, from?: Date, to?: Date) {
    const where: Prisma.OpportunityWhereInput = {
      companyId,
      ...(from || to
        ? { startDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const [byStatus, bySalesEmployee] = await Promise.all([
      this.prisma.opportunity.groupBy({
        by: ['status'],
        where,
        _sum: { potentialAmount: true, weightedAmount: true },
        _count: { _all: true },
      }),
      this.prisma.opportunity.groupBy({
        by: ['salesEmployeeId', 'status'],
        where,
        _sum: { potentialAmount: true },
        _count: { _all: true },
      }),
    ]);

    const won = byStatus.find((s) => s.status === OpportunityStatus.WON);
    const lost = byStatus.find((s) => s.status === OpportunityStatus.LOST);
    const wonCount = won?._count._all ?? 0;
    const lostCount = lost?._count._all ?? 0;
    const decided = wonCount + lostCount;

    const empIds = bySalesEmployee.map((r) => r.salesEmployeeId).filter(Boolean) as string[];
    const emps = empIds.length
      ? await this.prisma.salesEmployee.findMany({
          where: { id: { in: empIds } },
          select: { id: true, name: true },
        })
      : [];
    const empName = new Map(emps.map((e) => [e.id, e.name]));

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
        potential: (s._sum.potentialAmount ?? new Prisma.Decimal(0)).toFixed(2),
        weighted: (s._sum.weightedAmount ?? new Prisma.Decimal(0)).toFixed(2),
      })),
      // Only decided deals count toward a win rate; open ones are still in play.
      winRatePercent: decided === 0 ? null : ((wonCount / decided) * 100).toFixed(2),
      bySalesEmployee: bySalesEmployee.map((r) => ({
        salesEmployeeId: r.salesEmployeeId,
        name: r.salesEmployeeId ? empName.get(r.salesEmployeeId) ?? 'Unknown' : 'Unassigned',
        status: r.status,
        count: r._count._all,
        potential: (r._sum.potentialAmount ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    };
  }

  /** Weighted amount is always derived, never accepted from the client. */
  private weight(dto: { potentialAmount?: number; closePercent?: number }) {
    const potentialAmount = D(dto.potentialAmount ?? 0);
    const closePercent = D(dto.closePercent ?? 0);
    return {
      potentialAmount,
      closePercent,
      weightedAmount: potentialAmount.times(closePercent).dividedBy(100).toDecimalPlaces(2),
    };
  }

  private mapStage(s: OpportunityStageEntryDto, i: number) {
    const potential = D(s.potentialAmount);
    const percent = D(s.closePercent);
    return {
      stageDefId: s.stageDefId,
      ordering: s.ordering ?? i,
      startDate: s.startDate ? new Date(s.startDate) : null,
      closingDate: s.closingDate ? new Date(s.closingDate) : null,
      closePercent: percent,
      potentialAmount: potential,
      weightedAmount: potential.times(percent).dividedBy(100).toDecimalPlaces(2),
      salesEmployeeId: s.salesEmployeeId || null,
      activityId: s.activityId || null,
      docType: s.docType || null,
      docNumber: s.docNumber || null,
      remarks: s.remarks || null,
    };
  }
}

// ─── CAMPAIGNS ────────────────────────────────────────────────────────────────
@Injectable()
export class CampaignsService extends TenantCrudService {
  protected readonly modelName = 'campaign';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Campaign',
    orderBy: { startDate: 'desc' },
    searchFields: ['name', 'type', 'targetGroup'],
    filterableFields: ['status', 'salesEmployeeId'],
    include: {
      salesEmployee: { select: { id: true, code: true, name: true } },
      targets: {
        include: {
          bp: { select: { id: true, cardCode: true, cardName: true } },
          contactPerson: { select: { id: true, name: true, email: true } },
        },
      },
      _count: { select: { targets: true } },
    },
  };

  constructor(
    prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {
    super(prisma);
  }

  async create(companyId: string, dto: CreateCampaignDto) {
    const cid = this.requireCompany(companyId);
    return this.prisma.$transaction(async (tx) => {
      let campaignNumber: number | null = null;
      try {
        campaignNumber = (await this.numbering.allocate(tx, cid, 'campaign')).numeric;
      } catch {
        campaignNumber = null;
      }

      return tx.campaign.create({
        data: {
          companyId: cid,
          campaignNumber,
          name: dto.name,
          type: dto.type || null,
          status: dto.status ?? 'PLANNED',
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          salesEmployeeId: dto.salesEmployeeId || null,
          targetGroup: dto.targetGroup || null,
          budgetAmount: dto.budgetAmount !== undefined ? D(dto.budgetAmount) : null,
          revenueAmount: dto.revenueAmount !== undefined ? D(dto.revenueAmount) : null,
          remarks: dto.remarks || null,
          targets: { create: (dto.targetBpIds ?? []).map((bpId) => ({ bpId })) },
        },
        ...this.readArgs(),
      });
    });
  }
}
