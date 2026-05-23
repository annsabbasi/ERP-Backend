/**
 * Canonical permission catalog.
 *
 * Permissions are platform-defined and identified by `resource.action`
 * (Section 5.3 of the master spec). The seed loads this catalog into the DB;
 * services resolve roles → permissions and embed `key:scope` strings in JWTs.
 *
 * CONVENTION
 *   resource = "<moduleSlug>" or "<moduleSlug>.<entity>" (e.g. "hr.employee")
 *   action   = lowercase verb (view | create | update | delete | manage | <custom>)
 *
 * ADDING A PERMISSION
 *   1. Append to MODULE_PERMISSIONS below.
 *   2. (optional) Reference it from a PermissionSet template in PERMISSION_SETS.
 *   3. Re-run prisma seed.
 *
 * The catalog is intentionally append-only: removing a key would orphan
 * RolePermissions in production tenants. If a permission is truly retired,
 * mark it deprecated in description rather than deleting.
 */

export type PermissionDef = {
  key: string;          // e.g. "hr.employee.create"
  resource: string;     // e.g. "hr.employee"
  action: string;       // e.g. "create"
  moduleSlug: string;   // e.g. "hr"
  description: string;
};

const STD = ['view', 'create', 'update', 'delete', 'manage'] as const;

/**
 * Generates the five standard CRUD-ish actions for a given resource.
 * Used as a default for every module so existing routes have a working key.
 */
