import type { FeatureDefinition, ModuleDefinition } from './define';
import { addon, localization } from './modules/addons-localization';
import {
  announcements,
  documents,
  fleet,
  helpdesk,
  meetings,
  projects,
} from './modules/collaboration';
import { core } from './modules/core';
import {
  analytics,
  finance,
  inventory,
  maintenance,
  manufacturing,
  pos,
  purchasing,
  sales,
} from './modules/finance-operations';
import { clinic, distribution, realestate, retail } from './modules/industry-other';
import {
  attendance,
  ess,
  expenses,
  hr,
  leave,
  payroll,
  performance,
  recruitment,
} from './modules/people';
import { restaurant } from './modules/restaurant';
import { school } from './modules/school';
import { SENSITIVE_GROUPS, type SensitiveGroup } from './sensitive';

const FEATURE_KEY = /^[a-z][a-z0-9_]*\.[a-z0-9_]+(\.[a-z0-9_]+)?$/;
const PERMISSION_KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type Catalogue = {
  modules: readonly ModuleDefinition[];
  features: readonly FeatureDefinition[];
  /** Every permission key module.resource.action, sorted. */
  permissionKeys: readonly string[];
  getFeature(key: string): FeatureDefinition | undefined;
  getModule(key: string): ModuleDefinition | undefined;
  /**
   * The features that unlock a permission. A permission is entitled when any of them is
   * effective (gate 1, Part 02 §2.12): orders, for example, belong to both the waiter app
   * and the cashier.
   */
  featuresOfPermission(permission: string): readonly string[];
  /**
   * Effective features from the features a tenant is given (Part 02 §2.11): the given ones
   * plus every always-on feature, minus any whose hard requirements are not effective,
   * repeated until nothing more drops out.
   */
  effectiveFeatures(given: Iterable<string>): Set<string>;
  /** Everything wrong with the catalogue; empty when it is consistent. */
  problems(): string[];
};

export function buildCatalogue(
  modules: readonly ModuleDefinition[],
  sensitiveGroups: readonly SensitiveGroup[] = [],
): Catalogue {
  const features = modules.flatMap((m) => m.features);
  const featuresByKey = new Map(features.map((f) => [f.key, f]));
  const owners = new Map<string, string[]>();
  for (const f of features) {
    for (const p of f.permissions) {
      const list = owners.get(p) ?? [];
      if (!list.includes(f.key)) list.push(f.key);
      owners.set(p, list);
    }
  }

  const effectiveFeatures = (given: Iterable<string>): Set<string> => {
    const effective = new Set<string>();
    for (const key of given) if (featuresByKey.has(key)) effective.add(key);
    for (const f of features) if (f.alwaysOn) effective.add(f.key);
    let changed = true;
    while (changed) {
      changed = false;
      for (const key of [...effective]) {
        const f = featuresByKey.get(key)!;
        const missing = f.requires.some((r) => !effective.has(r));
        const noneOf = f.requiresAnyOf.length > 0 && !f.requiresAnyOf.some((r) => effective.has(r));
        if (missing || noneOf) {
          effective.delete(key);
          changed = true;
        }
      }
    }
    return effective;
  };

  const cycles = (): string[][] => {
    const found: string[][] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    const visit = (key: string) => {
      if (state.get(key) === 'done') return;
      if (state.get(key) === 'visiting') {
        found.push([...stack.slice(stack.indexOf(key)), key]);
        return;
      }
      state.set(key, 'visiting');
      stack.push(key);
      const f = featuresByKey.get(key);
      for (const next of [...(f?.requires ?? []), ...(f?.requiresAnyOf ?? [])]) visit(next);
      stack.pop();
      state.set(key, 'done');
    };
    for (const f of features) visit(f.key);
    return found;
  };

  const problems = (): string[] => {
    const list: string[] = [];
    const seenModules = new Set<string>();
    for (const m of modules) {
      if (seenModules.has(m.key)) list.push(`duplicate module key ${m.key}`);
      seenModules.add(m.key);
    }
    const seenFeatures = new Set<string>();
    for (const f of features) {
      if (seenFeatures.has(f.key)) list.push(`duplicate feature key ${f.key}`);
      seenFeatures.add(f.key);
      if (!FEATURE_KEY.test(f.key)) list.push(`malformed feature key ${f.key}`);
      for (const p of f.permissions) {
        if (!PERMISSION_KEY.test(p)) list.push(`malformed permission key ${p} in ${f.key}`);
      }
      if (new Set(f.permissions).size !== f.permissions.length) {
        list.push(`${f.key} declares a permission twice`);
      }
      for (const t of [...f.requires, ...f.requiresAnyOf, ...f.recommends, ...f.conflicts]) {
        if (!featuresByKey.has(t)) list.push(`${f.key} refers to unknown feature ${t}`);
        if (t === f.key) list.push(`${f.key} refers to itself`);
      }
      if (f.alwaysOn) {
        for (const r of [...f.requires, ...f.requiresAnyOf]) {
          if (featuresByKey.get(r)?.alwaysOn === false) {
            list.push(`always-on ${f.key} requires ${r}, which is not always on`);
          }
        }
      }
      for (const entry of f.menu) {
        if (!f.permissions.includes(entry.requires)) {
          list.push(
            `${f.key} menu ${entry.path} requires ${entry.requires}, not one of its permissions`,
          );
        }
      }
    }
    const paths = features.flatMap((f) => f.menu.map((m) => m.path));
    for (const path of new Set(paths)) {
      if (paths.filter((p) => p === path).length > 1) list.push(`menu path ${path} used twice`);
    }
    for (const cycle of cycles()) list.push(`dependency cycle ${cycle.join(' → ')}`);
    for (const group of sensitiveGroups) {
      for (const p of group.permissions) {
        if (!owners.has(p)) list.push(`sensitive group ${group.key} uses unknown ${p}`);
      }
    }
    return list;
  };

  return {
    modules,
    features,
    permissionKeys: [...owners.keys()].sort(),
    getFeature: (key) => featuresByKey.get(key),
    getModule: (key) => modules.find((m) => m.key === key),
    featuresOfPermission: (permission) => owners.get(permission) ?? [],
    effectiveFeatures,
    problems,
  };
}

/** The product catalogue, in navigation order. */
export const CATALOGUE: Catalogue = buildCatalogue(
  [
    core,
    finance,
    sales,
    purchasing,
    inventory,
    pos,
    manufacturing,
    maintenance,
    analytics,
    hr,
    attendance,
    leave,
    payroll,
    recruitment,
    performance,
    expenses,
    ess,
    meetings,
    projects,
    helpdesk,
    documents,
    fleet,
    announcements,
    restaurant,
    school,
    realestate,
    retail,
    distribution,
    clinic,
    addon,
    localization,
  ],
  SENSITIVE_GROUPS,
);

export const MODULES = CATALOGUE.modules;
export const FEATURES = CATALOGUE.features;
export const PERMISSION_KEYS = CATALOGUE.permissionKeys;
export const getFeature = CATALOGUE.getFeature;
export const getModule = CATALOGUE.getModule;
export const featuresOfPermission = CATALOGUE.featuresOfPermission;
export const effectiveFeatures = CATALOGUE.effectiveFeatures;
