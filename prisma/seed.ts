import {
  AccountDeterminationArea,
  AccountType,
  BillingInterval,
  PermissionScope,
  PrismaClient,
  SubscriptionStatus,
  UserRoleType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PERMISSION_CATALOG, SYSTEM_PERMISSION_SETS } from '../src/modules/permissions/permission-catalog';
import { SYSTEM_WORKFLOW_TEMPLATES } from '../src/modules/workflows/system-templates';
import { NUMBERED_DOCUMENT_TYPES } from '../src/modules/administration/numbering/numbering.service';

const prisma = new PrismaClient();

const SYSTEM_MODULES = [
  { name: 'Administration',       slug: 'administration',       description: 'User & system management',                  icon: 'Settings' },
  { name: 'Financials',           slug: 'financials',           description: 'Accounting & financial reports',             icon: 'DollarSign' },
  { name: 'HR',                   slug: 'hr',                   description: 'Human Resources core',                      icon: 'Users' },
  { name: 'HR Payroll',           slug: 'hr-payroll',           description: 'Payroll management',                        icon: 'CreditCard' },
  { name: 'HR Employee Records',  slug: 'hr-employee-records',  description: 'Employee master data & records',            icon: 'UserCheck' },
  { name: 'HR Attendance',        slug: 'hr-attendance',        description: 'Attendance & time tracking',                icon: 'Clock' },
  { name: 'HR Recruitment',       slug: 'hr-recruitment',       description: 'Hiring & recruitment workflows',            icon: 'UserPlus' },
  { name: 'CRM',                  slug: 'crm',                  description: 'Customer Relationship Management',          icon: 'Briefcase' },
  { name: 'Purchasing',           slug: 'purchasing',           description: 'Procurement & purchasing',                  icon: 'ShoppingCart' },
  { name: 'Inventory',            slug: 'inventory',            description: 'Stock & warehouse management',              icon: 'Package' },
  { name: 'Banking',              slug: 'banking',              description: 'Banking & payments',                        icon: 'Landmark' },
  { name: 'Reports',              slug: 'reports',              description: 'Business intelligence & reports',           icon: 'BarChart' },
];

const HR_MODULE_SLUGS = ['hr', 'hr-payroll', 'hr-employee-records', 'hr-attendance', 'hr-recruitment'];

