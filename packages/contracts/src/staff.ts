import { z } from 'zod';

// Platform staff: roles, the permission matrix of Part 03 §3.2.1 and the console's menu. The
// API checks these permissions on every console route (@StaffPermission); the console uses the
// same answer to draw its sidebar.

/** Staff roles (Part 03 §3.2), as seeded in platform.staff_roles. */
export const STAFF_ROLES = [
  'platform_owner',
  'platform_admin',
  'onboarding_specialist',
  'billing_manager',
  'support_agent',
  'operations',
  'auditor',
] as const;
export type StaffRoleKey = (typeof STAFF_ROLES)[number];

/** At most two Platform Owners (§3.2). */
export const MAX_PLATFORM_OWNERS = 2;

/** Staff permissions: the rows of the §3.2.1 matrix, named like Part 11 §11.10.3. */
export const STAFF_PERMISSIONS = [
  'dashboard.view',
  'tenants.view',
  'requests.view',
  'requests.manage',
  'requests.decide',
  'tenants.provision',
  'tenants.provision_enterprise',
  'tenants.update',
  'entitlements.manage',
  'entitlements.plan_change',
  'tenants.lifecycle',
  'tenants.terminate',
  'billing.view',
  'billing.manage',
  'billing.refund',
  'catalogue.view',
  'catalogue.edit',
  'catalogue.draft',
  'catalogue.publish',
  'catalogue.prices',
  'country_packs.view',
  'country_packs.edit',
  'country_packs.publish',
  'support.sessions',
  'break_glass',
  'communications.view',
  'communications.manage',
  'ops.view',
  'ops.manage',
  'staff.view',
  'staff.manage',
  'approvals.view',
  'audit.view',
  'audit.view_own',
  'audit.view_billing',
  'audit.view_ops',
  'audit.export',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/** ● allowed outright · ◐ allowed only after a second eligible staff member approves. */
export type StaffGrantMode = 'allow' | 'four_eyes';

const A = 'allow' as const;
const F = 'four_eyes' as const;
type Row = Partial<Record<StaffRoleKey, StaffGrantMode>>;
const all = (mode: StaffGrantMode = A): Row =>
  Object.fromEntries(STAFF_ROLES.map((r) => [r, mode])) as Row;

/**
 * Part 03 §3.2.1, row by row. Two choices go beyond the table: publishing a template or a
 * country pack always needs a second approver, the Owner's included (§3.11 "Publishing requires
 * a second approver"; AC-P10); and audit visibility is split into all / own / billing / ops.
 */
export const STAFF_MATRIX: Readonly<Record<StaffPermission, Row>> = {
  'dashboard.view': all(),
  'tenants.view': all(),
  'requests.view': {
    platform_owner: A,
    platform_admin: A,
    onboarding_specialist: A,
    support_agent: A,
    auditor: A,
  },
  'requests.manage': { platform_owner: A, platform_admin: A, onboarding_specialist: A },
  'requests.decide': { platform_owner: A, platform_admin: A, onboarding_specialist: A },
  'tenants.provision': { platform_owner: A, platform_admin: A, onboarding_specialist: A },
  'tenants.provision_enterprise': {
    platform_owner: A,
    platform_admin: F,
    onboarding_specialist: F,
  },
  'tenants.update': { platform_owner: A, platform_admin: A, onboarding_specialist: A },
  'entitlements.manage': { platform_owner: A, platform_admin: A, onboarding_specialist: F },
  'entitlements.plan_change': { platform_owner: A, platform_admin: A, billing_manager: A },
  'tenants.lifecycle': { platform_owner: A, platform_admin: A, billing_manager: A },
  'tenants.terminate': { platform_owner: A, platform_admin: F, billing_manager: F },
  'billing.view': {
    platform_owner: A,
    platform_admin: A,
    onboarding_specialist: A,
    billing_manager: A,
    auditor: A,
  },
  'billing.manage': { platform_owner: A, billing_manager: A },
  'billing.refund': { platform_owner: A, billing_manager: F },
  'catalogue.view': { platform_owner: A, platform_admin: A, onboarding_specialist: A, auditor: A },
  'catalogue.edit': { platform_owner: A, platform_admin: A },
  'catalogue.draft': { platform_owner: A, platform_admin: A, onboarding_specialist: A },
  'catalogue.publish': { platform_owner: F, platform_admin: F },
  'catalogue.prices': { platform_owner: A, platform_admin: A, billing_manager: F },
  'country_packs.view': { platform_owner: A, platform_admin: A, auditor: A },
  'country_packs.edit': { platform_owner: A, platform_admin: A },
  'country_packs.publish': { platform_owner: F, platform_admin: F },
  'support.sessions': {
    platform_owner: A,
    platform_admin: A,
    onboarding_specialist: A,
    support_agent: A,
  },
  break_glass: { platform_owner: F },
  'communications.view': { platform_owner: A, platform_admin: A, auditor: A },
  'communications.manage': { platform_owner: A, platform_admin: A },
  'ops.view': { platform_owner: A, platform_admin: A, support_agent: A, operations: A, auditor: A },
  'ops.manage': { platform_owner: A, operations: A },
  'staff.view': { platform_owner: A, auditor: A },
  'staff.manage': { platform_owner: A },
  'approvals.view': { platform_owner: A, platform_admin: A, billing_manager: A, auditor: A },
  'audit.view': { platform_owner: A, platform_admin: A, auditor: A },
  'audit.view_own': { onboarding_specialist: A, support_agent: A },
  'audit.view_billing': { billing_manager: A },
  'audit.view_ops': { operations: A },
  'audit.export': { platform_owner: A, auditor: A },
};

/** A staff member's permissions: the strongest mode any of their roles gives. */
export function staffPermissionsOf(
  roles: readonly string[],
): Partial<Record<StaffPermission, StaffGrantMode>> {
  const out: Partial<Record<StaffPermission, StaffGrantMode>> = {};
  for (const permission of STAFF_PERMISSIONS) {
    for (const role of roles) {
      const mode = STAFF_MATRIX[permission][role as StaffRoleKey];
      if (mode === A || (mode === F && out[permission] !== A)) out[permission] = mode;
    }
  }
  return out;
}

/**
 * The console's sidebar (Part 03 §3.3.2): an entry shows when the member holds any of its
 * permissions. Only screens that exist are listed; the rest arrive with their stages.
 */
export const CONSOLE_MENU: readonly {
  group: string;
  entries: readonly { path: string; label: string; anyOf: readonly StaffPermission[] }[];
}[] = [
  { group: 'main', entries: [{ path: '/', label: 'console.nav.home', anyOf: ['dashboard.view'] }] },
  {
    group: 'catalogue',
    entries: [
      { path: '/catalogue/modules', label: 'console.nav.modules', anyOf: ['catalogue.view'] },
      {
        path: '/catalogue/templates',
        label: 'console.nav.templates',
        anyOf: ['catalogue.view', 'catalogue.draft'],
      },
      {
        path: '/catalogue/plans',
        label: 'console.nav.plans',
        anyOf: ['catalogue.view', 'catalogue.prices'],
      },
      {
        path: '/catalogue/country-packs',
        label: 'console.nav.country_packs',
        anyOf: ['country_packs.view'],
      },
    ],
  },
  {
    group: 'governance',
    entries: [
      { path: '/approvals', label: 'console.nav.approvals', anyOf: ['approvals.view'] },
      {
        path: '/audit',
        label: 'console.nav.audit',
        anyOf: ['audit.view', 'audit.view_own', 'audit.view_billing', 'audit.view_ops'],
      },
      { path: '/staff', label: 'console.nav.staff', anyOf: ['staff.view'] },
    ],
  },
];

export const StaffAccessSchema = z.object({
  staff_id: z.string(),
  roles: z.array(z.enum(STAFF_ROLES)),
  permissions: z.partialRecord(z.enum(STAFF_PERMISSIONS), z.enum(['allow', 'four_eyes'])),
  menu: z.array(
    z.object({
      group: z.string(),
      entries: z.array(z.object({ path: z.string(), label: z.string() })),
    }),
  ),
  /** Items waiting for this person: approvals they may decide. */
  badges: z.record(z.string(), z.number().int()),
  /** When the last MFA check of this session happened (step-up), or null. */
  mfa_verified_at: z.string().nullable(),
});
export type StaffAccess = z.infer<typeof StaffAccessSchema>;

/** The console menu a staff member sees. */
export function consoleMenuOf(
  permissions: Partial<Record<StaffPermission, StaffGrantMode>>,
): StaffAccess['menu'] {
  return CONSOLE_MENU.map((g) => ({
    group: g.group,
    entries: g.entries
      .filter((e) => e.anyOf.some((p) => permissions[p]))
      .map(({ path, label }) => ({ path, label })),
  })).filter((g) => g.entries.length > 0);
}
