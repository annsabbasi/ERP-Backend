import { describe, expect, it } from 'vitest';
import { countryPackProblems, CountryPackDataSchema, PAKISTAN_1_0 } from './country-packs';
import { CATALOGUE } from './registry';
import {
  consoleMenuOf,
  STAFF_MATRIX,
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  staffPermissionsOf,
  type StaffRoleKey,
} from './staff';
import {
  RESTAURANT_CAFE,
  SCHOOL_K12,
  SHIPPED_TEMPLATES,
  TemplateDefinitionSchema,
  templateDiff,
  templateProblems,
  type TemplateDefinition,
} from './templates';

describe('staff permissions (Part 03 §3.2.1)', () => {
  it('lists every permission once, for known roles only', () => {
    expect(Object.keys(STAFF_MATRIX).sort()).toEqual([...STAFF_PERMISSIONS].sort());
    for (const row of Object.values(STAFF_MATRIX)) {
      for (const role of Object.keys(row)) expect(STAFF_ROLES).toContain(role);
    }
  });

  it('keeps the matrix’s key cells', () => {
    const of = (role: StaffRoleKey) => staffPermissionsOf([role]);
    expect(of('platform_owner')['staff.manage']).toBe('allow');
    expect(of('platform_admin')['staff.manage']).toBeUndefined();
    expect(of('platform_admin')['catalogue.publish']).toBe('four_eyes');
    expect(of('onboarding_specialist')['catalogue.draft']).toBe('allow');
    expect(of('onboarding_specialist')['catalogue.publish']).toBeUndefined();
    expect(of('onboarding_specialist')['entitlements.manage']).toBe('four_eyes');
    expect(of('billing_manager')['catalogue.prices']).toBe('four_eyes');
    expect(of('auditor')['audit.export']).toBe('allow');
    expect(of('auditor')['catalogue.edit']).toBeUndefined();
    expect(of('operations')['ops.manage']).toBe('allow');
    expect(of('support_agent')['audit.view_own']).toBe('allow');
  });

  it('takes the strongest mode when someone holds two roles', () => {
    const both = staffPermissionsOf(['onboarding_specialist', 'platform_admin']);
    expect(both['entitlements.manage']).toBe('allow');
  });

  it('gives each staff role its own sidebar', () => {
    const sidebar = (role: StaffRoleKey) =>
      consoleMenuOf(staffPermissionsOf([role])).flatMap((g) => g.entries.map((e) => e.path));
    const menus = Object.fromEntries(STAFF_ROLES.map((r) => [r, sidebar(r)]));
    expect(menus).toEqual({
      platform_owner: [
        '/',
        '/catalogue/modules',
        '/catalogue/templates',
        '/catalogue/plans',
        '/catalogue/country-packs',
        '/approvals',
        '/audit',
        '/staff',
      ],
      platform_admin: [
        '/',
        '/catalogue/modules',
        '/catalogue/templates',
        '/catalogue/plans',
        '/catalogue/country-packs',
        '/approvals',
        '/audit',
      ],
      onboarding_specialist: [
        '/',
        '/catalogue/modules',
        '/catalogue/templates',
        '/catalogue/plans',
        '/audit',
      ],
      billing_manager: ['/', '/catalogue/plans', '/approvals', '/audit'],
      support_agent: ['/', '/audit'],
      operations: ['/', '/audit'],
      auditor: [
        '/',
        '/catalogue/modules',
        '/catalogue/templates',
        '/catalogue/plans',
        '/catalogue/country-packs',
        '/approvals',
        '/audit',
        '/staff',
      ],
    });
  });
});