async function main() {
  console.log('🌱 Seeding database...');

  // ── System Modules ─────────────────────────────────────────────────────────
  for (const mod of SYSTEM_MODULES) {
    await prisma.systemModule.upsert({
      where: { slug: mod.slug },
      update: {},
      create: mod,
    });
  }
  console.log(`✅ ${SYSTEM_MODULES.length} system modules seeded`);

  // ── Permission Catalog ─────────────────────────────────────────────────────
  for (const perm of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {
        resource: perm.resource,
        action: perm.action,
        moduleSlug: perm.moduleSlug,
        description: perm.description,
      },
      create: perm,
    });
  }
  console.log(`✅ ${PERMISSION_CATALOG.length} permissions seeded`);

  // ── System Permission Sets ─────────────────────────────────────────────────
  for (const set of SYSTEM_PERMISSION_SETS) {
    const existing = await prisma.permissionSet.findUnique({ where: { key: set.key } });
    const record = existing
      ? await prisma.permissionSet.update({
          where: { key: set.key },
          data: { name: set.name, description: set.description },
        })
      : await prisma.permissionSet.create({
          data: { key: set.key, name: set.name, description: set.description, isSystem: true, companyId: null },
        });

    // Refresh items idempotently — replace all.
    await prisma.permissionSetItem.deleteMany({ where: { setId: record.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: set.permissionKeys } } });
    if (perms.length) {
      await prisma.permissionSetItem.createMany({
        data: perms.map((p) => ({ setId: record.id, permissionId: p.id, scope: PermissionScope.ALL })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`✅ ${SYSTEM_PERMISSION_SETS.length} system permission sets seeded`);

  // ── Retention Policies (Section 13.5) ──────────────────────────────────────
  const RETENTION_DEFAULTS = [
    { dataClass: 'auth_event',     retentionDays: 365,       notes: '1 year of authentication events' },
    { dataClass: 'login_attempt',  retentionDays: 90,        notes: '90 days of login attempts' },
    { dataClass: 'activity_log',   retentionDays: 90,        notes: '90 days of high-volume activity' },
    { dataClass: 'audit_event',    retentionDays: 365 * 7,   notes: '7 years for compliance' },
  ];
  for (const r of RETENTION_DEFAULTS) {
    await prisma.retentionPolicy.upsert({
      where: { dataClass: r.dataClass },
      update: {},
      create: r,
    });
  }
  console.log(`✅ ${RETENTION_DEFAULTS.length} retention policies seeded`);

  // ── System Workflow Templates ──────────────────────────────────────────────
  for (const tpl of SYSTEM_WORKFLOW_TEMPLATES) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { companyId: null, isSystem: true, key: tpl.key, version: tpl.version },
    });
    if (existing) {
      await prisma.workflowDefinition.update({
        where: { id: existing.id },
        data: {
          name: tpl.name,
          description: tpl.description,
          entityType: tpl.entityType,
          steps: tpl.steps as any,
        },
      });
    } else {
      await prisma.workflowDefinition.create({
        data: {
          companyId: null,
          isSystem: true,
          key: tpl.key,
          name: tpl.name,
          description: tpl.description,
          entityType: tpl.entityType,
          version: tpl.version,
          steps: tpl.steps as any,
        },
      });
    }
  }
  console.log(`✅ ${SYSTEM_WORKFLOW_TEMPLATES.length} system workflow templates seeded`);

  // ── Super Admin ────────────────────────────────────────────────────────────
  const superAdminHash = await bcrypt.hash('admin123', 12);
  const superAdminExisting = await prisma.user.findFirst({
    where: { email: 'admin@erp.com', isSuperAdmin: true },
  });
  if (!superAdminExisting) {
    await prisma.user.create({
      data: {
        email: 'admin@erp.com',
        name: 'Super Admin',
        passwordHash: superAdminHash,
        companyId: null,
        isSuperAdmin: true,
        roleType: UserRoleType.SUPER_ADMIN,
      },
    });
  }
  console.log('✅ Super admin seeded  →  admin@erp.com / admin123');

  // ── Plans (subscription tiers — Section 4.2) ───────────────────────────────
  const ALL_SLUGS = SYSTEM_MODULES.map((m) => m.slug);
  const PLANS = [
    {
      key: 'starter',
      name: 'Starter',
      description: 'Core (HR, Finance, Reports). Up to 25 seats.',
      monthlyPrice: 49.00,
      annualPrice: 490.00,
      maxUsers: 25,
      sortOrder: 10,
      moduleSlugs: ['administration', 'financials', 'hr', 'hr-employee-records', 'reports'],
    },
    {
      key: 'business',
      name: 'Business',
      description: 'Core + 3 industry modules. Up to 100 seats.',
      monthlyPrice: 149.00,
      annualPrice: 1490.00,
      maxUsers: 100,
      sortOrder: 20,
      moduleSlugs: [
        'administration', 'financials', 'hr', 'hr-employee-records', 'hr-attendance',
        'crm', 'inventory', 'reports',
      ],
    },
    {
      key: 'premium',
      name: 'Premium',
      description: 'Core + all industry modules. Up to 500 seats.',
      monthlyPrice: 399.00,
      annualPrice: 3990.00,
      maxUsers: 500,
      sortOrder: 30,
      moduleSlugs: ALL_SLUGS,
    },
    {
      key: 'enterprise',
      name: 'Enterprise',
      description: 'All modules + custom roles, custom workflows, dedicated DB option. Unlimited seats.',
      monthlyPrice: null,
      annualPrice: null,
      maxUsers: null,
      sortOrder: 40,
      isPublic: false,
      moduleSlugs: ALL_SLUGS,
    },
  ] as const;

  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { key: p.key },
      update: {
        name: p.name,
        description: p.description,
        monthlyPrice: p.monthlyPrice,
        annualPrice: p.annualPrice,
        maxUsers: p.maxUsers,
        sortOrder: p.sortOrder,
        isPublic: (p as any).isPublic ?? true,
      },
      create: {
        key: p.key,
        name: p.name,
        description: p.description,
        monthlyPrice: p.monthlyPrice,
        annualPrice: p.annualPrice,
        maxUsers: p.maxUsers,
        sortOrder: p.sortOrder,
        isPublic: (p as any).isPublic ?? true,
      },
    });
    await prisma.planModule.deleteMany({ where: { planId: plan.id } });
    const planMods = await prisma.systemModule.findMany({ where: { slug: { in: p.moduleSlugs as any } } });
    if (planMods.length) {
      await prisma.planModule.createMany({
        data: planMods.map((m) => ({ planId: plan.id, moduleId: m.id })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`✅ ${PLANS.length} plans seeded`);

  // ── Demo Company ───────────────────────────────────────────────────────────
  const demoCompany = await prisma.company.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'ERP Demo Company',
      slug: 'demo',
      industry: 'generic',
      currency: 'USD',
      locale: 'en-US',
      timezone: 'UTC',
      fiscalYearStart: 1,
    },
  });
  console.log(`✅ Demo company seeded  →  slug: "demo"`);

  // Currency master. Every monetary column references this by (companyId,
  // code), so a company with an empty currency master cannot save an invoice
  // at all — this is required setup, not sample data.
  const CURRENCIES = [
    { code: 'USD', name: 'US Dollar',        hundredthName: 'Cents' },
    { code: 'EUR', name: 'Euro',             hundredthName: 'Cents' },
    { code: 'GBP', name: 'Pound Sterling',   hundredthName: 'Pence' },
    { code: 'PKR', name: 'Pakistani Rupee',  hundredthName: 'Paisa' },
    { code: 'AED', name: 'UAE Dirham',       hundredthName: 'Fils' },
    { code: 'SAR', name: 'Saudi Riyal',      hundredthName: 'Halala' },
    { code: 'INR', name: 'Indian Rupee',     hundredthName: 'Paise' },
    { code: 'CAD', name: 'Canadian Dollar',  hundredthName: 'Cents' },
    { code: 'AUD', name: 'Australian Dollar',hundredthName: 'Cents' },
    { code: 'JPY', name: 'Japanese Yen',     hundredthName: 'Sen' },
  ];
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { companyId_code: { companyId: demoCompany.id, code: c.code } },
      update: {},
      create: { companyId: demoCompany.id, ...c, decimals: 2 },
    });
  }
  console.log(`✅ ${CURRENCIES.length} currencies seeded`);

  // Starter chart of accounts and G/L account determination.
  //
  // A/R and A/P cannot post without these: the subledgers resolve their control,
  // revenue, expense, tax and cash accounts through the determination table
  // rather than hard-coding account codes, so a company that has none simply
  // cannot issue an invoice. Like the currency master, this is required setup
  // rather than sample data — a company is free to renumber or repoint any of
  // it afterwards.
  const ACCOUNTS = [
    { code: '1000', name: 'Cash on Hand',        type: AccountType.ASSET },
    { code: '1010', name: 'Bank Account',        type: AccountType.ASSET },
    { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET,     isControl: true },
    { code: '1200', name: 'Input Tax',           type: AccountType.ASSET },
    { code: '2000', name: 'Accounts Payable',    type: AccountType.LIABILITY, isControl: true },
    { code: '2100', name: 'Output Tax',          type: AccountType.LIABILITY },
    { code: '4000', name: 'Sales Revenue',       type: AccountType.INCOME },
    { code: '5000', name: 'Operating Expenses',  type: AccountType.EXPENSE },
  ];
  const accountsByCode = new Map<string, string>();
  for (const a of ACCOUNTS) {
    const row = await prisma.account.upsert({
      where: { companyId_code: { companyId: demoCompany.id, code: a.code } },
      // Only the flags the platform depends on are reconciled; a company that
      // renamed an account keeps its name.
      update: { isControl: a.isControl ?? false },
      create: { companyId: demoCompany.id, ...a },
    });
    accountsByCode.set(a.code, row.id);
  }

  const DETERMINATIONS = [
    { area: AccountDeterminationArea.SALES,      key: 'domestic_ar',     code: '1100' },
    { area: AccountDeterminationArea.SALES,      key: 'revenue',         code: '4000' },
    { area: AccountDeterminationArea.SALES,      key: 'tax_payable',     code: '2100' },
    { area: AccountDeterminationArea.PURCHASING, key: 'domestic_ap',     code: '2000' },
    { area: AccountDeterminationArea.PURCHASING, key: 'expense',         code: '5000' },
    { area: AccountDeterminationArea.PURCHASING, key: 'tax_receivable',  code: '1200' },
    { area: AccountDeterminationArea.GENERAL,    key: 'cash',            code: '1000' },
  ];
  for (const d of DETERMINATIONS) {
    const accountId = accountsByCode.get(d.code)!;
    await prisma.accountDetermination.upsert({
      where: { companyId_area_key: { companyId: demoCompany.id, area: d.area, key: d.key } },
      update: { accountId },
      create: { companyId: demoCompany.id, area: d.area, key: d.key, accountId },
    });
  }
  console.log(`✅ ${ACCOUNTS.length} G/L accounts and ${DETERMINATIONS.length} determinations seeded`);

  // A default numbering series per document type.
  //
  // Allocation is mandatory — a document with no series cannot be saved at all,
  // because its number is what the rest of the platform refers to it by. Every
  // type the platform can number gets a series here so no module is dead on
  // arrival; a company can rename the series, change the prefix or add its own
  // alongside, but it never starts from nothing.
  const SERIES_PREFIX: Record<string, string> = {
    journal_entry: 'JE-',      ar_invoice: 'INV-',       ar_credit_memo: 'CRD-',
    ar_down_payment: 'ADP-',   ap_bill: 'BILL-',         ap_credit_memo: 'PCR-',
    sales_order: 'SO-',        delivery: 'DLV-',         return: 'RET-',
    purchase_order: 'PO-',     purchase_request: 'PR-',  goods_receipt_po: 'GRPO-',
    incoming_payment: 'RCT-',  outgoing_payment: 'PAY-', activity: 'ACT-',
    opportunity: 'OPP-',       campaign: 'CMP-',         business_partner: 'BP-',
    fixed_asset: 'FA-',
  };
  let seriesCreated = 0;
  for (const documentType of NUMBERED_DOCUMENT_TYPES) {
    const existing = await prisma.numberingSeries.findFirst({
      where: { companyId: demoCompany.id, documentType },
    });
    // A company that already numbers this document type keeps its own series —
    // re-seeding must never reset a counter that has issued numbers.
    if (existing) continue;
    await prisma.numberingSeries.create({
      data: {
        companyId: demoCompany.id,
        documentType,
        name: 'Primary',
        prefix: SERIES_PREFIX[documentType] ?? '',
        digits: 5,
        isDefault: true,
      },
    });
    seriesCreated++;
  }
  console.log(`✅ ${seriesCreated} numbering series seeded`);

  // Subscribe the demo company to the Premium plan, in TRIAL.
  const premium = await prisma.plan.findUnique({ where: { key: 'premium' } });
  if (premium) {
    const existingSub = await prisma.subscription.findUnique({ where: { companyId: demoCompany.id } });
    if (!existingSub) {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + premium.trialDays * 86_400_000);
      const periodEnd = new Date(now.getTime());
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const sub = await prisma.subscription.create({
        data: {
          companyId: demoCompany.id,
          planId: premium.id,
          status: SubscriptionStatus.TRIAL,
          billingInterval: BillingInterval.MONTHLY,
          trialEndsAt: trialEnd,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await prisma.subscriptionEvent.create({
        data: { subscriptionId: sub.id, fromStatus: null, toStatus: SubscriptionStatus.TRIAL, reason: 'seeded' },
      });
      console.log('✅ Demo subscription → premium (TRIAL)');
    }
  }

  // Enable all modules for demo company
  const modules = await prisma.systemModule.findMany();
  for (const mod of modules) {
    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId: demoCompany.id, moduleId: mod.id } },
      update: {},
      create: { companyId: demoCompany.id, moduleId: mod.id, isEnabled: true },
    });
  }

  // ── Helpers for role seeding ──────────────────────────────────────────────
  async function ensureRole(name: string, opts: {
    description?: string;
    domain?: string;
    isDefault?: boolean;
    defaultScope?: PermissionScope;
  } = {}) {
    return prisma.role.upsert({
      where: { name_companyId: { name, companyId: demoCompany.id } },
      update: {
        description: opts.description,
        domain: opts.domain,
        isDefault: opts.isDefault ?? false,
        defaultScope: opts.defaultScope ?? PermissionScope.ALL,
      },
      create: {
        name,
        description: opts.description,
        companyId: demoCompany.id,
        domain: opts.domain,
        isDefault: opts.isDefault ?? false,
        defaultScope: opts.defaultScope ?? PermissionScope.ALL,
      },
    });
  }

  async function setRolePermissionsByKey(roleId: string, keys: string[], scope: PermissionScope = PermissionScope.ALL) {
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    if (!perms.length) return;
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId, permissionId: p.id, scope })),
      skipDuplicates: true,
    });
  }

  async function attachPermissionSets(roleId: string, setKeys: string[]) {
    await prisma.rolePermissionSet.deleteMany({ where: { roleId } });
    const sets = await prisma.permissionSet.findMany({ where: { key: { in: setKeys } } });
    if (!sets.length) return;
    await prisma.rolePermissionSet.createMany({
      data: sets.map((s) => ({ roleId, setId: s.id })),
      skipDuplicates: true,
    });
  }

  // ── Admin Role (full access — every catalog permission, ALL scope) ─────────
  const adminRole = await ensureRole('Admin', {
    description: 'Full access to all modules',
    defaultScope: PermissionScope.ALL,
  });
  const allPerms = await prisma.permission.findMany();
  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  await prisma.rolePermission.createMany({
    data: allPerms.map((p) => ({ roleId: adminRole.id, permissionId: p.id, scope: PermissionScope.ALL })),
    skipDuplicates: true,
  });

  // ── Viewer Role (Financials + CRM, view-only) ─────────────────────────────
  const viewerRole = await ensureRole('Viewer', {
    description: 'Read-only access to Financials and CRM',
    isDefault: true,
    defaultScope: PermissionScope.ALL,
  });
  await attachPermissionSets(viewerRole.id, ['financials.viewer', 'crm.viewer']);

  // ── HR Domain Roles ───────────────────────────────────────────────────────
  const hrAdminRole = await ensureRole('HR Admin', {
    description: 'Full control over all HR modules and configurations',
    domain: 'HR',
    defaultScope: PermissionScope.ALL,
  });
  await attachPermissionSets(hrAdminRole.id, HR_MODULE_SLUGS.map((s) => `${s}.manager`));

  const hrManagerRole = await ensureRole('HR Manager', {
    description: 'Elevated HR access: department-scoped management',
    domain: 'HR',
    defaultScope: PermissionScope.DEPARTMENT,
  });
  await attachPermissionSets(hrManagerRole.id, HR_MODULE_SLUGS.map((s) => `${s}.power`));

  const hrViewerRole = await ensureRole('HR Viewer', {
    description: 'Read-only access to authorized HR data',
    domain: 'HR',
    defaultScope: PermissionScope.DEPARTMENT,
  });
  await attachPermissionSets(hrViewerRole.id, HR_MODULE_SLUGS.map((s) => `${s}.viewer`));

  console.log('✅ Roles seeded  →  Admin, Viewer, HR Admin, HR Manager, HR Viewer');

  // ── Users ─────────────────────────────────────────────────────────────────
  async function ensureUser(opts: {
    email: string;
    name: string;
    password: string;
    roleType: UserRoleType;
  }) {
    const existing = await prisma.user.findFirst({
      where: { email: opts.email, companyId: demoCompany.id },
    });
    if (existing) {
      // Reconcile rather than return as-is. A seed has to converge on the state
      // it declares, otherwise re-running it against an existing database
      // silently leaves users on a stale roleType — which is exactly what
      // happened after the UserRoleType migration remapped everyone to EMPLOYEE
      // and left the demo company admin unable to reach any module.
      if (existing.roleType !== opts.roleType) {
        return prisma.user.update({
          where: { id: existing.id },
          data: { roleType: opts.roleType },
        });
      }
      return existing;
    }
    const passwordHash = await bcrypt.hash(opts.password, 12);
    return prisma.user.create({
      data: {
        email: opts.email,
        name: opts.name,
        passwordHash,
        companyId: demoCompany.id,
        roleType: opts.roleType,
        passwordChangedAt: new Date(),
      },
    });
  }

  const companyAdmin = await ensureUser({
    email: 'manager@demo.com',
    name: 'Demo Manager',
    password: 'password123',
    roleType: UserRoleType.COMPANY_ADMIN,
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: companyAdmin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: companyAdmin.id, roleId: adminRole.id },
  });
  console.log('✅ Company admin  →  manager@demo.com / password123');

  const viewerUser = await ensureUser({
    email: 'viewer@demo.com',
    name: 'Demo Viewer',
    password: 'password123',
    roleType: UserRoleType.EMPLOYEE,
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: viewerUser.id, roleId: viewerRole.id } },
    update: {},
    create: { userId: viewerUser.id, roleId: viewerRole.id },
  });

  // Modules control which areas a user can reach at all; the Viewer role already
  // limits them to `.view` permissions. Without any module grant an EMPLOYEE
  // resolves to zero modules and every @RequireModule route 403s, which makes
  // the demo viewer look broken rather than read-only.
  const companyModules = await prisma.companyModule.findMany({
    where: { companyId: demoCompany.id, isEnabled: true },
    select: { moduleId: true },
  });
  for (const cm of companyModules) {
    await prisma.userModule.upsert({
      where: { userId_moduleId: { userId: viewerUser.id, moduleId: cm.moduleId } },
      update: {},
      create: { userId: viewerUser.id, moduleId: cm.moduleId },
    });
  }
  console.log('✅ Viewer         →  viewer@demo.com / password123');

  const hrAdminUser = await ensureUser({
    email: 'hradmin@demo.com',
    name: 'HR Administrator',
    password: 'password123',
    roleType: UserRoleType.DEPARTMENT_HEAD,
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: hrAdminUser.id, roleId: hrAdminRole.id } },
    update: {},
    create: { userId: hrAdminUser.id, roleId: hrAdminRole.id },
  });

  // Module visibility for HR Admin (alongside permission gating)
  const hrModules = await prisma.systemModule.findMany({ where: { slug: { in: HR_MODULE_SLUGS } } });
  for (const mod of hrModules) {
    await prisma.userModule.upsert({
      where: { userId_moduleId: { userId: hrAdminUser.id, moduleId: mod.id } },
      update: {},
      create: { userId: hrAdminUser.id, moduleId: mod.id },
    });
  }
  console.log('✅ HR admin       →  hradmin@demo.com / password123');

  console.log('\n🎉 Seed complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
