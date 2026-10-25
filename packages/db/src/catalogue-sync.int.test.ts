import { buildCatalogue, CATALOGUE, defineModule, feature, actions } from '@erp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncCatalogue } from './catalogue-sync';
import { createPrismaClient } from './client';
import type { PrismaClient } from './generated/prisma/client';
import { prepareTestDatabase } from './testing';

// Catalogue sync (Part 10 §10.7.1): the registry in code is written to platform.catalogue_*.

let prisma: PrismaClient;

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_catalogue');
  prisma = createPrismaClient(db.ownerUrl, { max: 2 });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

describe('syncCatalogue', () => {
  it('writes every module, feature and permission of the registry', async () => {
    const result = await syncCatalogue(prisma);
    expect(result).toMatchObject({
      modules: CATALOGUE.modules.length,
      features: CATALOGUE.features.length,
      permissions: CATALOGUE.permissionKeys.length,
    });
    expect(await prisma.catalogueModule.count()).toBe(CATALOGUE.modules.length);
    expect(await prisma.catalogueFeature.count()).toBe(CATALOGUE.features.length);
    expect(await prisma.cataloguePermission.count()).toBe(CATALOGUE.permissionKeys.length);

    const waiter = await prisma.catalogueFeature.findUniqueOrThrow({
      where: { key: 'restaurant.waiter_app' },
    });
    expect(waiter.requires).toEqual(
      expect.arrayContaining(['restaurant.menu', 'restaurant.floor', 'pos.core']),
    );
    const orders = await prisma.cataloguePermission.findUniqueOrThrow({
      where: { key: 'restaurant.orders.create' },
    });
    expect(orders.featureKeys).toEqual(
      expect.arrayContaining(['restaurant.waiter_app', 'restaurant.cashier']),
    );
    const salaries = await prisma.cataloguePermission.findUniqueOrThrow({
      where: { key: 'payroll.compensation.view_sensitive' },
    });
    expect(salaries.sensitive).toBe(true);
  });

  it('is idempotent', async () => {
    await syncCatalogue(prisma);
    expect(await prisma.catalogueFeature.count()).toBe(CATALOGUE.features.length);
    expect(await prisma.catalogueFeature.count({ where: { removedAt: { not: null } } })).toBe(0);
  });

  it('marks keys that left the code as removed instead of deleting them', async () => {
    const smaller = buildCatalogue([
      defineModule({
        key: 'core',
        name: 'Core services',
        category: 'core',
        group: 'Core',
        features: {
          org: feature({
            name: 'Organization',
            release: 'R1',
            resources: { company: actions(['view']) },
          }),
        },
      }),
    ]);
    const result = await syncCatalogue(prisma, smaller);
    expect(result.removed.features).toBe(CATALOGUE.features.length - 1);
    expect(await prisma.catalogueFeature.count()).toBe(CATALOGUE.features.length);
    await syncCatalogue(prisma);
    expect(await prisma.catalogueFeature.count({ where: { removedAt: { not: null } } })).toBe(0);
  });
});