describe('the shipped industry templates (Part 02 §2.10)', () => {
  it.each(SHIPPED_TEMPLATES.map((t) => [t.key, t] as const))(
    '%s 1.0.0 is valid',
    (_key, template) => {
      expect(TemplateDefinitionSchema.parse(template)).toEqual(template);
      expect(templateProblems(template)).toEqual([]);
      expect(template.roles.find((r) => r.owner)?.key).toBe('owner');
      for (const role of template.roles.filter((r) => !r.owner)) {
        expect([role.key, role.grants.length > 0]).toEqual([role.key, true]);
      }
    },
  );

  const grantsOf = (template: TemplateDefinition, roleKey: string) =>
    Object.fromEntries(
      template.roles.find((r) => r.key === roleKey)!.grants.map((g) => [g.permission, g.scope]),
    );

  it('gives the restaurant roles of Part 08 §8.2.18', () => {
    const waiter = grantsOf(RESTAURANT_CAFE, 'waiter');
    expect(waiter['restaurant.orders.send_to_kitchen']).toBe('assigned');
    expect(waiter['restaurant.bills.request']).toBe('assigned');
    expect(waiter['restaurant.payments.create']).toBeUndefined();
    expect(waiter['restaurant.discounts.create']).toBeUndefined();
    const cashier = RESTAURANT_CAFE.roles.find((r) => r.key === 'cashier')!;
    expect(cashier.grants.find((g) => g.permission === 'restaurant.discounts.create')).toEqual({
      permission: 'restaurant.discounts.create',
      scope: 'branch',
      thresholds: { max_discount_pct: 10 },
    });
    expect(grantsOf(RESTAURANT_CAFE, 'cashier')['pos.shifts.close']).toBe('own');
    expect(grantsOf(RESTAURANT_CAFE, 'kitchen_staff')['restaurant.kds_tickets.bump']).toBe(
      'assigned',
    );
    // Delivery is Release 2: nothing of it is entitled, so no role holds it.
    const all = RESTAURANT_CAFE.roles.flatMap((r) => r.grants.map((g) => g.permission));
    expect(all.some((p) => p.startsWith('restaurant.deliveries.'))).toBe(false);
  });

  it('gives the school roles of Part 08 §8.3.17', () => {
    const teacher = grantsOf(SCHOOL_K12, 'teacher');
    expect(teacher['school.attendance.mark']).toBe('assigned');
    expect(teacher['school.marks.enter']).toBe('assigned');
    expect(teacher['school.challans.view']).toBeUndefined();
    expect(grantsOf(SCHOOL_K12, 'principal')['school.concessions.approve']).toBe('branch');
    expect(grantsOf(SCHOOL_K12, 'fee_officer')['school.payments.reconcile']).toBe('branch');
    expect(grantsOf(SCHOOL_K12, 'exam_controller')['school.marks.lock']).toBe('branch');
  });

  it('keeps every role inside its template: no restaurant permission in a school', () => {
    const all = SCHOOL_K12.roles.flatMap((r) => r.grants.map((g) => g.permission));
    expect(all.some((p) => p.startsWith('restaurant.'))).toBe(false);
    expect(all.length).toBeGreaterThan(100);
  });
});

describe('templateProblems refuses what cannot be published', () => {
  const base = (): TemplateDefinition => structuredClone(RESTAURANT_CAFE);

  it('a role template holding a feature its template does not entitle', () => {
    const t = base();
    t.roles
      .find((r) => r.key === 'waiter')!
      .grants.push({
        permission: 'school.attendance.mark',
        scope: 'assigned',
      });
    expect(templateProblems(t)).toEqual([
      'role waiter: school.attendance.mark needs school.attendance, which the template does not entitle',
    ]);
  });

  it('an entitlement without its hard requirements, a scope the feature does not allow, a second Owner', () => {
    const t = base();
    t.entitlements = t.entitlements.filter((f) => f !== 'restaurant.floor');
    t.roles
      .find((r) => r.key === 'cashier')!
      .grants.push({
        permission: 'restaurant.menu_items.view',
        scope: 'own',
      });
    t.roles.push({
      key: 'owner',
      name: 'Owner 2',
      description: '',
      owner: true,
      grants: [],
    });
    const problems = templateProblems(t);
    expect(problems).toContain('entitlement restaurant.waiter_app needs restaurant.floor');
    expect(problems).toContain('role cashier: restaurant.menu_items.view cannot have own scope');
    expect(problems).toContain('exactly one role must be the Owner, with the key "owner"');
    expect(problems.some((p) => p.includes('restaurant.tables.view needs restaurant.floor'))).toBe(
      true,
    );
  });

  it('keys the registry does not know', () => {
    const t = base();
    t.entitlements.push('restaurant.teleport');
    expect(templateProblems(t)).toContain('entitlement restaurant.teleport is not in the registry');
  });
});

describe('templateDiff', () => {
  it('lists added entitlements, changed limits and role grants', () => {
    const next = structuredClone(RESTAURANT_CAFE);
    next.version = '1.1.0';
    next.entitlements.push('restaurant.reservations');
    next.limits['users.max'] = 25;
    next.roles
      .find((r) => r.key === 'host')!
      .grants.push({
        permission: 'restaurant.reservations.view',
        scope: 'branch',
      });
    const diff = templateDiff(RESTAURANT_CAFE, next);
    expect(diff.entitlements).toEqual({ added: ['restaurant.reservations'], removed: [] });
    expect(diff.limits).toEqual([{ key: 'users.max', before: 15, after: 25 }]);
    expect(diff.roles.changed).toEqual([
      { key: 'host', added: ['restaurant.reservations.view (branch)'], removed: [] },
    ]);
    expect(templateProblems(next)).toEqual([]);
    expect(CATALOGUE.getFeature('restaurant.reservations')).toBeDefined();
  });
});

describe('Pakistan country pack 1.0', () => {
  it('is valid, its id formats accept their examples, and moon-dependent holidays are tentative', () => {
    expect(CountryPackDataSchema.parse(PAKISTAN_1_0.data)).toEqual(PAKISTAN_1_0.data);
    expect(countryPackProblems(PAKISTAN_1_0.data)).toEqual([]);
    const eid = PAKISTAN_1_0.data.holidays.filter((h) => h.name.startsWith('Eid'));
    expect(eid.every((h) => h.tentative)).toBe(true);
    expect(PAKISTAN_1_0.data.holidays.find((h) => h.date === '2026-08-14')?.tentative).toBe(false);
    expect(new RegExp(PAKISTAN_1_0.data.id_formats.cnic!.pattern).test('35202-123456-1')).toBe(
      false,
    );
  });
});
