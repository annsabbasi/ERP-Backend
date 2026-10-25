// Building blocks of the module, feature and permission registry (Part 10 §10.7.1).
// Code is the source of truth; the catalogue sync copies it into platform.catalogue_*.

/** Standard actions (Part 11 §11.7.1). Anything else a feature needs is a special action. */
export const STANDARD_ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'submit',
  'approve',
  'reject',
  'post',
  'reverse',
  'cancel',
  'export',
  'import',
  'print',
  'send',
  'assign',
  'configure',
  'view_sensitive',
] as const;
export type StandardAction = (typeof STANDARD_ACTIONS)[number];

/** Which records a grant covers (Part 04 §4.9.3, Part 11 §11.8). Narrowest first. */
export const SCOPE_TYPES = [
  'own',
  'assigned',
  'team',
  'department',
  'branch',
  'legal_entity',
  'company',
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** Module categories (Part 02 §2.9.2). Core modules are always on. */
export const MODULE_CATEGORIES = ['core', 'business', 'industry', 'addon', 'localization'] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/** Availability (Part 02 §2.9.3). Nothing is generally available until its stage passes QA. */
export const STATUSES = ['ga', 'beta', 'preview', 'deprecated'] as const;
export type Status = (typeof STATUSES)[number];

/** Release wave from the module tables in Parts 06–08. */
export const RELEASES = ['R1', 'R2', 'R3', 'later'] as const;
export type Release = (typeof RELEASES)[number];

/** Limits the platform sets per tenant (Part 02 §2.11.1, Part 04 §4.15). */
export const LIMIT_KEYS = [
  'users.max',
  'branches.max',
  'devices.max',
  'devices.kiosks.max',
  'pos.terminals.max',
  'kds.screens.max',
  'restaurant.waiter_devices.max',
  'school.students.max',
  'payroll.employees.max',
  'storage.gb',
  'messaging.sms.monthly',
  'messaging.whatsapp.monthly',
  'api.calls.daily',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** A resource and what can be done with it. `special` holds feature-specific actions. */
export type ResourceInput = {
  actions: readonly StandardAction[];
  special?: readonly string[];
};

/** A navigation entry, revealed when the feature is entitled and the user holds `requires`. */
export type MenuEntry = {
  path: string;
  /** i18n key */
  label: string;
  requires: string;
};

export type FeatureInput = {
  name: string;
  release: Release;
  status?: Status;
  /** Feature keys that must be effective too (Part 02 §2.9.6). */
  requires?: readonly string[];
  /** At least one of these feature keys must be effective (for example restaurant.hub). */
  requiresAnyOf?: readonly string[];
  recommends?: readonly string[];
  /** Effective for every tenant, whatever its plan (core services and finance.core, §2.9.2). */
  alwaysOn?: boolean;
  conflicts?: readonly string[];
  limits?: readonly LimitKey[];
  /** Resources this feature unlocks, keyed by resource name inside the module. */
  resources?: Readonly<Record<string, ResourceInput>>;
  /** Scope types a grant on this feature's permissions may use. */
  scopes?: readonly ScopeType[];
  menu?: readonly MenuEntry[];
};

export type ModuleInput = {
  key: string;
  name: string;
  category: ModuleCategory;
  /** Navigation heading (Part 02 §2.9.1). */
  group: string;
  status?: Status;
  /** Feature keys every feature of this module requires (for example payroll.* → hr.core). */
  requires?: readonly string[];
  recommends?: readonly string[];
  features: Readonly<Record<string, FeatureInput>>;
};

export type FeatureDefinition = {
  key: string;
  module: string;
  name: string;
  release: Release;
  status: Status;
  alwaysOn: boolean;
  requires: readonly string[];
  requiresAnyOf: readonly string[];
  recommends: readonly string[];
  conflicts: readonly string[];
  limits: readonly LimitKey[];
  scopes: readonly ScopeType[];
  /** Permission keys module.resource.action this feature unlocks. */
  permissions: readonly string[];
  menu: readonly MenuEntry[];
};

export type ModuleDefinition = {
  key: string;
  name: string;
  category: ModuleCategory;
  group: string;
  status: Status;
  features: readonly FeatureDefinition[];
};

const ALL_SCOPES: readonly ScopeType[] = SCOPE_TYPES;

/** Shorthand for a resource: `actions(['view', 'create'], { special: ['post'] })`. */
export function actions(
  standard: readonly StandardAction[],
  options: { special?: readonly string[] } = {},
): ResourceInput {
  return { actions: standard, special: options.special };
}

/** Identity helper so feature literals are type-checked where they are written. */
export function feature(input: FeatureInput): FeatureInput {
  return input;
}

/** Turns a module literal into its definition: feature keys and permission keys filled in. */
export function defineModule(input: ModuleInput): ModuleDefinition {
  const moduleStatus = input.status ?? 'preview';
  const features = Object.entries(input.features).map(([name, f]): FeatureDefinition => {
    const permissions: string[] = [];
    for (const [resource, r] of Object.entries(f.resources ?? {})) {
      for (const action of [...r.actions, ...(r.special ?? [])]) {
        permissions.push(`${input.key}.${resource}.${action}`);
      }
    }
    return {
      key: `${input.key}.${name}`,
      module: input.key,
      name: f.name,
      release: f.release,
      status: f.status ?? moduleStatus,
      alwaysOn: f.alwaysOn ?? input.category === 'core',
      requires: [...new Set([...(input.requires ?? []), ...(f.requires ?? [])])],
      requiresAnyOf: f.requiresAnyOf ?? [],
      recommends: [...new Set([...(input.recommends ?? []), ...(f.recommends ?? [])])],
      conflicts: f.conflicts ?? [],
      limits: f.limits ?? [],
      scopes: f.scopes ?? ALL_SCOPES,
      permissions,
      menu: f.menu ?? [],
    };
  });
  return {
    key: input.key,
    name: input.name,
    category: input.category,
    group: input.group,
    status: moduleStatus,
    features,
  };
}
