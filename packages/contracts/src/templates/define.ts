import { z } from 'zod';
import { CATALOGUE, LIMIT_KEYS, SCOPE_TYPES, type Catalogue, type ScopeType } from '../registry';

// Industry templates (Part 02 §2.10, Part 03 §3.11): a recipe that sets a company up in one
// step — entitlements, default limits, terminology, role templates, settings defaults and
// set-up wizard steps. The console edits them as data; every version is checked against the
// registry, so no role template can hold a permission its template does not entitle.

/** Concepts whose labels a terminology pack renames (Part 02 §2.14). */
export const TERM_CONCEPTS = [
  'branch',
  'customer',
  'sales_invoice',
  'item',
  'employee',
  'department',
  'appointment',
] as const;

/** Set-up wizard steps (Part 04 §4.3.1 common, §4.3.2 per industry). */
export const WIZARD_STEPS = [
  'welcome',
  'company_profile',
  'localization',
  'organization',
  'finance_basics',
  'industry_setup',
  'team',
  'review',
  'service_modes',
  'floors_tables',
  'menu',
  'kitchen_stations',
  'devices_printers',
  'taxes_fiscal',
  'payment_methods',
  'service_charge_tips',
  'academic_year',
  'grade_levels',
  'subjects',
  'fee_structure',
  'challan_settings',
  'admission_settings',
  'attendance_mode',
  'grading_scale',
  'parent_portal',
] as const;

export const TEMPLATE_STATUSES = ['draft', 'in_review', 'published', 'deprecated'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

const Name = z.string().min(1);
const KEY = /^[a-z][a-z0-9_]*$/;
export const SEMVER = /^\d+\.\d+\.\d+$/;

export const RoleTemplateSchema = z.object({
  key: z.string().regex(KEY),
  name: Name,
  description: z.string(),
  /** The protected Owner role: holds everything the company is entitled to, no grants listed. */
  owner: z.boolean().optional(),
  grants: z.array(
    z.object({
      permission: z.string(),
      scope: z.enum(SCOPE_TYPES),
      thresholds: z.record(z.string(), z.number()).optional(),
    }),
  ),
});
export type RoleTemplate = z.infer<typeof RoleTemplateSchema>;

export const TemplateDefinitionSchema = z.object({
  key: z.string().regex(KEY),
  version: z.string().regex(SEMVER),
  name: Name,
  industry: z.string().regex(KEY),
  description: z.string(),
  entitlements: z.array(z.string()),
  limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(0)),
  terminology: z.partialRecord(z.enum(TERM_CONCEPTS), Name),
  roles: z.array(RoleTemplateSchema),
  settings: z.record(z.string(), z.unknown()),
  wizard: z.array(z.enum(WIZARD_STEPS)),
});
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;

/** The features a template's company ends up with: its entitlements plus the always-on core. */
export function templateFeatures(
  definition: Pick<TemplateDefinition, 'entitlements'>,
  catalogue: Catalogue = CATALOGUE,
): Set<string> {
  return catalogue.effectiveFeatures(definition.entitlements);
}

/**
 * Everything wrong with a template; empty when it can be published. Checks keys against the
 * registry, that every entitlement's hard requirements are entitled too, and that every role
 * grant is unlocked by an entitled feature and uses a scope that feature allows.
 */
export function templateProblems(
  definition: TemplateDefinition,
  catalogue: Catalogue = CATALOGUE,
): string[] {
  const problems: string[] = [];
  const effective = templateFeatures(definition, catalogue);
  for (const key of definition.entitlements) {
    const feature = catalogue.getFeature(key);
    if (!feature) problems.push(`entitlement ${key} is not in the registry`);
    else if (!effective.has(key)) {
      const missing = feature.requires.filter((r) => !effective.has(r));
      problems.push(
        `entitlement ${key} needs ${missing.join(', ') || feature.requiresAnyOf.join(' or ')}`,
      );
    }
  }
  const keys = new Set<string>();
  const owners = definition.roles.filter((r) => r.owner);
  if (owners.length !== 1 || owners[0]!.key !== 'owner') {
    problems.push('exactly one role must be the Owner, with the key "owner"');
  }
  for (const role of definition.roles) {
    if (keys.has(role.key)) problems.push(`role ${role.key} appears twice`);
    keys.add(role.key);
    if (role.owner && role.grants.length) problems.push('the Owner role lists no grants');
    const seen = new Set<string>();
    for (const grant of role.grants) {
      if (seen.has(grant.permission))
        problems.push(`role ${role.key} grants ${grant.permission} twice`);
      seen.add(grant.permission);
      const owning = catalogue.featuresOfPermission(grant.permission);
      if (owning.length === 0) {
        problems.push(`role ${role.key}: ${grant.permission} is not in the registry`);
        continue;
      }
      const entitled = owning.filter((f) => effective.has(f));
      if (entitled.length === 0) {
        problems.push(
          `role ${role.key}: ${grant.permission} needs ${owning.join(' or ')}, which the template does not entitle`,
        );
        continue;
      }
      const scopes = new Set(entitled.flatMap((f) => catalogue.getFeature(f)!.scopes));
      if (!scopes.has(grant.scope)) {
        problems.push(`role ${role.key}: ${grant.permission} cannot have ${grant.scope} scope`);
      }
    }
  }
  return problems;
}

