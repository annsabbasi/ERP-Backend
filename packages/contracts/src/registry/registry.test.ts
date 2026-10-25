import { describe, expect, it } from 'vitest';
import {
  actions,
  buildCatalogue,
  CATALOGUE,
  defineModule,
  feature,
  SENSITIVE_GROUPS,
} from './index';

describe('the product catalogue', () => {
  it('has no problems: unique keys, known requirements, no cycles, menus behind own permissions', () => {
    expect(CATALOGUE.problems()).toEqual([]);
  });

  it('gives every permission at least one feature', () => {
    expect(CATALOGUE.permissionKeys.length).toBeGreaterThan(300);
    for (const key of CATALOGUE.permissionKeys) {
      expect(CATALOGUE.featuresOfPermission(key).length, key).toBeGreaterThan(0);
    }
  });

  it('registers the feature keys the specification names', () => {
    const named = [
      // Part 02 §2.9.4–2.9.6
      'restaurant.floor',
      'restaurant.menu',
      'restaurant.waiter_app',
      'restaurant.kds',
      'restaurant.cashier',
      'restaurant.reservations',
      'restaurant.delivery',
      'restaurant.recipes',
      'restaurant.qr_ordering',
      'restaurant.loyalty',
      'school.academics',
      'school.admissions',
      'school.sis',
      'school.attendance',
      'school.timetable',
      'school.exams',
      'school.fees',
      'school.lms',
      'school.portal',
      'school.transport',
      'school.library',
      'school.hostel',
      'pos.core',
      'finance.core',
      'inventory.stock',
      'purchasing.orders',
      'hr.core',
      'meetings.core',
      'pos.fiscalization',
      'localization.pk.onebill',
      // Part 06–08 samples
      'finance.receivables',
      'sales.crm',
      'inventory.valuation',
      'manufacturing.mrp',
      'payroll.runs',
      'recruitment.pipeline',
      'helpdesk.sla',
      'realestate.surcharge',
      'distribution.order_booking',
      'restaurant.hub',
      'school.comms',
      'core.org',
      'core.iam',
    ];
    for (const key of named) expect(CATALOGUE.getFeature(key), key).toBeDefined();
  });

  it('has the permissions of the worked examples (Part 02 §2.12) and Part 11 §11.7.2', () => {
    const keys = [
      // the waiter, §2.12.1
      'restaurant.tables.view',
      'restaurant.orders.create',
      'restaurant.orders.update',
      'restaurant.orders.send_to_kitchen',
      'restaurant.bills.request',
      'restaurant.payments.create',
      // the teacher, §2.12.2
      'school.attendance.mark',
      'school.marks.enter',
      'school.students.view',
      'school.homework.create',
      // the HR manager, §2.12.3
      'hr.employees.view',
      'hr.employees.update',
      'hr.employees.view_sensitive',
      // §11.7.2
      'finance.journal_entries.post',
      'finance.periods.close',
      'finance.payments.release',
      'sales.invoices.send',
      'inventory.adjustments.approve',
      'pos.shifts.cash_movement',
      'restaurant.kds_tickets.bump',
      'restaurant.menu_items.mark_unavailable',
      'restaurant.bills.refund',
      'school.marks.lock',
      'school.results.publish',
      'school.challans.generate',
      'school.concessions.approve',
      'leave.applications.approve',
      'payroll.runs.bank_file',
      'payroll.compensation.view_sensitive',
      'recruitment.candidates.move_stage',
      'meetings.meetings.view_confidential',
      'core.members.invite',
      'core.roles.delete',
    ];
    for (const key of keys) expect(CATALOGUE.featuresOfPermission(key), key).not.toEqual([]);
  });

  it('lets orders come from the waiter app or the cashier', () => {
    expect(CATALOGUE.featuresOfPermission('restaurant.orders.create')).toEqual(
      expect.arrayContaining(['restaurant.waiter_app', 'restaurant.cashier']),
    );
  });

  it('knows every sensitive-group permission (Part 04 §4.9.4)', () => {
    for (const group of SENSITIVE_GROUPS) {
      for (const p of group.permissions)
        expect(CATALOGUE.featuresOfPermission(p), p).not.toEqual([]);
    }
  });

  it('puts every menu path once, behind a permission of its own feature', () => {
    const paths = CATALOGUE.features.flatMap((f) => f.menu.map((m) => m.path));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('/settings/users');
    expect(paths).toContain('/restaurant/waiter');
    expect(paths).toContain('/school/fees');
  });
});

