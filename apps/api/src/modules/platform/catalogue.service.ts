import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CATALOGUE,
  LIMIT_KEYS,
  type ChangeResult,
  type FeatureDisplayPatchSchema,
  type ModuleDisplayPatchSchema,
  type PlanUpsertSchema,
  type PlanView,
  type PricesSchema,
  type Status,
} from '@erp/contracts';
import type { z } from 'zod';
import { assertIfMatch } from '../../common/etag';
import { ProblemException } from '../../common/problem';
import { ApprovalsService } from './approvals.service';
import { PlatformAuditService, type Tx } from './platform-audit.service';
import { PlatformDatabase } from './platform-database.service';
import type { StaffContext } from './staff-access.service';

// Catalogue management (Part 03 §3.11): modules and features come from the registry; staff edit
// only their display fields. Plans and add-ons are staff data: tiers, limits, included features
// and prices. Every change is audited with before and after values and a reason (AC-P12).

const MODULE_FIELDS = ['display_name', 'description', 'icon', 'display_order'] as const;
const FEATURE_FIELDS = [...MODULE_FIELDS, 'countries', 'status_override'] as const;
const camel: Record<string, string> = {
  display_name: 'displayName',
  description: 'description',
  icon: 'icon',
  display_order: 'displayOrder',
  countries: 'countries',
  status_override: 'statusOverride',
};

function pick<T extends Record<string, unknown>>(
  row: Record<string, unknown>,
  fields: readonly string[],
): T {
  return Object.fromEntries(fields.map((f) => [f, row[camel[f]!] ?? null])) as T;
}

@Injectable()
export class CatalogueService implements OnModuleInit {
  constructor(
    private readonly platform: PlatformDatabase,
    private readonly audit: PlatformAuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // A Billing Manager's price change (◐) runs when a second eligible person approves it.
    this.approvals.register('plan.prices', {
      execute: async (tx, approval, approver) => {
        const { kind, prices } = approval.payload as {
          kind: 'plan' | 'addon';
          prices: z.infer<typeof PricesSchema>;
        };
        const before = await this.applyPrices(tx, kind, approval.targetId, prices, approver.id);
        await this.audit.write(tx, {
          actor: approver.id,
          action: 'catalogue.plan_prices_changed',
          targetType: kind,
          targetId: approval.targetId,
          before: { prices: before },
          after: { prices, requested_by: approval.requestedBy },
          reason: `approved request ${approval.id}`,
        });
        return { prices };
      },
    });
  }

  // ── Modules and features ────────────────────────────────────────────────────────────────

  async modules() {
    const [modules, features] = await Promise.all([
      this.platform.db.catalogueModule.findMany({ where: { removedAt: null } }),
      this.platform.db.catalogueFeature.findMany({ where: { removedAt: null } }),
    ]);
    const moduleRows = new Map(modules.map((m) => [m.key, m]));
    const featureRows = new Map(features.map((f) => [f.key, f]));
    return CATALOGUE.modules.map((m) => {
      const row = moduleRows.get(m.key);
      return {
        key: m.key,
        name: m.name,
        display_name: row?.displayName ?? null,
        description: row?.description ?? null,
        icon: row?.icon ?? null,
        display_order: row?.displayOrder ?? null,
        category: m.category,
        group: m.group,
        status: m.status,
        features: m.features.map((f) => {
          const fr = featureRows.get(f.key);
          return {
            key: f.key,
            name: f.name,
            display_name: fr?.displayName ?? null,
            description: fr?.description ?? null,
            icon: fr?.icon ?? null,
            display_order: fr?.displayOrder ?? null,
            countries: fr?.countries ?? [],
            status: f.status,
            status_override: (fr?.statusOverride as Status | null) ?? null,
            release: f.release,
            always_on: f.alwaysOn,
            requires: [...f.requires],
            permissions: f.permissions.length,
          };
        }),
      };
    });
  }

  async patchModule(
    staff: StaffContext,
    key: string,
    patch: z.infer<typeof ModuleDisplayPatchSchema>,
  ): Promise<void> {
    await this.patchDisplay(staff, 'module', key, patch, MODULE_FIELDS);
  }