function standardSet(moduleSlug: string, resource: string, label: string): PermissionDef[] {
  return STD.map((action) => ({
    key: `${resource}.${action}`,
    resource,
    action,
    moduleSlug,
    description: `${capitalize(action)} ${label}`,
  }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── MODULE-LEVEL PERMISSIONS ─────────────────────────────────────────────────
// Coarse keys that gate the whole module. Every existing controller route
// can be re-pointed at `<slug>.{view,create,update,delete,manage}`.
const MODULE_LEVEL: PermissionDef[] = [
  ...standardSet('administration', 'administration', 'platform & company administration'),
  ...standardSet('financials', 'financials', 'financial records & reports'),
  ...standardSet('hr', 'hr', 'HR records'),
  ...standardSet('hr-payroll', 'hr.payroll', 'payroll runs and payslips'),
  ...standardSet('hr-employee-records', 'hr.employee_records', 'employee master data'),
  ...standardSet('hr-attendance', 'hr.attendance', 'attendance and time tracking'),
  ...standardSet('hr-recruitment', 'hr.recruitment', 'hiring & recruitment'),
  ...standardSet('crm', 'crm', 'CRM contacts, accounts, leads, opportunities'),
  ...standardSet('purchasing', 'purchasing', 'purchase orders and procurement'),
  ...standardSet('inventory', 'inventory', 'stock and warehouses'),
  ...standardSet('banking', 'banking', 'bank accounts and payments'),
  ...standardSet('reports', 'reports', 'reports and dashboards'),
];

// ─── FINE-GRAINED PERMISSIONS ─────────────────────────────────────────────────
// Spec examples (Section 5.3) of fine-grained, per-resource permissions.
// Domain modules add to this list as they grow.
const FINE_GRAINED: PermissionDef[] = [
  // HR — employees, leaves, contracts
  { key: 'hr.employee.view',   resource: 'hr.employee', action: 'view',   moduleSlug: 'hr', description: 'View employee records' },
  { key: 'hr.employee.create', resource: 'hr.employee', action: 'create', moduleSlug: 'hr', description: 'Create employee records' },
  { key: 'hr.employee.update', resource: 'hr.employee', action: 'update', moduleSlug: 'hr', description: 'Update employee records' },
  { key: 'hr.employee.delete', resource: 'hr.employee', action: 'delete', moduleSlug: 'hr', description: 'Delete employee records' },
  { key: 'hr.leave.approve',   resource: 'hr.leave',    action: 'approve', moduleSlug: 'hr', description: 'Approve leave requests' },
  { key: 'hr.leave.submit',    resource: 'hr.leave',    action: 'submit',  moduleSlug: 'hr', description: 'Submit own leave requests' },

  // Finance — invoices, journals, period close
  { key: 'finance.invoice.view',    resource: 'finance.invoice', action: 'view',    moduleSlug: 'financials', description: 'View invoices' },
  { key: 'finance.invoice.create',  resource: 'finance.invoice', action: 'create',  moduleSlug: 'financials', description: 'Create invoices' },
  { key: 'finance.invoice.approve', resource: 'finance.invoice', action: 'approve', moduleSlug: 'financials', description: 'Approve invoices above threshold' },
  { key: 'finance.journal.post',    resource: 'finance.journal', action: 'post',    moduleSlug: 'financials', description: 'Post journal entries' },
  { key: 'finance.period.close',    resource: 'finance.period',  action: 'close',   moduleSlug: 'financials', description: 'Close fiscal periods' },

  // Inventory — stock movements, adjustments
  { key: 'inventory.stock.adjust',   resource: 'inventory.stock', action: 'adjust',   moduleSlug: 'inventory', description: 'Adjust stock with documented reason' },
  { key: 'inventory.stock.transfer', resource: 'inventory.stock', action: 'transfer', moduleSlug: 'inventory', description: 'Transfer stock between warehouses' },

  // Purchasing — PO approvals
  { key: 'purchasing.po.approve.small',  resource: 'purchasing.po', action: 'approve.small',  moduleSlug: 'purchasing', description: 'Approve small POs (department-level threshold)' },
  { key: 'purchasing.po.approve.medium', resource: 'purchasing.po', action: 'approve.medium', moduleSlug: 'purchasing', description: 'Approve medium POs (finance-level threshold)' },
  { key: 'purchasing.po.approve.large',  resource: 'purchasing.po', action: 'approve.large',  moduleSlug: 'purchasing', description: 'Approve large POs (executive-level threshold)' },

  // System / cross-cutting
  { key: 'system.audit.view', resource: 'system.audit', action: 'view',   moduleSlug: 'administration', description: 'View audit log' },
  { key: 'system.role.manage', resource: 'system.role', action: 'manage', moduleSlug: 'administration', description: 'Create, clone, edit, delete roles' },
  { key: 'system.permission_set.manage', resource: 'system.permission_set', action: 'manage', moduleSlug: 'administration', description: 'Create and edit permission sets' },

  // Tenancy & Subscription (Section 6.2)
  { key: 'tenancy.branch.view',   resource: 'tenancy.branch', action: 'view',   moduleSlug: 'administration', description: 'View company branches' },
  { key: 'tenancy.branch.create', resource: 'tenancy.branch', action: 'create', moduleSlug: 'administration', description: 'Create branches' },
  { key: 'tenancy.branch.update', resource: 'tenancy.branch', action: 'update', moduleSlug: 'administration', description: 'Update branches' },
  { key: 'tenancy.branch.delete', resource: 'tenancy.branch', action: 'delete', moduleSlug: 'administration', description: 'Delete branches' },
  { key: 'tenancy.branding.update', resource: 'tenancy.branding', action: 'update', moduleSlug: 'administration', description: 'Update company branding & terminology overrides' },
  { key: 'tenancy.module.activate', resource: 'tenancy.module', action: 'activate', moduleSlug: 'administration', description: 'Activate or deactivate modules subject to subscription' },

  // Subscription & Billing
  { key: 'billing.subscription.view',     resource: 'billing.subscription', action: 'view',     moduleSlug: 'administration', description: 'View subscription details' },
  { key: 'billing.subscription.manage',   resource: 'billing.subscription', action: 'manage',   moduleSlug: 'administration', description: 'Change plan, billing interval, suspend, reactivate' },
  { key: 'billing.invoice.view',          resource: 'billing.invoice',      action: 'view',     moduleSlug: 'administration', description: 'View billing invoices' },
  { key: 'billing.invoice.create',        resource: 'billing.invoice',      action: 'create',   moduleSlug: 'administration', description: 'Issue billing invoices' },
  { key: 'billing.invoice.record_payment', resource: 'billing.invoice',     action: 'record_payment', moduleSlug: 'administration', description: 'Record payments against billing invoices' },

  // HR sub-resources (Section 6.3)
  { key: 'hr.position.view',     resource: 'hr.position',     action: 'view',    moduleSlug: 'hr', description: 'View positions catalog' },
  { key: 'hr.position.manage',   resource: 'hr.position',     action: 'manage',  moduleSlug: 'hr', description: 'Create, edit, deactivate positions' },
  { key: 'hr.contract.view',     resource: 'hr.contract',     action: 'view',    moduleSlug: 'hr', description: 'View employment contracts' },
  { key: 'hr.contract.manage',   resource: 'hr.contract',     action: 'manage',  moduleSlug: 'hr', description: 'Create / update employment contracts' },
  { key: 'hr.employee.hire',     resource: 'hr.employee',     action: 'hire',    moduleSlug: 'hr', description: 'Hire new employees (full workforce flow)' },
  { key: 'hr.employee.terminate', resource: 'hr.employee',    action: 'terminate', moduleSlug: 'hr', description: 'Terminate or retire employees' },
  { key: 'hr.leave_type.manage', resource: 'hr.leave_type',   action: 'manage',  moduleSlug: 'hr-payroll', description: 'Configure leave types & accrual rules' },
  { key: 'hr.leave.manage_all',  resource: 'hr.leave',        action: 'manage_all', moduleSlug: 'hr', description: 'View & manage leave requests across all employees' },
  { key: 'hr.attendance.view_all', resource: 'hr.attendance', action: 'view_all', moduleSlug: 'hr-attendance', description: 'View attendance for all employees' },
  { key: 'hr.attendance.edit',   resource: 'hr.attendance',   action: 'edit',    moduleSlug: 'hr-attendance', description: 'Edit attendance entries (HR-only)' },
  { key: 'hr.shift.manage',      resource: 'hr.shift',        action: 'manage',  moduleSlug: 'hr-attendance', description: 'Manage shift catalog and assignments' },
  { key: 'hr.onboarding.manage', resource: 'hr.onboarding',   action: 'manage',  moduleSlug: 'hr', description: 'Manage onboarding templates and instances' },

  // Document Management (Section 6.9)
  { key: 'documents.view',   resource: 'documents', action: 'view',   moduleSlug: 'administration', description: 'View documents and folders' },
  { key: 'documents.create', resource: 'documents', action: 'create', moduleSlug: 'administration', description: 'Upload new documents and versions' },
  { key: 'documents.update', resource: 'documents', action: 'update', moduleSlug: 'administration', description: 'Rename, move, retag documents' },
  { key: 'documents.delete', resource: 'documents', action: 'delete', moduleSlug: 'administration', description: 'Soft-delete or restore documents' },
  { key: 'documents.share',  resource: 'documents', action: 'share',  moduleSlug: 'administration', description: 'Create and revoke external share links' },
  { key: 'folders.manage',   resource: 'folders',   action: 'manage', moduleSlug: 'administration', description: 'Create, rename, move, delete folders' },

  // Notifications & Webhooks (Section 6.10)
  { key: 'notifications.preferences.update', resource: 'notifications.preferences', action: 'update', moduleSlug: 'administration', description: 'Update own notification preferences (granted by default)' },
  { key: 'webhooks.endpoint.view',           resource: 'webhooks.endpoint',          action: 'view',   moduleSlug: 'administration', description: 'View webhook endpoints' },
  { key: 'webhooks.endpoint.manage',         resource: 'webhooks.endpoint',          action: 'manage', moduleSlug: 'administration', description: 'Create, edit, delete webhook endpoints' },
  { key: 'webhooks.delivery.view',           resource: 'webhooks.delivery',          action: 'view',   moduleSlug: 'administration', description: 'View webhook delivery history' },

  // Workflow Engine (Sections 6.10 + 9)
  { key: 'workflow.definition.view',    resource: 'workflow.definition',  action: 'view',    moduleSlug: 'administration', description: 'View workflow definitions' },
  { key: 'workflow.definition.manage',  resource: 'workflow.definition',  action: 'manage',  moduleSlug: 'administration', description: 'Create, clone, edit, delete workflow definitions' },
  { key: 'workflow.instance.view',      resource: 'workflow.instance',    action: 'view',    moduleSlug: 'administration', description: 'View workflow instances' },
  { key: 'workflow.instance.start',     resource: 'workflow.instance',    action: 'start',   moduleSlug: 'administration', description: 'Start workflow instances' },
  { key: 'workflow.instance.cancel',    resource: 'workflow.instance',    action: 'cancel',  moduleSlug: 'administration', description: 'Cancel running workflow instances' },

  // Audit & Compliance (Section 6.12)
  { key: 'system.audit.export',         resource: 'system.audit',         action: 'export',  moduleSlug: 'administration', description: 'Export audit-trail bundle for external auditors' },
  { key: 'system.retention.manage',     resource: 'system.retention',     action: 'manage',  moduleSlug: 'administration', description: 'Configure retention policies and trigger enforcement' },
  { key: 'system.privacy.export',       resource: 'system.privacy',       action: 'export',  moduleSlug: 'administration', description: 'Export a data subject\'s personal data (GDPR-style)' },
  { key: 'system.privacy.erase',        resource: 'system.privacy',       action: 'erase',   moduleSlug: 'administration', description: 'Erase / anonymize a data subject\'s personal data' },
];

export const PERMISSION_CATALOG: PermissionDef[] = [...MODULE_LEVEL, ...FINE_GRAINED];

// ─── SYSTEM PERMISSION SETS ───────────────────────────────────────────────────
// Per-module bundles modeled on the spec's "View-only / Standard / Power user
// / Manager" presets (Section 5.5 step 4). Custom company sets layer on top.

export type SystemSetDef = {
  key: string;          // e.g. "hr.viewer"
  name: string;
  description: string;
  permissionKeys: string[];
};

function presetForModule(moduleSlug: string, label: string): SystemSetDef[] {
  // Module-level resource keys — what the four presets bind to.
  const resource = MODULE_LEVEL.find((p) => p.moduleSlug === moduleSlug)?.resource;
  if (!resource) return [];
  return [
    {
      key: `${moduleSlug}.viewer`,
      name: `${label} — View only`,
      description: `Read-only access to ${label}`,
      permissionKeys: [`${resource}.view`],
    },
    {
      key: `${moduleSlug}.standard`,
      name: `${label} — Standard`,
      description: `View, create, and update in ${label}`,
      permissionKeys: [`${resource}.view`, `${resource}.create`, `${resource}.update`],
    },
    {
      key: `${moduleSlug}.power`,
      name: `${label} — Power user`,
      description: `Full CRUD on ${label}`,
      permissionKeys: [`${resource}.view`, `${resource}.create`, `${resource}.update`, `${resource}.delete`],
    },
    {
      key: `${moduleSlug}.manager`,
      name: `${label} — Manager`,
      description: `Full management of ${label} including settings`,
      permissionKeys: [`${resource}.view`, `${resource}.create`, `${resource}.update`, `${resource}.delete`, `${resource}.manage`],
    },
  ];
}

export const SYSTEM_PERMISSION_SETS: SystemSetDef[] = [
  ...presetForModule('administration', 'Administration'),
  ...presetForModule('financials', 'Financials'),
  ...presetForModule('hr', 'HR'),
  ...presetForModule('hr-payroll', 'HR Payroll'),
  ...presetForModule('hr-employee-records', 'HR Employee Records'),
  ...presetForModule('hr-attendance', 'HR Attendance'),
  ...presetForModule('hr-recruitment', 'HR Recruitment'),
  ...presetForModule('crm', 'CRM'),
  ...presetForModule('purchasing', 'Purchasing'),
  ...presetForModule('inventory', 'Inventory'),
  ...presetForModule('banking', 'Banking'),
  ...presetForModule('reports', 'Reports'),
];

// Wildcard recognized by the PermissionsGuard for super-admin short-circuit.
export const PERMISSION_WILDCARD = '*';
