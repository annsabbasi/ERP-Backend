import { z } from 'zod';
import { SCOPE_TYPES, type LimitKey, type ScopeType } from './registry';

// The three gates (Part 02 §2.12) as data both sides share: what each tenant status allows
// (Part 03 §3.7.2), the GET /me/access answer (Part 10 §10.7.5) and the record check behind
// can(key, record). The API is the authority; clients use the same answer only to decide what
// to show.

/** Tenant lifecycle (Part 03 §3.7.2, Part 11 §11.6). */
export const TENANT_STATUSES = [
  'provisioning',
  'trial',
  'trial_expired',
  'active',
  'past_due',
  'suspended_read_only',
  'suspended_locked',
  'pending_termination',
  'terminated',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Actions a read-only company, or a feature in its read-only window, still allows. */
export const READ_ONLY_ACTIONS: readonly string[] = ['view', 'view_sensitive', 'export'];

/** What an Owner may still do while the company cannot work: pay and subscribe. */
const BILLING_PERMISSIONS = new Set([
  'core.billing.view',
  'core.billing.configure',
  'core.plan.view',
  'core.plan.request',
]);
const FULL_EXPORT = 'core.data.export';

const actionOf = (key: string) => key.slice(key.lastIndexOf('.') + 1);

/**
 * Whether members can reach the company at all in this status: everyone while it works or is
 * read-only, only the Owner while locked or closing, nobody while provisioning or terminated.
 */
export function canEnterTenant(status: TenantStatus, isOwner: boolean): boolean {
  switch (status) {
    case 'trial':
    case 'active':
    case 'past_due':
    case 'trial_expired':
    case 'suspended_read_only':
      return true;
    case 'suspended_locked':
    case 'pending_termination':
      return isOwner;
    default:
      return false;
  }
}

/** Whether the tenant's status allows a permission (§3.7.2 "Users can" column). */
export function allowedByTenantStatus(
  status: TenantStatus,
  isOwner: boolean,
  permission: string,
): boolean {
  const action = actionOf(permission);
  switch (status) {
    case 'trial':
    case 'active':
    case 'past_due':
      return true;
    case 'trial_expired': // sign in, view, export; the Owner can subscribe
      return READ_ONLY_ACTIONS.includes(action) || (isOwner && BILLING_PERMISSIONS.has(permission));
    case 'suspended_read_only': // sign in, view, export
      return READ_ONLY_ACTIONS.includes(action);
    case 'suspended_locked': // only the Owner, to billing and export
      return isOwner && (BILLING_PERMISSIONS.has(permission) || action === 'export');
    case 'pending_termination': // Owner: export only
      return isOwner && (permission === FULL_EXPORT || action === 'export');
    default:
      return false;
  }
}

/** A feature in its read-only window (a trial that ended, a gentle switch-off) keeps viewing. */
export function allowedByFeatureState(state: FeatureState, permission: string): boolean {
  return state === 'on' || READ_ONLY_ACTIONS.includes(actionOf(permission));
}

export const FEATURE_STATES = ['on', 'read_only'] as const;
export type FeatureState = (typeof FEATURE_STATES)[number];

/**
 * One grant of a permission: its scope type and the ids that scope covers, resolved by the
 * server (branch scope with no branches = the member's primary branch; department scope covers
 * sub-departments; team scope lists the members of the teams the member leads, and the member).
 */
export const GrantSchema = z.object({
  scope: z.enum(SCOPE_TYPES),
  /** branch_ids, department_ids, legal_entity_ids, member_ids (team), section_ids, class_ids… */
  values: z.record(z.string(), z.array(z.string())),
  /** For example { "max_discount_pct": 10 } (Part 04 §4.9.5). */
  thresholds: z.record(z.string(), z.unknown()),
});
export type Grant = z.infer<typeof GrantSchema>;

export const MenuEntrySchema = z.object({
  path: z.string(),
  /** i18n key */
  label: z.string(),
  feature: z.string(),
  requires: z.string(),
});

/** GET /me/access (Part 10 §10.7.5, Part 05 §5.5.1). */
export const MeAccessSchema = z.object({
  tenant: z.object({ id: z.string(), code: z.string(), status: z.enum(TENANT_STATUSES) }),
  membership_id: z.string(),
  is_owner: z.boolean(),
  /** The version this answer belongs to; a different X-Access-Version means ask again. */
  pv: z.number().int(),
  /** When this answer changes by itself (an entitlement, trial or exception ends). */
  valid_until: z.string().nullable(),
  features: z.array(z.object({ key: z.string(), state: z.enum(FEATURE_STATES) })),
  /** Permission key → its grants. A key that is absent is not allowed. */
  permissions: z.record(z.string(), z.array(GrantSchema)),
  /** Navigation: groups in registry order, each with the entries this member may open. */
  menu: z.array(z.object({ group: z.string(), entries: z.array(MenuEntrySchema) })),
  /** The role home page (Part 05 §5.6); "home" until role home pages exist. */
  home: z.string(),
  quick_create: z.array(MenuEntrySchema),
});
export type MeAccess = z.infer<typeof MeAccessSchema>;

/**
 * Sent on every company response: the access version the server holds now. When it differs
 * from the token's pv, the client refreshes its token and asks GET /me/access again.
 */
export const ACCESS_VERSION_HEADER = 'x-access-version';

/**
 * A record as can(key, record) sees it: the fields scopes look at, in API names. `assigned`
 * maps an assignment kind to the record's value, for example { section_ids: "…" }.
 */
export type ScopedRecord = {
  created_by?: string | null;
  membership_id?: string | null;
  branch_id?: string | null;
  department_id?: string | null;
  legal_entity_id?: string | null;
  assigned?: Readonly<Record<string, string | null | undefined>>;
};

const VALUE_KEYS: Partial<Record<ScopeType, keyof ScopedRecord>> = {
  branch: 'branch_id',
  department: 'department_id',
  legal_entity: 'legal_entity_id',
};
const VALUE_LISTS: Partial<Record<ScopeType, string>> = {
  branch: 'branch_ids',
  department: 'department_ids',
  legal_entity: 'legal_entity_ids',
};

/** Whether one grant covers a record (Part 11 §11.8 "Resolution for lists"). */
export function grantCovers(grant: Grant, record: ScopedRecord, membershipId: string): boolean {
  const owner = record.created_by ?? record.membership_id ?? null;
  switch (grant.scope) {
    case 'company':
      return true;
    case 'own':
      return record.created_by === membershipId || record.membership_id === membershipId;
    case 'team':
      return owner !== null && (grant.values.member_ids ?? []).includes(owner);
    case 'assigned':
      return Object.entries(record.assigned ?? {}).some(
        ([kind, id]) => !!id && (grant.values[kind] ?? []).includes(id),
      );
    default: {
      const id = record[VALUE_KEYS[grant.scope]!] as string | null | undefined;
      return !!id && (grant.values[VALUE_LISTS[grant.scope]!] ?? []).includes(id);
    }
  }
}

/**
 * can(key, record?) on a /me/access answer: the permission is present and, when a record is
 * given, one of its grants covers it. A convenience for screens; the API decides.
 */
export function canAccess(access: MeAccess, permission: string, record?: ScopedRecord): boolean {
  const grants = access.permissions[permission];
  if (!grants || grants.length === 0) return false;
  if (!record) return true;
  return grants.some((g) => grantCovers(g, record, access.membership_id));
}

/** Usage behaviour per limit (Part 02 §2.11.1). Unlisted limits block at 100% with no warning. */
export const LIMIT_POLICIES: Partial<Record<LimitKey, { warnAt?: number; grace?: number }>> = {
  'school.students.max': { warnAt: 0.9, grace: 0.05 },
  'storage.gb': { warnAt: 0.8 },
};

/** The `limit` member of a limit_reached problem: which limit, how much is used, the limit. */
export const LimitUsageSchema = z.object({
  key: z.string(),
  used: z.number(),
  limit: z.number(),
});
export type LimitUsage = z.infer<typeof LimitUsageSchema>;
