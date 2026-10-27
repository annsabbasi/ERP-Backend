import { describe, expect, it } from 'vitest';
import {
  allowedByFeatureState,
  allowedByTenantStatus,
  canAccess,
  canEnterTenant,
  grantCovers,
  MeAccessSchema,
  TENANT_STATUSES,
  type Grant,
  type MeAccess,
  type TenantStatus,
} from './access';

const ME = 'm-self';

describe('tenant status (Part 03 §3.7.2)', () => {
  // status → [who may enter: member, owner], then what a member and the Owner may do.
  const table: Record<
    TenantStatus,
    { enter: [boolean, boolean]; member: string[]; owner: string[] }
  > = {
    provisioning: { enter: [false, false], member: [], owner: [] },
    trial: {
      enter: [true, true],
      member: ['view', 'create', 'export', 'billing'],
      owner: ['view', 'create', 'export', 'billing'],
    },
    active: {
      enter: [true, true],
      member: ['view', 'create', 'export', 'billing'],
      owner: ['view', 'create', 'export', 'billing'],
    },
    past_due: {
      enter: [true, true],
      member: ['view', 'create', 'export', 'billing'],
      owner: ['view', 'create', 'export', 'billing'],
    },
    trial_expired: {
      enter: [true, true],
      member: ['view', 'export'],
      owner: ['view', 'export', 'billing'],
    },
    suspended_read_only: {
      enter: [true, true],
      member: ['view', 'export'],
      owner: ['view', 'export'],
    },
    suspended_locked: { enter: [false, true], member: [], owner: ['export', 'billing'] },
    pending_termination: { enter: [false, true], member: [], owner: ['export'] },
    terminated: { enter: [false, false], member: [], owner: [] },
  };
  const probes: Record<string, string> = {
    view: 'sales.invoices.view',
    create: 'sales.invoices.create',
    export: 'sales.invoices.export',
    billing: 'core.billing.configure',
  };

  it('covers every status', () => {
    expect(Object.keys(table).sort()).toEqual([...TENANT_STATUSES].sort());
  });

  it.each(TENANT_STATUSES)('%s', (status) => {
    const row = table[status];
    expect([canEnterTenant(status, false), canEnterTenant(status, true)]).toEqual(row.enter);
    for (const [who, isOwner] of [
      ['member', false],
      ['owner', true],
    ] as const) {
      const allowed = Object.entries(probes)
        .filter(([, key]) => allowedByTenantStatus(status, isOwner, key))
        .map(([name]) => name);
      expect([who, allowed]).toEqual([who, row[who]]);
    }
  });

  it('lets the Owner export everything of a closing company, and nothing else', () => {
    expect(allowedByTenantStatus('pending_termination', true, 'core.data.export')).toBe(true);
    expect(allowedByTenantStatus('pending_termination', true, 'core.billing.view')).toBe(false);
  });
});

describe('feature states', () => {
  it('keeps view, sensitive view and export in a read-only window', () => {
    expect(allowedByFeatureState('read_only', 'school.students.view')).toBe(true);
    expect(allowedByFeatureState('read_only', 'school.students.view_sensitive')).toBe(true);
    expect(allowedByFeatureState('read_only', 'school.students.export')).toBe(true);
    expect(allowedByFeatureState('read_only', 'school.students.update')).toBe(false);
    expect(allowedByFeatureState('on', 'school.students.update')).toBe(true);
  });
});

describe('grantCovers (Part 11 §11.8)', () => {
  const grant = (scope: Grant['scope'], values: Grant['values'] = {}): Grant => ({
    scope,
    values,
    thresholds: {},
  });

  it('company covers everything; own covers what I created or what is about me', () => {
    expect(grantCovers(grant('company'), {}, ME)).toBe(true);
    expect(grantCovers(grant('own'), { created_by: ME }, ME)).toBe(true);
    expect(grantCovers(grant('own'), { membership_id: ME }, ME)).toBe(true);
    expect(grantCovers(grant('own'), { created_by: 'someone' }, ME)).toBe(false);
    expect(grantCovers(grant('own'), {}, ME)).toBe(false);
  });

  it('branch, department and legal entity compare the record’s id with the grant’s ids', () => {
    const branch = grant('branch', { branch_ids: ['b1', 'b2'] });
    expect(grantCovers(branch, { branch_id: 'b2' }, ME)).toBe(true);
    expect(grantCovers(branch, { branch_id: 'b3' }, ME)).toBe(false);
    expect(grantCovers(branch, { branch_id: null }, ME)).toBe(false);
    const dept = grant('department', { department_ids: ['d1'] });
    expect(grantCovers(dept, { department_id: 'd1' }, ME)).toBe(true);
    expect(grantCovers(dept, { branch_id: 'b1' }, ME)).toBe(false);
    const entity = grant('legal_entity', { legal_entity_ids: ['e1'] });
    expect(grantCovers(entity, { legal_entity_id: 'e1' }, ME)).toBe(true);
  });

  it('assigned compares each assignment kind; team compares the record’s owner', () => {
    const assigned = grant('assigned', { section_ids: ['hall-a', 'terrace'] });
    expect(grantCovers(assigned, { assigned: { section_ids: 'terrace' } }, ME)).toBe(true);
    expect(grantCovers(assigned, { assigned: { section_ids: 'bar' } }, ME)).toBe(false);
    expect(grantCovers(assigned, { assigned: { class_ids: 'terrace' } }, ME)).toBe(false);
    const team = grant('team', { member_ids: [ME, 'm-2'] });
    expect(grantCovers(team, { created_by: 'm-2' }, ME)).toBe(true);
    expect(grantCovers(team, { created_by: 'm-9' }, ME)).toBe(false);
  });
});

describe('canAccess', () => {
  const access: MeAccess = MeAccessSchema.parse({
    tenant: { id: 't', code: 'T-AAAAAA', status: 'active' },
    membership_id: ME,
    is_owner: false,
    pv: 3,
    valid_until: null,
    features: [{ key: 'restaurant.waiter_app', state: 'on' }],
    permissions: {
      'restaurant.orders.create': [
        { scope: 'assigned', values: { section_ids: ['hall-a'] }, thresholds: {} },
      ],
      'restaurant.orders.view': [
        { scope: 'assigned', values: { section_ids: ['hall-a'] }, thresholds: {} },
        { scope: 'own', values: {}, thresholds: {} },
      ],
    },
    menu: [],
    home: 'home',
    quick_create: [],
  });

  it('refuses keys it does not list, and checks records against any grant', () => {
    expect(canAccess(access, 'restaurant.orders.create')).toBe(true);
    expect(canAccess(access, 'restaurant.payments.create')).toBe(false);
    expect(
      canAccess(access, 'restaurant.orders.create', { assigned: { section_ids: 'hall-a' } }),
    ).toBe(true);
    expect(
      canAccess(access, 'restaurant.orders.create', { assigned: { section_ids: 'terrace' } }),
    ).toBe(false);
    expect(
      canAccess(access, 'restaurant.orders.view', {
        assigned: { section_ids: 'terrace' },
        created_by: ME,
      }),
    ).toBe(true);
  });
});
