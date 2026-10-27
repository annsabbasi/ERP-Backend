import { CATALOGUE } from '@erp/contracts';
import {
  computeAccess,
  effectiveFeatures,
  refusalOf,
  type AccessInput,
  type EntitlementRow,
} from '../src/modules/access/compute-access';

// The effective-set formula of Part 02 §2.11 and the grants of §2.12, without a database.

const NOW = new Date('2026-10-28T10:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function row(featureKey: string, extra: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    featureKey,
    state: 'on',
    source: 'template',
    validFrom: at(-30),
    validTo: null,
    ...extra,
  };
}

function input(extra: Partial<AccessInput> = {}): AccessInput {
  return {
    now: NOW,
    tenant: { id: 't1', code: 'T-AAAAAA', status: 'active', entitlementsVersion: 5 },
    membership: {
      id: 'me',
      permissionsVersion: 7,
      primaryBranchId: 'b-main',
      departmentId: 'd-kitchen',
      primaryLegalEntityId: 'le-1',
    },
    isOwner: false,
    entitlements: [],
    roleGrants: [],
    exceptions: [],
    departments: [],
    ledTeamMemberIds: [],
    ...extra,
  };
}

const WAITER_CHAIN = ['pos.core', 'restaurant.menu', 'restaurant.floor', 'restaurant.waiter_app'];

describe('effective features (§2.11)', () => {
  it('unites every allow source and keeps the always-on core', () => {
    const { features } = effectiveFeatures(
      [
        row('pos.core', { source: 'plan' }),
        row('inventory.stock', { source: 'addon' }),
        row('restaurant.menu', { source: 'manual' }),
        row('restaurant.floor', { source: 'trial', validTo: at(10) }),
      ],
      NOW,
    );
    for (const key of ['pos.core', 'inventory.stock', 'restaurant.menu', 'restaurant.floor']) {
      expect([key, features.get(key)]).toEqual([key, 'on']);
    }
    expect(features.get('core.iam')).toBe('on');
    expect(features.get('finance.core')).toBe('on');
    expect(features.has('school.sis')).toBe(false);
  });

  it('removes manual denies, but never the always-on core', () => {
    const { features } = effectiveFeatures(
      [
        row('inventory.stock'),
        row('inventory.stock', { source: 'manual', state: 'off' }),
        row('core.iam', { source: 'manual', state: 'off' }),
      ],
      NOW,
    );
    expect(features.has('inventory.stock')).toBe(false);
    expect(features.has('core.iam')).toBe(true);
  });

  it('drops a whole dependency chain when its root is missing', () => {
    const given = WAITER_CHAIN.map((k) => row(k));
    expect(effectiveFeatures(given, NOW).features.has('restaurant.waiter_app')).toBe(true);
    const withoutPos = given.filter((r) => r.featureKey !== 'pos.core');
    const { features } = effectiveFeatures(withoutPos, NOW);
    for (const key of WAITER_CHAIN) expect([key, features.has(key)]).toEqual([key, false]);
    const withoutFloor = given.filter((r) => r.featureKey !== 'restaurant.floor');
    const partial = effectiveFeatures(withoutFloor, NOW).features;
    expect([partial.has('restaurant.menu'), partial.has('restaurant.waiter_app')]).toEqual([
      true,
      false,
    ]);
  });

  it('makes dependants read-only when what they need is read-only', () => {
    const { features } = effectiveFeatures(
      [
        ...WAITER_CHAIN.map((k) => row(k)),
        row('restaurant.menu', { source: 'trial', state: 'read_only' }),
      ],
      NOW,
    );
    // Template gives the menu fully, so the trial's read-only row does not lower it.
    expect(features.get('restaurant.menu')).toBe('on');
    const onlyReadOnly = effectiveFeatures(
      [
        ...WAITER_CHAIN.filter((k) => k !== 'restaurant.menu').map((k) => row(k)),
        row('restaurant.menu', { state: 'read_only' }),
      ],
      NOW,
    ).features;
    expect(onlyReadOnly.get('restaurant.menu')).toBe('read_only');
    expect(onlyReadOnly.get('restaurant.waiter_app')).toBe('read_only');
    expect(onlyReadOnly.get('restaurant.floor')).toBe('on');
  });

  it('honours validity windows and reports when the set changes next', () => {
    const { features, changesAt } = effectiveFeatures(
      [
        row('inventory.stock', { validTo: at(-1) }), // ended yesterday
        row('pos.core', { validFrom: at(3) }), // starts in three days
        row('school.academics', { validTo: at(2) }), // ends in two days
      ],
      NOW,
    );
    expect(features.has('inventory.stock')).toBe(false);
    expect(features.has('pos.core')).toBe(false);
    expect(features.has('school.academics')).toBe(true);
    expect(changesAt).toEqual(at(2));
  });
});

