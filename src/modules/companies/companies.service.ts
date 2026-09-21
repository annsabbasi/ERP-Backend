import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRoleType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TemplateApplierService } from '../tenancy/template-applier.service';
import { DemoDataSeederService } from '../tenancy/demo-data-seeder.service';
import { AuditService } from '../audit/audit.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  AssignModulesDto,
  UpdateBrandingDto,
  UpdateCompanyDto,
} from './dto/update-company.dto';
import { OnboardCompanyDto } from './dto/onboard-company.dto';

interface AuditContext {
  actorId: string | null;
  ip?: string;
}

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly templates: TemplateApplierService,
    private readonly demoData: DemoDataSeederService,
    private readonly audit: AuditService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  findAll() {
    return this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { users: true, companyModules: true, branches: true } },
      },
    });
  }

  /**
   * The companies the caller may act inside — what the Choose Company grid lists.
   *
   * A platform operator sees every tenant; a company user sees only their own.
   * Deliberately a separate route from `findAll()`: that one is super-admin-only
   * and returns billing detail, and Choose Company must also work for a company
   * user, who then simply has a single-row grid.
   */
  async available(user: { isSuperAdmin?: boolean; companyId?: string | null }) {
    const where: Prisma.CompanyWhereInput = user.isSuperAdmin
      ? {}
      : { id: user.companyId ?? '__none__' };

    const rows = await this.prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        country: true,
        currency: true,
        locale: true,
        timezone: true,
        industry: true,
        fiscalYearStart: true,
        createdAt: true,
        _count: { select: { users: true, branches: true } },
        companyModules: {
          where: { isEnabled: true },
          select: { module: { select: { slug: true, name: true } } },
        },
      },
    });

    // The grid's columns are SAP's: Company Name / Database Name / Localization
    // / Version. `slug` is this platform's stand-in for a database name — it is
    // the stable per-tenant identifier a user recognises.
    return rows.map((c) => ({
      ...c,
      databaseName: c.slug,
      localization: c.country ?? c.locale ?? '—',
      moduleCount: c.companyModules.length,
    }));
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        companyModules: { include: { module: true } },
        subscription: { include: { plan: { include: { modules: { include: { module: true } } } } } },
        _count: { select: { users: true, branches: true } },
      },
    });
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return company;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async create(dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new BadRequestException('Company slug already taken');
    return this.prisma.company.create({ data: dto });
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async updateBranding(id: string, dto: UpdateBrandingDto, audit: AuditContext) {
    await this.findOne(id);
    const updated = await this.prisma.company.update({
      where: { id },
      data: { branding: dto.branding as Prisma.InputJsonValue },
      select: { id: true, branding: true },
    });
    await this.recordActivity(id, audit, 'tenancy.branding.updated', { fields: Object.keys(dto.branding) });
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.company.delete({ where: { id } });
    return { message: `Company ${id} deleted` };
  }

  // ── Module activation (subscription-gated) ────────────────────────────────

  /**
   * Bulk-assign modules. Each must be on the company's plan; the call fails
   * the whole batch if any module is missing rather than silently skipping.
   */
  async assignModules(id: string, dto: AssignModulesDto, audit: AuditContext) {
    await this.findOne(id);
    const modules = await this.prisma.systemModule.findMany({
      where: { id: { in: dto.moduleIds } },
    });
    if (modules.length !== dto.moduleIds.length) {
      throw new BadRequestException('One or more module ids are unknown');
    }
    for (const mod of modules) {
      await this.subscriptions.assertModuleOnPlan(id, mod.slug);
    }

    await this.prisma.companyModule.deleteMany({ where: { companyId: id } });
    await this.prisma.companyModule.createMany({
      data: dto.moduleIds.map((moduleId) => ({ companyId: id, moduleId, isEnabled: true })),
      skipDuplicates: true,
    });
    await this.recordActivity(id, audit, 'tenancy.modules.assigned', { moduleIds: dto.moduleIds });
    return this.findOne(id);
  }

  async toggleModule(
    companyId: string,
    moduleId: string,
    isEnabled: boolean,
    audit: AuditContext,
  ) {
    const mod = await this.prisma.systemModule.findUnique({ where: { id: moduleId } });
    if (!mod) throw new NotFoundException(`Module ${moduleId} not found`);

    if (isEnabled) {
      await this.subscriptions.assertModuleOnPlan(companyId, mod.slug);
    }

    const result = await this.prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId, moduleId } },
      create: { companyId, moduleId, isEnabled },
      update: { isEnabled },
    });
    await this.recordActivity(companyId, audit, isEnabled ? 'tenancy.module.activated' : 'tenancy.module.deactivated', {
      moduleSlug: mod.slug,
    });
    return result;
  }

  /**
   * Self-service-style onboarding flow (Section 4.3):
   *   1. Create the Company.
   *   2. Provision the first Company Admin user.
   *   3. Create the Subscription on the chosen plan (TRIAL by default).
   *   4. Apply the industry template (modules + roles + branding).
   *
   * All four steps run inside one transaction. They used to run as three
   * separate transactions (company+user, then subscription, then template),
   * which meant a failure partway through — including the P2028 timeout this
   * replaced — could leave a company committed without its subscription or
   * starting modules/roles, and with its slug permanently "taken" so the
   * onboarding could not even be retried under the same name. One transaction
   * makes onboarding all-or-nothing.
   *
   * That transaction only ever issues a fixed, small number of queries now —
   * see `SubscriptionsService.createTx` and `TemplateApplierService.applyTx`,
   * both of which batch what used to be per-module/per-role loops — so it
   * comfortably finishes well inside the timeout regardless of how large a
   * template or plan is.
   *
   * Returns the temporary admin password — the caller is expected to deliver
   * it via email or hand it off to the customer. (Email integration arrives in
   * Module 6 / Notifications.)
   */
  async onboard(dto: OnboardCompanyDto, audit: AuditContext) {
    const slugClash = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (slugClash) throw new BadRequestException('Company slug already taken');

    // Pre-validate the plan so we fail before creating the company row, and
    // fetch its modules here so template application doesn't need its own
    // round trip for them inside the transaction.
    const plan = await this.prisma.plan.findUnique({
      where: { key: dto.planKey },
      include: { modules: true },
    });
    if (!plan) throw new BadRequestException(`Unknown plan key: ${dto.planKey}`);
    const planModuleIds = new Set(plan.modules.map((m) => m.moduleId));

    const tempPassword = dto.adminPassword ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    let subscriptionStatus = '';
    let adminUserId = '';

    const company = await this.prisma.$transaction(
      async (tx) => {
        const c = await tx.company.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            industry: dto.industry,
            country: dto.country,
            currency: dto.currency,
            locale: dto.locale,
            timezone: dto.timezone,
            fiscalYearStart: dto.fiscalYearStart,
          },
        });
        const admin = await tx.user.create({
          data: {
            email: dto.adminEmail,
            name: dto.adminName,
            passwordHash,
            companyId: c.id,
            roleType: UserRoleType.COMPANY_ADMIN,
            passwordChangedAt: new Date(),
          },
        });
        adminUserId = admin.id;

        // Subscription must be created BEFORE template application so the
        // plan-gated module enablement has something to consult.
        const created = await this.subscriptions.createTx(
          tx,
          c.id,
          plan,
          { billingInterval: dto.billingInterval, startInTrial: true },
          audit.actorId,
        );
        subscriptionStatus = created.status;

        await this.templates.applyTx(tx, c.id, dto.industry ?? 'generic', planModuleIds);

        return c;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    // Convenience data — enough rows in every Administration dropdown's
    // backing table (users, departments, currencies, accounts, posting
    // periods, numbering series, territories, approval stages/templates, a
    // license, an alert) that the module is immediately usable rather than
    // empty. Deliberately outside the transaction above and never allowed to
    // fail onboarding: it is convenience data, not core business data.
    try {
      await this.demoData.seed(company.id, adminUserId);
    } catch (e) {
      this.logger.warn(`Demo data seeding failed for company ${company.id}: ${(e as Error).message}`);
    }

    await this.recordActivity(company.id, audit, 'subscription.created', {
      planKey: plan.key,
      status: subscriptionStatus,
    });
    await this.recordActivity(company.id, audit, 'tenancy.company.onboarded', {
      slug: company.slug,
      industry: dto.industry,
      plan: dto.planKey,
    });

    return {
      company: await this.findOne(company.id),
      adminCredentials: {
        email: dto.adminEmail,
        // Temporary password is returned ONCE so the caller can deliver it.
        // It is not stored or logged anywhere outside the password hash.
        temporaryPassword: tempPassword,
      },
    };
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  private async recordActivity(
    companyId: string,
    audit: AuditContext,
    action: string,
    details: Prisma.InputJsonValue,
  ) {
    await this.audit.record({
      companyId,
      actorId: audit.actorId,
      action,
      refType: 'company',
      refId: companyId,
      after: details,
      ip: audit.ip,
      module: 'tenancy',
      details,
    });
  }
}

/** Generates a 16-char alphanumeric temporary password for new admins. */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
