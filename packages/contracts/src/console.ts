import { z } from 'zod';
import { CountryPackDataSchema } from './country-packs';
import { STATUSES } from './registry';
import { STAFF_ROLES } from './staff';
import { SEMVER, TEMPLATE_STATUSES, TemplateDefinitionSchema } from './templates';

// Platform Console API (/api/platform/v1, Part 11 §11.10.3): staff, catalogue, plans, industry
// templates, country packs, four-eyes approvals and the platform audit log.

/** Every change in the console says why (Part 03 §3.17: the audit log keeps the reason). */
const Reason = z.string().trim().min(3).max(500);
const StaffRef = z.object({ id: z.string(), name: z.string() });

// ── Staff (§3.2) ─────────────────────────────────────────────────────────────────────────────

export const StaffMemberSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['invited', 'active', 'suspended', 'removed']),
  roles: z.array(z.enum(STAFF_ROLES)),
  last_sign_in_at: z.string().nullable(),
  created_at: z.string(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;
export const StaffListSchema = z.object({ data: z.array(StaffMemberSchema) });

export const InviteStaffRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(200),
  roles: z.array(z.enum(STAFF_ROLES)).min(1),
  reason: Reason,
});
export const StaffRolesRequestSchema = z.object({
  roles: z.array(z.enum(STAFF_ROLES)).min(1),
  reason: Reason,
});
export const StaffDeactivateRequestSchema = z.object({ reason: Reason });

// ── Catalogue: modules and features (§3.11) ──────────────────────────────────────────────────

export const CatalogueFeatureViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  display_order: z.number().int().nullable(),
  countries: z.array(z.string()),
  status: z.enum(STATUSES),
  status_override: z.enum(STATUSES).nullable(),
  release: z.string(),
  always_on: z.boolean(),
  requires: z.array(z.string()),
  permissions: z.number().int(),
});
export const CatalogueModuleViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  display_order: z.number().int().nullable(),
  category: z.string(),
  group: z.string(),
  status: z.enum(STATUSES),
  features: z.array(CatalogueFeatureViewSchema),
});
export const CatalogueModulesSchema = z.object({ data: z.array(CatalogueModuleViewSchema) });

const DisplayFields = {
  display_name: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  display_order: z.number().int().min(0).max(10_000).nullable().optional(),
};
export const ModuleDisplayPatchSchema = z.object({ ...DisplayFields, reason: Reason });
export const FeatureDisplayPatchSchema = z.object({
  ...DisplayFields,
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  status_override: z.enum(STATUSES).nullable().optional(),
  reason: Reason,
});

// ── Plans and add-ons (§3.11) ───────────────────────────────────────────────────────────────

/** Prices per currency and billing period, in the currency's major unit: { PKR: { monthly: 4900 } }. */
export const PricesSchema = z.record(
  z.string().regex(/^[A-Z]{3}$/),
  z.partialRecord(z.enum(['monthly', 'quarterly', 'yearly']), z.number().nonnegative()),
);

export const PlanSchema = z.object({
  key: z.string(),
  kind: z.enum(['plan', 'addon']),
  name: z.string(),
  tier: z.number().int().nullable(),
  limits: z.record(z.string(), z.number().int().nonnegative()),
  feature_keys: z.array(z.string()),
  prices: PricesSchema,
  visibility: z.enum(['public', 'private']),
  effective_from: z.string(),
  archived_at: z.string().nullable(),
  version: z.number().int(),
});
export type PlanView = z.infer<typeof PlanSchema>;
export const PlansSchema = z.object({ data: z.array(PlanSchema) });

export const PlanUpsertSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  kind: z.enum(['plan', 'addon']),
  name: z.string().trim().min(1).max(120),
  tier: z.number().int().min(1).max(99).nullable(),
  limits: z.record(z.string(), z.number().int().nonnegative()),
  feature_keys: z.array(z.string()),
  prices: PricesSchema,
  visibility: z.enum(['public', 'private']),
  effective_from: z.string().optional(),
  reason: Reason,
});
export const PlanPricesRequestSchema = z.object({ prices: PricesSchema, reason: Reason });
export const ArchiveRequestSchema = z.object({ reason: Reason });

// ── Industry templates (§3.11) ──────────────────────────────────────────────────────────────