describe('member access (§2.12)', () => {
  const restaurant = WAITER_CHAIN.map((k) => row(k));

  it('gives a role’s grants with resolved scopes, and pv = member + tenant versions', () => {
    const access = computeAccess(
      input({
        entitlements: restaurant,
        roleGrants: [
          {
            permissionKey: 'restaurant.orders.create',
            scopeType: 'assigned',
            thresholds: {},
            scopeValues: { section_ids: ['hall-a'] },
          },
          {
            permissionKey: 'restaurant.tables.view',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    expect(access.pv).toBe(12);
    expect(access.permissions['restaurant.orders.create']).toEqual([
      { scope: 'assigned', values: { section_ids: ['hall-a'] }, thresholds: {} },
    ]);
    // Branch scope with no branches chosen: the member's primary branch.
    expect(access.permissions['restaurant.tables.view']).toEqual([
      { scope: 'branch', values: { branch_ids: ['b-main'] }, thresholds: {} },
    ]);
  });

  it('keeps grants of features the company lacks dormant, and says so', () => {
    const access = computeAccess(
      input({
        entitlements: restaurant,
        roleGrants: [
          {
            permissionKey: 'school.students.view',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    expect(access.permissions['school.students.view']).toBeUndefined();
    expect(refusalOf(access, 'school.students.view').code).toBe('feature_not_entitled');
    expect(refusalOf(access, 'restaurant.orders.create').code).toBe('permission_denied');
  });

  it('drops grants whose scope type the feature does not allow (fail closed)', () => {
    const menuScopes = CATALOGUE.getFeature('restaurant.menu')!.scopes;
    expect(menuScopes).not.toContain('own');
    const access = computeAccess(
      input({
        entitlements: restaurant,
        roleGrants: [
          {
            permissionKey: 'restaurant.menu_items.update',
            scopeType: 'own',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    expect(access.permissions['restaurant.menu_items.update']).toBeUndefined();
  });

  it('covers sub-departments, and the members of teams the member leads', () => {
    const access = computeAccess(
      input({
        entitlements: [row('hr.core')],
        departments: [
          { id: 'd-kitchen', parentId: null },
          { id: 'd-pastry', parentId: 'd-kitchen' },
          { id: 'd-front', parentId: null },
        ],
        ledTeamMemberIds: ['m-2', 'm-3'],
        roleGrants: [
          {
            permissionKey: 'hr.employees.view',
            scopeType: 'department',
            thresholds: {},
            scopeValues: {},
          },
          {
            permissionKey: 'hr.employees.update',
            scopeType: 'team',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    expect(access.permissions['hr.employees.view']?.[0]?.values.department_ids?.sort()).toEqual([
      'd-kitchen',
      'd-pastry',
    ]);
    expect(access.permissions['hr.employees.update']?.[0]?.values.member_ids).toEqual([
      'me',
      'm-2',
      'm-3',
    ]);
  });

  it('applies exceptions until they end: allow adds, deny removes', () => {
    const access = computeAccess(
      input({
        entitlements: restaurant,
        roleGrants: [
          {
            permissionKey: 'restaurant.orders.create',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
          {
            permissionKey: 'restaurant.orders.update',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
        ],
        exceptions: [
          {
            permissionKey: 'restaurant.orders.transfer',
            effect: 'allow',
            scopeType: 'branch',
            scopeValues: {},
            expiresAt: at(1),
          },
          {
            permissionKey: 'restaurant.orders.update',
            effect: 'deny',
            scopeType: null,
            scopeValues: {},
            expiresAt: at(5),
          },
          {
            permissionKey: 'restaurant.orders.create',
            effect: 'deny',
            scopeType: null,
            scopeValues: {},
            expiresAt: at(-1),
          },
        ],
      }),
    );
    expect(Object.keys(access.permissions).sort()).toEqual([
      'restaurant.orders.create',
      'restaurant.orders.transfer',
    ]);
    expect(access.validUntil).toBe(at(1).toISOString());
  });

  it('gives the Owner every permission of every effective feature at company scope', () => {
    const access = computeAccess(
      input({
        isOwner: true,
        entitlements: restaurant,
        exceptions: [
          {
            permissionKey: 'core.members.invite',
            effect: 'deny',
            scopeType: null,
            scopeValues: {},
            expiresAt: at(5),
          },
        ],
      }),
    );
    expect(access.permissions['restaurant.orders.create']).toEqual([
      { scope: 'company', values: {}, thresholds: {} },
    ]);
    expect(access.permissions['core.members.invite']).toBeDefined();
    expect(access.permissions['school.students.view']).toBeUndefined();
  });

  it('keeps only view and export while the company is suspended (read-only)', () => {
    const access = computeAccess(
      input({
        tenant: {
          id: 't1',
          code: 'T-AAAAAA',
          status: 'suspended_read_only',
          entitlementsVersion: 6,
        },
        entitlements: restaurant,
        roleGrants: [
          {
            permissionKey: 'restaurant.orders.view',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
          {
            permissionKey: 'restaurant.orders.create',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    expect(Object.keys(access.permissions)).toEqual(['restaurant.orders.view']);
    expect(refusalOf(access, 'restaurant.orders.create').code).toBe('tenant_read_only');
  });

  it('lets only the Owner pay and export while the company is locked', () => {
    const locked = {
      id: 't1',
      code: 'T-AAAAAA',
      status: 'suspended_locked' as const,
      entitlementsVersion: 6,
    };
    const member = computeAccess(
      input({
        tenant: locked,
        entitlements: restaurant,
        roleGrants: [
          {
            permissionKey: 'restaurant.orders.view',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    expect(member.permissions).toEqual({});
    const owner = computeAccess(input({ tenant: locked, isOwner: true, entitlements: restaurant }));
    expect(
      Object.keys(owner.permissions).every(
        (k) => k.startsWith('core.billing.') || k.startsWith('core.plan.') || k.endsWith('.export'),
      ),
    ).toBe(true);
    expect(owner.permissions['core.billing.configure']).toBeDefined();
    expect(owner.permissions['core.data.export']).toBeDefined();
  });

  it('keeps view in a feature’s read-only window and refuses changes as not entitled', () => {
    const access = computeAccess(
      input({
        entitlements: [
          ...restaurant.filter((r) => r.featureKey !== 'restaurant.waiter_app'),
          row('restaurant.waiter_app', { source: 'trial', state: 'read_only' }),
        ],
        roleGrants: [
          {
            permissionKey: 'restaurant.voids.request',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
          {
            permissionKey: 'restaurant.orders.view',
            scopeType: 'branch',
            thresholds: {},
            scopeValues: {},
          },
        ],
      }),
    );
    // Orders belong to the cashier too, but the cashier is not entitled here.
    expect(access.permissions['restaurant.orders.view']).toBeDefined();
    expect(access.permissions['restaurant.voids.request']).toBeUndefined();
    expect(refusalOf(access, 'restaurant.voids.request')).toEqual({
      code: 'feature_not_entitled',
      detail: expect.stringMatching(/read-only/),
    });
  });
});
