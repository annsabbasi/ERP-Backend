// Sensitive field groups (Part 04 §4.9.4). Without one of the permissions, the fields are
// hidden or masked in screens, exports and API responses.

export type SensitiveGroup = {
  key: string;
  name: string;
  /** Any of these permissions reveals the group, each within its own module's records. */
  permissions: readonly string[];
  withoutPermission: 'hidden' | 'masked';
};

export const SENSITIVE_GROUPS: readonly SensitiveGroup[] = [
  {
    key: 'compensation',
    name: 'Salaries, pay components and payslips of others',
    permissions: ['payroll.compensation.view_sensitive'],
    withoutPermission: 'hidden',
  },
  {
    key: 'identity_numbers',
    name: 'National ID (CNIC) and passport numbers',
    permissions: ['core.identity_numbers.view'],
    withoutPermission: 'masked',
  },
  {
    key: 'bank_details',
    name: 'Bank account numbers and IBANs',
    permissions: ['finance.bank_details.view'],
    withoutPermission: 'masked',
  },
  {
    key: 'medical',
    name: 'Medical notes of students and employees',
    permissions: ['hr.medical.view', 'school.medical.view'],
    withoutPermission: 'hidden',
  },
  {
    key: 'contacts',
    name: 'Guardian and guest contact details',
    permissions: ['school.guardians.contact_view', 'restaurant.guests.contact_view'],
    withoutPermission: 'masked',
  },
  {
    key: 'costs',
    name: 'Cost prices, margins and supplier prices',
    permissions: ['inventory.costs.view'],
    withoutPermission: 'hidden',
  },
];
