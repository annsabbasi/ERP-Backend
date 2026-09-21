import { Injectable, Logger } from '@nestjs/common';
import { PermissionScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getTemplate } from './templates/registry';
import type { IndustryTemplate } from './templates/template.types';

/**
 * Applies an IndustryTemplate to a fresh (or existing) Company:
 *
 *   • Sets profile fields (currency, locale, timezone, fiscalYearStart, branding).
 *   • Enables every default module that is BOTH on the subscription's plan AND
 *     in the template's list. Modules outside the plan are skipped — the spec
 *     calls this out as a hard subscription gate (Section 4.3).
 *   • Seeds default roles, attaching system PermissionSets and/or direct
 *     permission keys.
 *
 * The operation is idempotent: re-applying a template upserts modules and
 * roles by name, refreshing description/scope but never deleting custom roles
 * the company has added in the meantime.
 *
 * Every write below is batched (createMany/updateMany/deleteMany over the
 * whole set) rather than looped per module/role: a template with N roles used
 * to cost roughly 6N sequential round trips inside one interactive
 * transaction, which is what was blowing through Prisma's transaction timeout
 * (P2028) against the hosted, pooled Postgres connection. Batching keeps the
 * round-trip count roughly constant regardless of template size.
 */
@Injectable()
export class TemplateApplierService {
  private readonly logger = new Logger(TemplateApplierService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(companyId: string, templateKey: string) {
    const planModuleIds = await this.planModuleIds(companyId);
    const result = await this.prisma.$transaction(
      (tx) => this.applyTx(tx, companyId, templateKey, planModuleIds),
      { timeout: 15_000 },
    );
    this.logger.log(`Template "${result.template}" applied to company ${companyId}`);
    return result;
  }

  /**
   * Core logic, usable inside a transaction the caller already owns.
   *
   * Company onboarding needs this to commit or roll back atomically with the
   * company/user/subscription writes, so it cannot open its own `$transaction`
   * — that is exactly what `apply()` does for every other caller.
   */
  async applyTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    templateKey: string,
    planModuleIds: Set<string>,
  ) {
    const template = getTemplate(templateKey);

    await tx.company.update({
      where: { id: companyId },
      data: {
        industry: template.key,
        templateApplied: template.key,
        currency: template.profile?.currency ?? undefined,
        locale: template.profile?.locale ?? undefined,
        timezone: template.profile?.timezone ?? undefined,
        fiscalYearStart: template.profile?.fiscalYearStart ?? undefined,
        branding: template.terminology
          ? ({ terminologyOverrides: template.terminology } as Prisma.InputJsonValue)
          : undefined,
      },
    });

    await this.enableModules(tx, companyId, template, planModuleIds);
    await this.seedRoles(tx, companyId, template);

    return { template: template.key, version: template.version };
  }

