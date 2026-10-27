import {
  allowedByFeatureState,
  allowedByTenantStatus,
  CATALOGUE,
  SCOPE_TYPES,
  type Catalogue,
  type FeatureState,
  type Grant,
  type ProblemCode,
  type ScopeType,
  type TenantStatus,
} from '@erp/contracts';

// The effective access of one membership (Part 02 §2.11–2.12, Part 10 §10.7.3), as a pure
// function of what the database holds, so the formula is tested without one:
//
//   features    = (plan ∪ template ∪ add-ons ∪ manual allows ∪ trials, valid now)
//                 − manual denies − features whose hard requirements are not effective
//   permissions = grants of the member's roles (the Owner: every permission, company scope)
//                 + allow exceptions − deny exceptions
//                 − permissions no effective feature unlocks
//                 − what the feature's read-only window or the tenant's status does not allow

export type EntitlementRow = {
  featureKey: string;
  state: string;
  source: string;
  validFrom: Date;
  validTo: Date | null;
};

export type RoleGrantRow = {
  permissionKey: string;
  scopeType: string;
  thresholds: Record<string, unknown>;
  /** The membership's scope values for the role holding this grant. */
  scopeValues: Record<string, unknown>;
};

export type ExceptionRow = {
  permissionKey: string;
  effect: string;
  scopeType: string | null;
  scopeValues: Record<string, unknown>;
  expiresAt: Date;
};

export type AccessInput = {
  now: Date;
  tenant: { id: string; code: string; status: TenantStatus; entitlementsVersion: number };
  membership: {
    id: string;
    permissionsVersion: number;
    primaryBranchId: string | null;
    departmentId: string | null;
    /** The legal entity of the primary branch: the default of legal-entity scope. */
    primaryLegalEntityId: string | null;
  };
  isOwner: boolean;
  entitlements: readonly EntitlementRow[];
  roleGrants: readonly RoleGrantRow[];
  exceptions: readonly ExceptionRow[];
  /** The tenant's department tree, so department scope covers sub-departments (§11.8). */
  departments: readonly { id: string; parentId: string | null }[];
  /** Members of the teams this member leads: team scope (§11.8). */
  ledTeamMemberIds: readonly string[];
};

export type MemberAccess = {
  tenantId: string;
  tenantCode: string;
  status: TenantStatus;
  membershipId: string;
  isOwner: boolean;
  pv: number;
  /** ISO time when the answer changes by itself; null when nothing is scheduled. */
  validUntil: string | null;
  features: Record<string, FeatureState>;
  permissions: Record<string, Grant[]>;
  /** Permissions the roles give before the read-only window and the tenant status apply. */
  granted: string[];
};

const ALLOW_SOURCES = new Set(['plan', 'template', 'addon', 'manual', 'trial']);

/** Effective features with their state, and the next time the set changes by itself. */
export function effectiveFeatures(
  rows: readonly EntitlementRow[],
  now: Date,
  catalogue: Catalogue = CATALOGUE,
): { features: Map<string, FeatureState>; changesAt: Date | null } {
  let changesAt: Date | null = null;
  const later = (d: Date | null) => {
    if (d && d > now && (!changesAt || d < changesAt)) changesAt = d;
  };
  const given = new Map<string, FeatureState>();
  const denied = new Set<string>();
  for (const row of rows) {
    later(row.validFrom);
    later(row.validTo);
    if (row.validFrom > now || (row.validTo && row.validTo <= now)) continue;
    if (row.state === 'off') {
      if (row.source === 'manual') denied.add(row.featureKey);
      continue;
    }
    if (!ALLOW_SOURCES.has(row.source)) continue;
    // Any source giving it fully wins over a read-only one.
    if (given.get(row.featureKey) !== 'on') {
      given.set(row.featureKey, row.state === 'on' ? 'on' : 'read_only');
    }
  }
  const effective = catalogue.effectiveFeatures([...given.keys()].filter((k) => !denied.has(k)));
  const features = new Map<string, FeatureState>();
  for (const key of effective) features.set(key, given.get(key) ?? 'on');
  // A feature whose requirements are only read-only is read-only too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, state] of features) {
      if (state === 'read_only') continue;
      const f = catalogue.getFeature(key)!;
      const readOnlyNeed = f.requires.some((r) => features.get(r) === 'read_only');
      const anyOf = f.requiresAnyOf.filter((r) => features.has(r));
      const readOnlyAnyOf = anyOf.length > 0 && anyOf.every((r) => features.get(r) === 'read_only');
      if (readOnlyNeed || readOnlyAnyOf) {
        features.set(key, 'read_only');
        changed = true;
      }
    }
  }
  return { features, changesAt };
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function descendants(roots: string[], tree: AccessInput['departments']): string[] {
  const children = new Map<string, string[]>();
  for (const d of tree) {
    if (!d.parentId) continue;
    children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  }
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...out];
}