export const TemplateSummarySchema = z.object({
  key: z.string(),
  version: z.string(),
  status: z.enum(TEMPLATE_STATUSES),
  name: z.object({ en: z.string(), ur: z.string() }),
  industry: z.string(),
  roles: z.number().int(),
  entitlements: z.number().int(),
  published_at: z.string().nullable(),
  published_by: StaffRef.nullable(),
  updated_at: z.string(),
  revision: z.number().int(),
});
export const TemplatesSchema = z.object({ data: z.array(TemplateSummarySchema) });
export const TemplateDetailSchema = TemplateSummarySchema.extend({
  definition: TemplateDefinitionSchema,
  /** What stops this version from being published; empty when it can be. */
  problems: z.array(z.string()),
});
export type TemplateDetail = z.infer<typeof TemplateDetailSchema>;

export const TemplateDraftCreateSchema = z.object({
  /** The new version; copied from `from_version` of the same template. */
  version: z.string().regex(SEMVER),
  from_version: z.string().regex(SEMVER),
  reason: Reason,
});
export const TemplateDraftUpdateSchema = z.object({
  definition: TemplateDefinitionSchema,
  reason: Reason,
});

export const TemplateDiffSchema = z.object({
  from: z.string(),
  to: z.string(),
  entitlements: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
  limits: z.array(
    z.object({ key: z.string(), before: z.number().nullable(), after: z.number().nullable() }),
  ),
  roles: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(
      z.object({ key: z.string(), added: z.array(z.string()), removed: z.array(z.string()) }),
    ),
  }),
  terminology: z.array(z.string()),
  settings: z.array(z.string()),
  wizard: z.boolean(),
});

// ── Country packs (§3.11) ───────────────────────────────────────────────────────────────────

export const CountryPackSummarySchema = z.object({
  country: z.string(),
  version: z.string(),
  status: z.enum(TEMPLATE_STATUSES),
  name: z.string(),
  effective_from: z.string(),
  published_at: z.string().nullable(),
  published_by: StaffRef.nullable(),
  updated_at: z.string(),
  revision: z.number().int(),
});
export const CountryPacksSchema = z.object({ data: z.array(CountryPackSummarySchema) });
export const CountryPackDetailSchema = CountryPackSummarySchema.extend({
  data: CountryPackDataSchema,
  problems: z.array(z.string()),
});
export const CountryPackDraftCreateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  from_version: z.string(),
  reason: Reason,
});
export const CountryPackDraftUpdateSchema = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data: CountryPackDataSchema,
  reason: Reason,
});

// ── Four-eyes approvals (§3.2.1 ◐) ──────────────────────────────────────────────────────────

export const APPROVAL_ACTIONS = [
  'template.publish',
  'country_pack.publish',
  'plan.prices',
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const ApprovalSchema = z.object({
  id: z.string(),
  action: z.enum(APPROVAL_ACTIONS),
  target_type: z.string(),
  target_id: z.string(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']),
  requested_by: StaffRef,
  requested_at: z.string(),
  expires_at: z.string(),
  decided_by: StaffRef.nullable(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
  /** Whether the person asking may approve or reject it (eligible and not the requester). */
  can_decide: z.boolean(),
});
export type Approval = z.infer<typeof ApprovalSchema>;
export const ApprovalsSchema = z.object({ data: z.array(ApprovalSchema) });
export const PublishRequestSchema = z.object({ reason: Reason });
export const ApprovalDecisionSchema = z.object({ note: z.string().trim().max(500).optional() });
export const ApprovalRejectSchema = z.object({ note: z.string().trim().min(3).max(500) });

// ── Platform audit log (§3.17) ──────────────────────────────────────────────────────────────

export const AuditEntrySchema = z.object({
  seq: z.string(),
  id: z.string(),
  at: z.string(),
  actor: StaffRef.nullable(),
  action: z.string(),
  target_tenant_id: z.string().nullable(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  correlation_id: z.string().nullable(),
  result: z.enum(['success', 'failure']),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export const AuditPageSchema = z.object({
  data: z.array(AuditEntrySchema),
  next_cursor: z.string().nullable(),
});
export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/).optional(),
  actor: z.string().uuid().optional(),
  /** Matches the action key or its prefix, for example "catalogue." */
  action: z.string().max(100).optional(),
  target_type: z.string().max(60).optional(),
  target_id: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ── Search (Ctrl+K, §3.3.2) ─────────────────────────────────────────────────────────────────

export const ConsoleSearchSchema = z.object({
  tenants: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      slug: z.string(),
      display_name: z.string(),
      status: z.string(),
    }),
  ),
  pages: z.array(z.object({ path: z.string(), label: z.string() })),
});

/** A console change either ran, or waits for a second approver (◐). */
export const ChangeResultSchema = z.union([
  z.object({ status: z.literal('done') }),
  z.object({ status: z.literal('pending'), approval_id: z.string() }),
]);
export type ChangeResult = z.infer<typeof ChangeResultSchema>;