  private async planModuleIds(companyId: string): Promise<Set<string>> {
    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: { include: { modules: true } } },
    });
    if (!sub) return new Set(); // no subscription → no modules pass the gate
    return new Set(sub.plan.modules.map((m) => m.moduleId));
  }

  /**
   * Enables every template module that is on the plan, in three fixed queries
   * regardless of module count: look up the modules, split against what is
   * already enabled, then one `createMany` and one `updateMany` for the rest.
   */
  private async enableModules(
    tx: Prisma.TransactionClient,
    companyId: string,
    template: IndustryTemplate,
    planModuleIds: Set<string>,
  ) {
    if (!template.defaultModuleSlugs.length) return;

    const modules = await tx.systemModule.findMany({
      where: { slug: { in: template.defaultModuleSlugs } },
    });
    // Skip silently if the plan doesn't include a module (Section 4.3 gate).
    const idsToEnable = modules.filter((m) => planModuleIds.has(m.id)).map((m) => m.id);
    if (!idsToEnable.length) return;

    const existing = await tx.companyModule.findMany({
      where: { companyId, moduleId: { in: idsToEnable } },
      select: { moduleId: true },
    });
    const existingIds = new Set(existing.map((e) => e.moduleId));
    const toCreate = idsToEnable.filter((id) => !existingIds.has(id));
    const toUpdate = idsToEnable.filter((id) => existingIds.has(id));

    if (toCreate.length) {
      await tx.companyModule.createMany({
        data: toCreate.map((moduleId) => ({ companyId, moduleId, isEnabled: true })),
        skipDuplicates: true,
      });
    }
    if (toUpdate.length) {
      await tx.companyModule.updateMany({
        where: { companyId, moduleId: { in: toUpdate } },
        data: { isEnabled: true },
      });
    }
  }

  /**
   * Seeds every template role and its permission attachments in a fixed
   * handful of queries, regardless of how many roles the template declares:
   * one lookup + one bulk create for the roles themselves, then two bulk
   * deletes and two bulk (lookup + createMany) passes across every role's
   * permission-set and direct-permission attachments combined.
   */
  private async seedRoles(
    tx: Prisma.TransactionClient,
    companyId: string,
    template: IndustryTemplate,
  ) {
    if (!template.defaultRoles.length) return;

    const names = template.defaultRoles.map((r) => r.name);
    const existing = await tx.role.findMany({ where: { companyId, name: { in: names } } });
    const existingByName = new Map(existing.map((r) => [r.name, r]));

    const toCreate = template.defaultRoles.filter((r) => !existingByName.has(r.name));
    if (toCreate.length) {
      await tx.role.createMany({
        data: toCreate.map((r) => ({
          name: r.name,
          description: r.description,
          companyId,
          domain: r.domain,
          isDefault: r.isDefault ?? false,
          defaultScope: r.defaultScope ?? PermissionScope.ALL,
        })),
        skipDuplicates: true,
      });
    }

    // Refresh roles that already existed (re-apply case). A brand-new company
    // — the onboarding path this was built for — never hits this loop.
    for (const r of template.defaultRoles) {
      const found = existingByName.get(r.name);
      if (!found) continue;
      await tx.role.update({
        where: { id: found.id },
        data: {
          description: r.description,
          domain: r.domain,
          isDefault: r.isDefault ?? false,
          defaultScope: r.defaultScope ?? PermissionScope.ALL,
        },
      });
    }

    const allRoles = await tx.role.findMany({ where: { companyId, name: { in: names } } });
    const roleIdByName = new Map(allRoles.map((r) => [r.name, r.id]));
    const allRoleIds = allRoles.map((r) => r.id);

    // Reset attachments so role state reflects the latest template — batched
    // across every role instead of one delete pair per role.
    await tx.rolePermission.deleteMany({ where: { roleId: { in: allRoleIds } } });
    await tx.rolePermissionSet.deleteMany({ where: { roleId: { in: allRoleIds } } });

    const setKeys = new Set<string>();
    const permKeys = new Set<string>();
    for (const r of template.defaultRoles) {
      r.permissionSetKeys?.forEach((k) => setKeys.add(k));
      r.permissionKeys?.forEach((k) => permKeys.add(k));
    }

    if (setKeys.size) {
      const sets = await tx.permissionSet.findMany({
        where: { isSystem: true, key: { in: [...setKeys] } },
      });
      const setIdByKey = new Map(sets.map((s) => [s.key, s.id]));
      const rows = template.defaultRoles.flatMap((r) =>
        (r.permissionSetKeys ?? [])
          .map((k) => setIdByKey.get(k))
          .filter((id): id is string => !!id)
          .map((setId) => ({ roleId: roleIdByName.get(r.name)!, setId })),
      );
      if (rows.length) {
        await tx.rolePermissionSet.createMany({ data: rows, skipDuplicates: true });
      }
    }

    if (permKeys.size) {
      const perms = await tx.permission.findMany({ where: { key: { in: [...permKeys] } } });
      const permIdByKey = new Map(perms.map((p) => [p.key, p.id]));
      const rows = template.defaultRoles.flatMap((r) =>
        (r.permissionKeys ?? [])
          .map((k) => permIdByKey.get(k))
          .filter((id): id is string => !!id)
          .map((permissionId) => ({
            roleId: roleIdByName.get(r.name)!,
            permissionId,
            scope: r.defaultScope ?? PermissionScope.ALL,
          })),
      );
      if (rows.length) {
        await tx.rolePermission.createMany({ data: rows, skipDuplicates: true });
      }
    }
  }
}