// ── Writing templates: role specs expanded against the registry ─────────────────────────────

/** [resource, actions or '*', scope, thresholds?]; resource is "module.resource" or "module.*". */
export type GrantSpec = [string, readonly string[] | '*', ScopeType, Record<string, number>?];

export type RoleSpec = Omit<RoleTemplate, 'grants'> & { specs: readonly GrantSpec[] };

export function role(
  key: string,
  name: string,
  description: string,
  specs: readonly GrantSpec[],
): RoleSpec {
  return { key, name, description, specs };
}

/**
 * A template from role specs: each spec becomes the permission keys it names, kept only where
 * an entitled feature unlocks the permission and allows the scope. Writing roles this way keeps
 * them right when the registry grows; the stored definition lists every grant explicitly.
 */
export function buildTemplate(
  input: Omit<TemplateDefinition, 'roles'> & { roles: readonly RoleSpec[] },
  catalogue: Catalogue = CATALOGUE,
): TemplateDefinition {
  const effective = templateFeatures(input, catalogue);
  const roles = input.roles.map(({ specs, ...rest }): RoleTemplate => {
    const grants = new Map<string, RoleTemplate['grants'][number]>();
    for (const [resource, actions, scope, thresholds] of specs) {
      const [module, name] = resource.split('.');
      for (const permission of catalogue.permissionKeys) {
        const [m, r, a] = permission.split('.');
        if (m !== module || (name !== '*' && r !== name)) continue;
        if (actions !== '*' && !actions.includes(a!)) continue;
        const entitled = catalogue.featuresOfPermission(permission).filter((f) => effective.has(f));
        if (!entitled.some((f) => catalogue.getFeature(f)!.scopes.includes(scope))) continue;
        grants.set(permission, { permission, scope, ...(thresholds ? { thresholds } : {}) });
      }
    }
    return {
      ...rest,
      grants: [...grants.values()].sort((x, y) => x.permission.localeCompare(y.permission)),
    };
  });
  return { ...input, roles };
}

/** What changed between two versions of a template, for the console's diff (§3.11). */
export function templateDiff(
  before: TemplateDefinition,
  after: TemplateDefinition,
): {
  entitlements: { added: string[]; removed: string[] };
  limits: { key: string; before: number | null; after: number | null }[];
  roles: {
    added: string[];
    removed: string[];
    changed: { key: string; added: string[]; removed: string[] }[];
  };
  terminology: string[];
  settings: string[];
  wizard: boolean;
} {
  const diffSets = (a: Iterable<string>, b: Iterable<string>) => {
    const A = new Set(a);
    const B = new Set(b);
    return {
      added: [...B].filter((x) => !A.has(x)).sort(),
      removed: [...A].filter((x) => !B.has(x)).sort(),
    };
  };
  const grantKey = (g: RoleTemplate['grants'][number]) =>
    `${g.permission} (${g.scope}${g.thresholds ? ` ${JSON.stringify(g.thresholds)}` : ''})`;
  const rolesBefore = new Map(before.roles.map((r) => [r.key, r]));
  const rolesAfter = new Map(after.roles.map((r) => [r.key, r]));
  const roleKeys = diffSets(rolesBefore.keys(), rolesAfter.keys());
  const changed = [...rolesAfter.keys()]
    .filter((k) => rolesBefore.has(k))
    .map((k) => ({
      key: k,
      ...diffSets(
        rolesBefore.get(k)!.grants.map(grantKey),
        rolesAfter.get(k)!.grants.map(grantKey),
      ),
    }))
    .filter((c) => c.added.length || c.removed.length);
  const limitKeys = [
    ...new Set([...Object.keys(before.limits), ...Object.keys(after.limits)]),
  ].sort();
  const limit = (d: TemplateDefinition, k: string) =>
    (d.limits as Record<string, number>)[k] ?? null;
  const changedKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .sort();
  return {
    entitlements: diffSets(before.entitlements, after.entitlements),
    limits: limitKeys
      .map((key) => ({ key, before: limit(before, key), after: limit(after, key) }))
      .filter((l) => l.before !== l.after),
    roles: { ...roleKeys, changed },
    terminology: changedKeys(before.terminology, after.terminology),
    settings: changedKeys(before.settings, after.settings),
    wizard: JSON.stringify(before.wizard) !== JSON.stringify(after.wizard),
  };
}
