import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingInterval,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { AuditService } from '../audit/audit.service';
import {
  ChangePlanDto,
  CreateSubscriptionDto,
  TransitionDto,
} from './dto/subscription.dto';

interface AuditContext {
  actorId: string | null;
  ip?: string;
}

/**
 * Subscription lifecycle and module-activation gating.
 *
 * State machine (Section 4.4):
 *   trial → active → past_due → suspended → cancelled → archived
 *                  ↘ active (on payment)    ↗ active (manual reactivation)
 *
 * Suspended tenants retain READ-ONLY access for 30 days; archival is the
 * end of that grace period. Reactivation is allowed up to archival.
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIAL:     ['ACTIVE', 'CANCELLED'],
  ACTIVE:    ['PAST_DUE', 'SUSPENDED', 'CANCELLED'],
  PAST_DUE:  ['ACTIVE', 'SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED:  [],
};

const READABLE_STATUSES = new Set<SubscriptionStatus>([
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED', // read-only allowed during grace
]);

const ACTIVE_STATUSES = new Set<SubscriptionStatus>(['TRIAL', 'ACTIVE', 'PAST_DUE']);
const SUSPENSION_GRACE_DAYS = 30;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateSubscriptionDto, audit: AuditContext) {
    const existing = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (existing) {
      throw new BadRequestException('Company already has a subscription; use change-plan instead');
    }

    const plan = await this.plans.findByKey(dto.planKey);

    const sub = await this.prisma.$transaction(
      (tx) => this.createTx(tx, companyId, plan, dto, audit.actorId),
      { timeout: 15_000 },
    );

    await this.recordActivity(companyId, audit, 'subscription.created', { planKey: plan.key, status: sub.status });
    return this.findByCompany(companyId);
  }

  /**
   * Core logic, usable inside a transaction the caller already owns.
   *
   * Company onboarding needs the subscription write to commit or roll back
   * atomically with the company/user/template writes, so it cannot go through
   * `create()`, which opens its own `$transaction`.
   */
  async createTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    plan: { id: string; trialDays: number },
    opts: { billingInterval?: BillingInterval; startInTrial?: boolean; seatsOverride?: number },
    actorId: string | null,
  ) {
    const now = new Date();
    const startInTrial = opts.startInTrial ?? plan.trialDays > 0;
    const trialEndsAt = startInTrial
      ? new Date(now.getTime() + plan.trialDays * 86_400_000)
      : null;

    const billingInterval = opts.billingInterval ?? BillingInterval.MONTHLY;
    const periodEnd = this.advancePeriodEnd(now, billingInterval);

    const created = await tx.subscription.create({
      data: {
        companyId,
        planId: plan.id,
        status: startInTrial ? SubscriptionStatus.TRIAL : SubscriptionStatus.ACTIVE,
        billingInterval,
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        seatsOverride: opts.seatsOverride,
      },
    });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: created.id,
        fromStatus: null,
        toStatus: created.status,
        reason: 'created',
        actorId,
      },
    });
    return created;
  }

  async findByCompany(companyId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: {
        plan: { include: { modules: { include: { module: true } } } },
        events: { orderBy: { occurredAt: 'desc' }, take: 25 },
      },
    });
    if (!sub) throw new NotFoundException('No subscription for this company');
    return sub;
  }

  async changePlan(companyId: string, dto: ChangePlanDto, audit: AuditContext) {
    const sub = await this.findByCompany(companyId);
    if (sub.status === SubscriptionStatus.ARCHIVED) {
      throw new BadRequestException('Cannot change plan on an archived subscription');
    }
    const plan = await this.plans.findByKey(dto.planKey);

    await this.prisma.subscription.update({
      where: { companyId },
      data: {
        planId: plan.id,
        billingInterval: dto.billingInterval ?? sub.billingInterval,
      },
    });
    await this.recordActivity(companyId, audit, 'subscription.plan_changed', {
      from: sub.plan.key,
      to: plan.key,
      billingInterval: dto.billingInterval ?? sub.billingInterval,
    });
    return this.findByCompany(companyId);
  }

  async transition(
    companyId: string,
    target: SubscriptionStatus,
    dto: TransitionDto,
    audit: AuditContext,
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) throw new NotFoundException('No subscription for this company');

    const allowed = ALLOWED_TRANSITIONS[sub.status];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `Illegal transition: ${sub.status} → ${target}`,
      );
    }

    const stamps: {
      pastDueAt?: Date | null;
      suspendedAt?: Date | null;
      cancelledAt?: Date | null;
      archivedAt?: Date | null;
    } = {};
    const now = new Date();
    if (target === SubscriptionStatus.PAST_DUE)  stamps.pastDueAt = now;
    if (target === SubscriptionStatus.SUSPENDED) stamps.suspendedAt = now;
    if (target === SubscriptionStatus.CANCELLED) stamps.cancelledAt = now;
    if (target === SubscriptionStatus.ARCHIVED)  stamps.archivedAt = now;
    if (target === SubscriptionStatus.ACTIVE) {
      stamps.pastDueAt = null;
      stamps.suspendedAt = null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { companyId },
        data: { status: target, ...stamps },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          fromStatus: sub.status,
          toStatus: target,
          reason: dto.reason,
          actorId: audit.actorId,
        },
      });
    });

    await this.recordActivity(companyId, audit, `subscription.${target.toLowerCase()}`, {
      from: sub.status,
      reason: dto.reason ?? null,
    });
    return this.findByCompany(companyId);
  }

  // ── Module activation gating ──────────────────────────────────────────────

  /** True if the company's subscription is in a state that permits any access. */
  async hasReadAccess(companyId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) return false;
    if (!READABLE_STATUSES.has(sub.status)) return false;
    if (sub.status === SubscriptionStatus.SUSPENDED && sub.suspendedAt) {
      const graceEnd = new Date(sub.suspendedAt.getTime() + SUSPENSION_GRACE_DAYS * 86_400_000);
      if (graceEnd.getTime() < Date.now()) return false;
    }
    return true;
  }

  async hasActiveAccess(companyId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) return false;
    return ACTIVE_STATUSES.has(sub.status);
  }

  /**
   * Asserts the company's plan includes the given module slug and the
   * subscription is in an active state. Used by the module-activation flow
   * (Companies controller).
   */
  async assertModuleOnPlan(companyId: string, moduleSlug: string): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: { include: { modules: { include: { module: true } } } } },
    });
    if (!sub) throw new BadRequestException('Company has no subscription');
    if (!ACTIVE_STATUSES.has(sub.status)) {
      throw new ForbiddenException(`Subscription is ${sub.status} — cannot activate modules`);
    }
    const onPlan = sub.plan.modules.some((m) => m.module.slug === moduleSlug);
    if (!onPlan) {
      throw new ForbiddenException(
        `Module "${moduleSlug}" is not included in the ${sub.plan.key} plan`,
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private advancePeriodEnd(start: Date, interval: BillingInterval): Date {
    const end = new Date(start);
    if (interval === BillingInterval.MONTHLY) end.setMonth(end.getMonth() + 1);
    else end.setFullYear(end.getFullYear() + 1);
    return end;
  }

  private async recordActivity(
    companyId: string,
    audit: AuditContext,
    action: string,
    details: Prisma.InputJsonValue,
  ) {
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action,
      refType: 'subscription',
      after: details,
      ip: audit.ip,
      module: 'tenancy',
      details,
    });
  }
}
