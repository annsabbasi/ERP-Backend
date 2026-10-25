import { CATALOGUE, SENSITIVE_GROUPS, type Catalogue } from '@erp/contracts';
import type { PrismaClient } from './generated/prisma/client';

export type CatalogueSyncResult = {
  modules: number;
  features: number;
  permissions: number;
  removed: { modules: number; features: number; permissions: number };
};

/**
 * Writes the code registry into platform.catalogue_* (Part 10 §10.7.1), so the console and
 * the role editors read the same catalogue the API enforces. Keys that left the code are
 * marked removed, never deleted: entitlements and grants may still name them.
 */
export async function syncCatalogue(
  prisma: PrismaClient,
  catalogue: Catalogue = CATALOGUE,
  now: Date = new Date(),
): Promise<CatalogueSyncResult> {
  const sensitive = new Set(SENSITIVE_GROUPS.flatMap((g) => g.permissions));
  const moduleKeys = catalogue.modules.map((m) => m.key);
  const featureKeys = catalogue.features.map((f) => f.key);
  const permissionKeys = [...catalogue.permissionKeys];

  return prisma.$transaction(
    async (tx) => {
      for (const [i, m] of catalogue.modules.entries()) {
        const data = {
          name: m.name,
          category: m.category,
          groupName: m.group,
          status: m.status,
          sortOrder: i,
          removedAt: null,
          syncedAt: now,
        };
        await tx.catalogueModule.upsert({
          where: { key: m.key },
          create: { key: m.key, ...data },
          update: data,
        });
      }
      for (const [i, f] of catalogue.features.entries()) {
        const data = {
          moduleKey: f.module,
          name: f.name,
          release: f.release,
          status: f.status,
          alwaysOn: f.alwaysOn,
          requires: [...f.requires],
          requiresAnyOf: [...f.requiresAnyOf],
          recommends: [...f.recommends],
          conflicts: [...f.conflicts],
          limits: [...f.limits],
          scopes: [...f.scopes],
          menu: f.menu.map((entry) => ({ ...entry })),
          sortOrder: i,
          removedAt: null,
          syncedAt: now,
        };
        await tx.catalogueFeature.upsert({
          where: { key: f.key },
          create: { key: f.key, ...data },
          update: data,
        });
      }
      for (const key of permissionKeys) {
        const [moduleKey = '', resource = '', action = ''] = key.split('.');
        const data = {
          moduleKey,
          resource,
          action,
          featureKeys: [...catalogue.featuresOfPermission(key)],
          sensitive: sensitive.has(key) || action === 'view_sensitive',
          removedAt: null,
          syncedAt: now,
        };
        await tx.cataloguePermission.upsert({
          where: { key },
          create: { key, ...data },
          update: data,
        });
      }
      const gone = { removedAt: null };
      const removed = {
        modules: (
          await tx.catalogueModule.updateMany({
            where: { key: { notIn: moduleKeys }, ...gone },
            data: { removedAt: now },
          })
        ).count,
        features: (
          await tx.catalogueFeature.updateMany({
            where: { key: { notIn: featureKeys }, ...gone },
            data: { removedAt: now },
          })
        ).count,
        permissions: (
          await tx.cataloguePermission.updateMany({
            where: { key: { notIn: permissionKeys }, ...gone },
            data: { removedAt: now },
          })
        ).count,
      };
      return {
        modules: moduleKeys.length,
        features: featureKeys.length,
        permissions: permissionKeys.length,
        removed,
      };
    },
    { timeout: 120_000 },
  );
}
