import { PermissionScope } from '@prisma/client';
import type { IndustryTemplate } from './template.types';

/**
 * The fallback template — broadly applicable to any business.
 *
 * Activates the universal core (HR, Financials, CRM, Documents, Reports) and
 * seeds three roles: Company Admin (full), Manager (department-scoped power),
 * Employee (own-data viewer).
 */
export const GENERIC_TEMPLATE: IndustryTemplate = {
  key: 'generic',
  name: 'Generic Business',
  description: 'Universal core for any business; refine after onboarding.',
  version: 1,
  defaultModuleSlugs: [
    'administration',
    'financials',
    'hr',
    'hr-employee-records',
    'hr-attendance',
    'crm',
    'reports',
  ],
  defaultRoles: [
    {
      name: 'Company Admin',
      description: 'Full access within the company.',
      defaultScope: PermissionScope.ALL,
      permissionSetKeys: [
        'administration.manager',
        'financials.manager',
        'hr.manager',
        'hr-employee-records.manager',
        'hr-attendance.manager',
        'crm.manager',
        'reports.manager',
        'hr-payroll.manager',
        'financials.accountant',
      ],
    },
    {
      // HR prepares payroll; it cannot post it (no finance.journal.post).
      name: 'Payroll Officer',
      description: 'Prepares payroll: runs, attendance, adjustments, loans. Cannot post to the G/L.',
      defaultScope: PermissionScope.ALL,
      permissionSetKeys: ['hr-payroll.power', 'hr.viewer'],
    },
    {
      // Finance posts it: read-only Payroll plus the posting duty.
      name: 'Accountant',
      description: 'Posts journals and payroll runs and records payments; views payroll read-only.',
      defaultScope: PermissionScope.ALL,
      permissionSetKeys: ['financials.standard', 'financials.accountant'],
    },
    {
      name: 'Manager',
      description: 'Department-scoped management of HR and CRM data.',
      defaultScope: PermissionScope.DEPARTMENT,
      permissionSetKeys: ['hr.power', 'crm.power', 'reports.viewer'],
    },
    {
      name: 'Employee',
      description: 'Read own data; submit leave and view CRM contacts.',
      isDefault: true,
      defaultScope: PermissionScope.OWN,
      permissionSetKeys: ['hr.viewer', 'crm.viewer'],
    },
  ],
  profile: {
    currency: 'USD',
    locale: 'en-US',
    timezone: 'UTC',
    fiscalYearStart: 1,
  },
};