  async patchFeature(
    staff: StaffContext,
    key: string,
    patch: z.infer<typeof FeatureDisplayPatchSchema>,
  ): Promise<void> {
    await this.patchDisplay(staff, 'feature', key, patch, FEATURE_FIELDS);
  }

  private async patchDisplay(
    staff: StaffContext,
    kind: 'module' | 'feature',
    key: string,
    patch: Record<string, unknown> & { reason: string },
    fields: readonly string[],
  ): Promise<void> {
    const changes = Object.fromEntries(
      fields.filter((f) => patch[f] !== undefined).map((f) => [camel[f]!, patch[f]]),
    );
    if (!Object.keys(changes).length)
      throw new ProblemException('validation_failed', 'Nothing to change');
    await this.platform.db.$transaction(async (tx) => {
      const row =
        kind === 'module'
          ? await tx.catalogueModule.findUnique({ where: { key } })
          : await tx.catalogueFeature.findUnique({ where: { key } });
      if (!row || row.removedAt) throw new ProblemException('not_found');
      const data = { ...changes, updatedAt: new Date(), updatedBy: staff.id };
      if (kind === 'module') await tx.catalogueModule.update({ where: { key }, data });
      else await tx.catalogueFeature.update({ where: { key }, data });
      await this.audit.write(tx, {
        actor: staff.id,
        action: `catalogue.${kind}_display_changed`,
        targetType: `catalogue_${kind}`,
        targetId: key,
        before: pick(row as unknown as Record<string, unknown>, fields),
        after: pick({ ...(row as unknown as Record<string, unknown>), ...changes }, fields),
        reason: patch.reason,
      });
    });
  }

  // ── Plans and add-ons ───────────────────────────────────────────────────────────────────

  async plans(): Promise<PlanView[]> {
    const [plans, addons] = await Promise.all([
      this.platform.db.plan.findMany({ orderBy: [{ tier: 'asc' }, { key: 'asc' }] }),
      this.platform.db.addon.findMany({ orderBy: { key: 'asc' } }),
    ]);
    const view = (
      kind: 'plan' | 'addon',
      p: (typeof plans)[number] | (typeof addons)[number],
    ): PlanView => ({
      key: p.key,
      kind,
      name: p.name,
      tier: 'tier' in p ? p.tier : null,
      limits: p.limits as Record<string, number>,
      feature_keys: p.featureKeys,
      prices: p.prices as PlanView['prices'],
      visibility: p.visibility as 'public' | 'private',
      effective_from: p.effectiveFrom.toISOString(),
      archived_at: p.archivedAt?.toISOString() ?? null,
      version: p.version,
    });
    return [...plans.map((p) => view('plan', p)), ...addons.map((a) => view('addon', a))];
  }

  /** Creates a plan or add-on, or updates one (If-Match its version). */
  async upsertPlan(
    staff: StaffContext,
    input: z.infer<typeof PlanUpsertSchema>,
    ifMatch?: string,
  ): Promise<PlanView> {
    const unknownFeatures = input.feature_keys.filter((k) => !CATALOGUE.getFeature(k));
    const unknownLimits = Object.keys(input.limits).filter(
      (k) => !(LIMIT_KEYS as readonly string[]).includes(k),
    );
    if (unknownFeatures.length || unknownLimits.length) {
      throw new ProblemException('validation_failed', 'Unknown features or limits', {
        errors: [
          ...unknownFeatures.map((k) => ({
            field: 'feature_keys',
            message: `${k} is not in the registry`,
          })),
          ...unknownLimits.map((k) => ({ field: 'limits', message: `${k} is not a limit` })),
        ],
      });
    }
    if (input.kind === 'plan' && input.tier === null) {
      throw new ProblemException('validation_failed', 'A plan needs a tier', {
        errors: [{ field: 'tier', message: 'Required for plans' }],
      });
    }
    await this.platform.db.$transaction(async (tx) => {
      const existing = await this.findPlan(tx, input.kind, input.key);
      const data = {
        name: input.name,
        limits: input.limits,
        featureKeys: input.feature_keys,
        prices: input.prices,
        visibility: input.visibility,
        ...(input.effective_from ? { effectiveFrom: new Date(input.effective_from) } : {}),
        updatedBy: staff.id,
      };
      if (existing) {
        assertIfMatch(ifMatch, existing.version);
        const update = { ...data, version: { increment: 1 } };
        if (input.kind === 'plan')
          await tx.plan.update({
            where: { key: input.key },
            data: { ...update, tier: input.tier! },
          });
        else await tx.addon.update({ where: { key: input.key }, data: update });
      } else if (input.kind === 'plan') {
        await tx.plan.create({ data: { key: input.key, tier: input.tier!, ...data } });
      } else {
        await tx.addon.create({ data: { key: input.key, ...data } });
      }
      await this.audit.write(tx, {
        actor: staff.id,
        action: existing ? `catalogue.${input.kind}_updated` : `catalogue.${input.kind}_created`,
        targetType: input.kind,
        targetId: input.key,
        before: existing ? planAudit(existing) : null,
        after: {
          name: input.name,
          tier: input.tier,
          limits: input.limits,
          feature_keys: input.feature_keys,
          prices: input.prices,
          visibility: input.visibility,
        },
        reason: input.reason,
      });
    });
    return (await this.plans()).find((p) => p.kind === input.kind && p.key === input.key)!;
  }

