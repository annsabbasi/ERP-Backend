import {
  BillingInterval,
  PermissionScope,
  PrismaClient,
  SubscriptionStatus,
  UserRoleType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PERMISSION_CATALOG, SYSTEM_PERMISSION_SETS } from '../src/modules/permissions/permission-catalog';
import { SYSTEM_WORKFLOW_TEMPLATES } from '../src/modules/workflows/system-templates';

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
      monthlyPrice: 4900,    // cents
      annualPrice: 49000,
      maxUsers: 25,
      sortOrder: 10,
      moduleSlugs: ['administration', 'financials', 'hr', 'hr-employee-records', 'reports'],
    },
    {
      key: 'business',
      name: 'Business',
      description: 'Core + 3 industry modules. Up to 100 seats.',
      monthlyPrice: 14900,
      annualPrice: 149000,
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
      monthlyPrice: 39900,
      annualPrice: 399000,
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
    if (existing) return existing;
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