/** The ids a scope covers for this member: the role's own values, else the member's defaults. */
function resolveScope(
  scope: ScopeType,
  values: Record<string, unknown>,
  input: AccessInput,
): Grant['values'] | null {
  const m = input.membership;
  switch (scope) {
    case 'own':
    case 'company':
      return {};
    case 'branch': {
      const branchIds = ids(values.branch_ids);
      return {
        branch_ids: branchIds.length ? branchIds : m.primaryBranchId ? [m.primaryBranchId] : [],
      };
    }
    case 'department': {
      const roots = ids(values.department_ids);
      const base = roots.length ? roots : m.departmentId ? [m.departmentId] : [];
      return { department_ids: descendants(base, input.departments) };
    }
    case 'legal_entity': {
      const entityIds = ids(values.legal_entity_ids);
      const base = entityIds.length
        ? entityIds
        : m.primaryLegalEntityId
          ? [m.primaryLegalEntityId]
          : [];
      return { legal_entity_ids: base };
    }
    case 'team':
      return { member_ids: [...new Set([m.id, ...input.ledTeamMemberIds])] };
    case 'assigned': {
      const out: Grant['values'] = {};
      for (const [key, value] of Object.entries(values)) {
        if (
          key.endsWith('_ids') &&
          !['branch_ids', 'department_ids', 'legal_entity_ids'].includes(key)
        ) {
          out[key] = ids(value);
        }
      }
      return out;
    }
    default:
      return null;
  }
}

const isScope = (s: string | null): s is ScopeType =>
  s !== null && (SCOPE_TYPES as readonly string[]).includes(s);

export function computeAccess(input: AccessInput, catalogue: Catalogue = CATALOGUE): MemberAccess {
  const { features, changesAt } = effectiveFeatures(input.entitlements, input.now, catalogue);
  let validUntil = changesAt as Date | null;

  // Scope types a permission may be granted with: those of the features that unlock it.
  const scopesOf = (key: string) =>
    new Set(catalogue.featuresOfPermission(key).flatMap((f) => catalogue.getFeature(f)!.scopes));
  const entitled = (key: string) =>
    catalogue.featuresOfPermission(key).some((f) => features.has(f));

  const grants = new Map<string, Grant[]>();
  const add = (
    key: string,
    scope: string | null,
    values: Record<string, unknown>,
    thresholds = {},
  ) => {
    if (!isScope(scope) || !scopesOf(key).has(scope)) return; // unknown or not allowed: fail closed
    const resolved = resolveScope(scope, values, input);
    if (!resolved) return;
    const grant: Grant = { scope, values: resolved, thresholds };
    const list = grants.get(key) ?? [];
    if (!list.some((g) => JSON.stringify(g) === JSON.stringify(grant))) list.push(grant);
    grants.set(key, list);
  };

  if (input.isOwner) {
    // The Owner holds everything the company is entitled to (Part 04 §4.1, §4.9.7).
    for (const key of features.keys()) {
      for (const permission of catalogue.getFeature(key)!.permissions)
        add(permission, 'company', {});
    }
  }
  for (const g of input.roleGrants) add(g.permissionKey, g.scopeType, g.scopeValues, g.thresholds);

  const live = input.exceptions.filter((e) => e.expiresAt > input.now);
  for (const e of live) {
    if (!validUntil || e.expiresAt < validUntil) validUntil = e.expiresAt;
  }
  for (const e of live)
    if (e.effect === 'allow') add(e.permissionKey, e.scopeType ?? 'own', e.scopeValues);
  // Nobody else can demote the Owner (Part 04 §4.23), so restrictions never apply to them.
  if (!input.isOwner) for (const e of live) if (e.effect === 'deny') grants.delete(e.permissionKey);

  const granted: string[] = [];
  const permissions: Record<string, Grant[]> = {};
  for (const [key, list] of [...grants].sort(([a], [b]) => a.localeCompare(b))) {
    if (!entitled(key)) continue; // dormant: the grant stays stored, ignored (§3.9.4)
    granted.push(key);
    const owners = catalogue.featuresOfPermission(key).filter((f) => features.has(f));
    const byFeature = owners.some((f) => allowedByFeatureState(features.get(f)!, key));
    if (!byFeature || !allowedByTenantStatus(input.tenant.status, input.isOwner, key)) continue;
    permissions[key] = list;
  }

  return {
    tenantId: input.tenant.id,
    tenantCode: input.tenant.code,
    status: input.tenant.status,
    membershipId: input.membership.id,
    isOwner: input.isOwner,
    pv: input.membership.permissionsVersion + input.tenant.entitlementsVersion,
    validUntil: validUntil ? validUntil.toISOString() : null,
    features: Object.fromEntries([...features].sort(([a], [b]) => a.localeCompare(b))),
    permissions,
    granted,
  };
}

/** Why a permission is refused, in gate order (Part 02 §2.12), for the problem answer. */
export function refusalOf(
  access: MemberAccess,
  permission: string,
  catalogue: Catalogue = CATALOGUE,
): { code: ProblemCode; detail: string } {
  const owners = catalogue.featuresOfPermission(permission);
  const effective = owners.filter((f) => access.features[f]);
  if (effective.length === 0) {
    return { code: 'feature_not_entitled', detail: 'Your company’s plan does not include this' };
  }
  if (!allowedByTenantStatus(access.status, access.isOwner, permission)) {
    return { code: 'tenant_read_only', detail: readOnlyDetail(access.status) };
  }
  if (access.granted.includes(permission)) {
    return {
      code: 'feature_not_entitled',
      detail: 'This feature is read-only for your company now',
    };
  }
  return { code: 'permission_denied', detail: 'Your role does not allow this' };
}

export function readOnlyDetail(status: TenantStatus): string {
  switch (status) {
    case 'trial_expired':
      return 'The trial has ended: you can view and export; your Owner can subscribe';
    case 'suspended_read_only':
      return 'Your company’s account is read-only — contact your Owner';
    case 'suspended_locked':
      return 'Your company’s account is locked; only the Owner can sign in, to pay or export';
    case 'pending_termination':
      return 'Your company’s account is closing; only the Owner can export its data';
    default:
      return 'Your company’s account cannot be used now';
  }
}