  /** Price changes: direct for Owner and Admin, through a second approver for Billing (◐). */
  async changePrices(
    staff: StaffContext,
    kind: 'plan' | 'addon',
    key: string,
    prices: z.infer<typeof PricesSchema>,
    reason: string,
  ): Promise<ChangeResult> {
    return this.platform.db.$transaction(async (tx) => {
      if (!(await this.findPlan(tx, kind, key))) throw new ProblemException('not_found');
      if (staff.permissions['catalogue.prices'] === 'four_eyes') {
        const approvalId = await this.approvals.request(tx, staff, {
          action: 'plan.prices',
          targetType: kind,
          targetId: key,
          payload: { kind, prices },
          reason,
        });
        return { status: 'pending', approval_id: approvalId };
      }
      const before = await this.applyPrices(tx, kind, key, prices, staff.id);
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'catalogue.plan_prices_changed',
        targetType: kind,
        targetId: key,
        before: { prices: before },
        after: { prices },
        reason,
      });
      return { status: 'done' };
    });
  }

  async archivePlan(
    staff: StaffContext,
    kind: 'plan' | 'addon',
    key: string,
    reason: string,
  ): Promise<void> {
    await this.platform.db.$transaction(async (tx) => {
      const existing = await this.findPlan(tx, kind, key);
      if (!existing) throw new ProblemException('not_found');
      if (existing.archivedAt) throw new ProblemException('conflict', 'Already archived');
      const data = { archivedAt: new Date(), updatedBy: staff.id, version: { increment: 1 } };
      if (kind === 'plan') await tx.plan.update({ where: { key }, data });
      else await tx.addon.update({ where: { key }, data });
      await this.audit.write(tx, {
        actor: staff.id,
        action: `catalogue.${kind}_archived`,
        targetType: kind,
        targetId: key,
        before: { archived_at: null },
        after: { archived_at: new Date().toISOString() },
        reason,
      });
    });
  }

  private async findPlan(tx: Tx, kind: 'plan' | 'addon', key: string) {
    return kind === 'plan'
      ? tx.plan.findUnique({ where: { key } })
      : tx.addon.findUnique({ where: { key } });
  }

  private async applyPrices(
    tx: Tx,
    kind: 'plan' | 'addon',
    key: string,
    prices: z.infer<typeof PricesSchema>,
    staffId: string,
  ): Promise<unknown> {
    const existing = await this.findPlan(tx, kind, key);
    if (!existing) throw new ProblemException('not_found');
    const data = { prices, updatedBy: staffId, version: { increment: 1 } };
    if (kind === 'plan') await tx.plan.update({ where: { key }, data });
    else await tx.addon.update({ where: { key }, data });
    return existing.prices;
  }
}

function planAudit(p: {
  name: string;
  limits: unknown;
  featureKeys: string[];
  prices: unknown;
  visibility: string;
  tier?: number;
}) {
  return {
    name: p.name,
    tier: p.tier ?? null,
    limits: p.limits,
    feature_keys: p.featureKeys,
    prices: p.prices,
    visibility: p.visibility,
  };
}
