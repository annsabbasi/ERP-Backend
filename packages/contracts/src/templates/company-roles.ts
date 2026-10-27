import { role, type RoleSpec } from './define';

// The roles every company gets (Part 04 §4.9.9 "All companies"). Each template builds them
// against its own entitlements, so a role only holds what that template's company can use.
// Business modules gain resources in Phase 1; templates then get new versions.

export const OWNER: RoleSpec = {
  key: 'owner',
  name: { en: 'Owner', ur: 'مالک' },
  description: 'The company’s owner: everything the company is entitled to (Part 04 §4.1).',
  owner: true,
  specs: [],
};

const ORG = ['legal_entities', 'branches', 'departments', 'teams', 'positions', 'cost_centres'];
const ADMIN_TOOLS = [
  'join_links',
  'join_requests',
  'roles',
  'sessions',
  'devices',
  'parties',
  'files',
  'comments',
  'tasks',
  'notifications',
  'notification_rules',
  'workflows',
  'approvals',
  'numbering_series',
  'document_templates',
  'reports',
  'dashboards',
  'integrations',
  'api_keys',
  'webhooks',
];

export const COMPANY_ADMIN = role(
  'company_admin',
  'Company Admin',
  'کمپنی ایڈمن',
  'Users, roles, organization, workflows, settings, devices and integrations; not billing, ownership or closing the account (Part 04 §4.1).',
  [
    ['core.company', ['view', 'configure'], 'company'],
    ['core.settings', '*', 'company'],
    ['core.plan', ['view', 'request'], 'company'],
    [
      'core.members',
      [
        'view',
        'update',
        'export',
        'invite',
        'suspend',
        'reactivate',
        'deactivate',
        'send_reset',
        'require_mfa',
        'sign_out_all',
      ],
      'company',
    ],
    ['core.security_policy', ['view'], 'company'],
    ['core.support_grants', ['view'], 'company'],
    ['core.audit', ['view'], 'company'],
    ['core.data', ['import'], 'company'],
    ...ORG.map((r): [string, '*', 'company'] => [`core.${r}`, '*', 'company']),
    ...ADMIN_TOOLS.map((r): [string, '*', 'company'] => [`core.${r}`, '*', 'company']),
  ],
);

export const FINANCE_MANAGER = role(
  'finance_manager',
  'Finance Manager',
  'فنانس مینیجر',
  'Books, payments and period close; approves and posts payroll prepared by the Payroll Officer.',
  [
    ['finance.journal_entries', '*', 'company'],
    ['finance.periods', '*', 'company'],
    ['finance.payments', '*', 'company'],
    ['finance.bank_details', ['view'], 'company'],
    ['sales.invoices', ['view', 'export'], 'company'],
    ['inventory.costs', ['view'], 'company'],
    ['payroll.runs', ['view', 'approve', 'post'], 'company'],
    ['core.approvals', ['view', 'approve', 'reject'], 'company'],
    ['core.reports', ['view', 'export'], 'company'],
    ['core.dashboards', ['view'], 'company'],
    ['core.parties', ['view'], 'company'],
  ],
);

export const ACCOUNTANT = role(
  'accountant',
  'Accountant',
  'اکاؤنٹنٹ',
  'Day-to-day entries, receipts and payments; submits for approval, does not close periods.',
  [
    ['finance.journal_entries', ['view', 'create', 'update', 'submit', 'export'], 'company'],
    ['finance.periods', ['view'], 'company'],
    ['finance.payments', ['view', 'create'], 'company'],
    ['sales.invoices', ['view', 'create', 'update', 'post', 'print', 'send', 'export'], 'company'],
    ['core.parties', ['view', 'create', 'update'], 'company'],
    ['core.reports', ['view', 'export'], 'company'],
  ],
);

export const HR_MANAGER = role(
  'hr_manager',
  'HR Manager',
  'ایچ آر مینیجر',
  'Employees, leave and attendance of their own department(s); no salaries (Part 02 §2.12.3).',
  [
    ['hr.employees', ['view', 'create', 'update', 'export'], 'department'],
    ['leave.applications', ['view', 'approve', 'cancel'], 'department'],
    ['core.approvals', ['view', 'approve', 'reject'], 'department'],
    ['core.reports', ['view'], 'department'],
  ],
);

export const HR_OFFICER = role(
  'hr_officer',
  'HR Officer',
  'ایچ آر آفیسر',
  'Adds and updates employee records and follows leave.',
  [
    ['hr.employees', ['view', 'create', 'update'], 'company'],
    ['leave.applications', ['view'], 'company'],
  ],
);

export const PAYROLL_OFFICER = role(
  'payroll_officer',
  'Payroll Officer',
  'پے رول آفیسر',
  'Prepares payroll runs and bank files; the Finance Manager approves and posts them.',
  [
    ['payroll.runs', ['view', 'create', 'generate', 'bank_file'], 'company'],
    ['payroll.compensation', ['view_sensitive'], 'company'],
    ['hr.employees', ['view'], 'company'],
  ],
);

export const EMPLOYEE = role(
  'employee',
  'Employee (self-service)',
  'ملازم (سیلف سروس)',
  'Their own leave, tasks, meetings and notifications.',
  [
    ['leave.applications', ['view', 'create', 'cancel'], 'own'],
    ['meetings.meetings', ['view'], 'own'],
    ['core.tasks', ['view', 'update'], 'own'],
    ['core.notifications', ['view'], 'own'],
  ],
);

export const AUDITOR = role(
  'auditor',
  'Auditor (read-only)',
  'آڈیٹر (صرف دیکھنا)',
  'Reads the books, reports and the audit log; changes nothing.',
  [
    ['finance.*', ['view', 'export'], 'company'],
    ['sales.*', ['view', 'export'], 'company'],
    ['core.audit', ['view', 'export'], 'company'],
    ['core.reports', ['view', 'export'], 'company'],
    ['core.parties', ['view'], 'company'],
  ],
);

export const COMPANY_ROLES: readonly RoleSpec[] = [
  OWNER,
  COMPANY_ADMIN,
  FINANCE_MANAGER,
  ACCOUNTANT,
  HR_MANAGER,
  HR_OFFICER,
  PAYROLL_OFFICER,
  EMPLOYEE,
  AUDITOR,
];