describe('effective features (Part 02 §2.11)', () => {
  const effective = (...given: string[]) => CATALOGUE.effectiveFeatures(given);

  it('always includes core services and finance.core', () => {
    const set = effective();
    expect(set.has('core.iam')).toBe(true);
    expect(set.has('core.org')).toBe(true);
    expect(set.has('finance.core')).toBe(true);
    expect(set.has('core.custom_fields')).toBe(false);
  });

  it('drops a feature whose hard requirement is missing (§2.9.6: recipes need inventory)', () => {
    expect(effective('pos.core', 'restaurant.recipes').has('restaurant.recipes')).toBe(false);
    expect(
      effective('pos.core', 'inventory.stock', 'restaurant.recipes').has('restaurant.recipes'),
    ).toBe(true);
  });

  it('drops dependants in a chain until nothing changes', () => {
    // Without pos.core the floor drops, and the waiter app needs the floor.
    const set = effective('restaurant.floor', 'restaurant.menu', 'restaurant.waiter_app');
    expect([...set].filter((k) => k.startsWith('restaurant.'))).toEqual([]);
  });

  it('needs one of the either-or requirements (restaurant.hub)', () => {
    const base = ['pos.core', 'restaurant.menu', 'restaurant.hub'];
    expect(effective(...base).has('restaurant.hub')).toBe(false);
    expect(effective(...base, 'restaurant.kds').has('restaurant.hub')).toBe(true);
  });

  it('ignores unknown keys', () => {
    expect(effective('school.quidditch').has('school.quidditch')).toBe(false);
  });

  it('gives a school no restaurant feature and the reverse', () => {
    const schoolSet = effective('school.academics', 'school.sis', 'school.fees');
    expect([...schoolSet].some((k) => k.startsWith('restaurant.'))).toBe(false);
    expect(schoolSet.has('school.fees')).toBe(true);
  });
});

describe('the catalogue checks', () => {
  const module = (features: Parameters<typeof defineModule>[0]['features']) =>
    defineModule({ key: 'demo', name: 'Demo', category: 'business', group: 'Demo', features });

  it('reports an unknown requirement', () => {
    const c = buildCatalogue([
      module({ a: feature({ name: 'A', release: 'R1', requires: ['demo.zzz'] }) }),
    ]);
    expect(c.problems()).toContain('demo.a refers to unknown feature demo.zzz');
  });

  it('reports a dependency cycle', () => {
    const c = buildCatalogue([
      module({
        a: feature({ name: 'A', release: 'R1', requires: ['demo.b'] }),
        b: feature({ name: 'B', release: 'R1', requires: ['demo.a'] }),
      }),
    ]);
    expect(c.problems().some((p) => p.startsWith('dependency cycle'))).toBe(true);
  });

  it('reports a duplicate module key', () => {
    const one = module({ a: feature({ name: 'A', release: 'R1' }) });
    expect(buildCatalogue([one, one]).problems()).toContain('duplicate module key demo');
  });

  it('reports a menu entry behind a permission of another feature', () => {
    const c = buildCatalogue([
      module({
        a: feature({ name: 'A', release: 'R1', resources: { things: actions(['view']) } }),
        b: feature({
          name: 'B',
          release: 'R1',
          menu: [{ path: '/demo', label: 'nav.demo', requires: 'demo.things.view' }],
        }),
      }),
    ]);
    expect(c.problems()).toContain(
      'demo.b menu /demo requires demo.things.view, not one of its permissions',
    );
  });

  it('reports an always-on feature that needs an optional one', () => {
    const c = buildCatalogue([
      defineModule({
        key: 'base',
        name: 'Base',
        category: 'core',
        group: 'Core',
        features: { a: feature({ name: 'A', release: 'R1', requires: ['demo.b'] }) },
      }),
      module({ b: feature({ name: 'B', release: 'R1' }) }),
    ]);
    expect(c.problems()).toContain('always-on base.a requires demo.b, which is not always on');
  });
});
