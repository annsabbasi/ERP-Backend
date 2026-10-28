import { PAKISTAN_1_0, SHIPPED_TEMPLATES, uuidv7 } from '@erp/contracts';
import type { PrismaClient } from './generated/prisma/client';

// What the product ships in the catalogue (Phase 0 exit criteria, Part 12 §12.9): the three
// industry templates and the Pakistan country pack, published as release data like the
// registry, and the four plan tiers (Part 02 §2.11). Each is inserted only when absent, so
// nothing staff changed in the console is ever overwritten. Every insert is audited.

export type ConsoleSeedResult = { templates: string[]; countryPacks: string[]; plans: string[] };

/**
 * The plan tiers kept from today's product. Limits are starting values and prices are left
 * empty: both are business decisions made in the console, so the plans start private.
 */
const PLAN_TIERS = [
  {
    key: 'starter',
    name: 'Starter',
    tier: 1,
    limits: { 'users.max': 5, 'branches.max': 1, 'storage.gb': 2 },
  },
  {
    key: 'business',
    name: 'Business',
    tier: 2,
    limits: { 'users.max': 25, 'branches.max': 3, 'storage.gb': 10 },
  },
  {
    key: 'premium',
    name: 'Premium',
    tier: 3,
    limits: { 'users.max': 100, 'branches.max': 10, 'storage.gb': 50 },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    tier: 4,
    limits: { 'users.max': 500, 'branches.max': 50, 'storage.gb': 500 },
  },
];

export async function seedConsoleData(prisma: PrismaClient): Promise<ConsoleSeedResult> {
  const result: ConsoleSeedResult = { templates: [], countryPacks: [], plans: [] };
  const audit = (action: string, targetType: string, targetId: string, after: unknown) =>
    prisma.$executeRaw`
      SELECT platform.append_audit(${uuidv7()}::uuid, NULL, ${action}, NULL, ${targetType},
        ${targetId}, NULL, ${JSON.stringify(after)}::jsonb, 'shipped with the release', NULL)`;

  for (const template of SHIPPED_TEMPLATES) {
    if (await prisma.industryTemplate.count({ where: { key: template.key } })) continue;
    await prisma.industryTemplate.create({
      data: {
        key: template.key,
        version: template.version,
        status: 'published',
        definition: template as object,
        publishedAt: new Date(),
      },
    });
    await audit(
      'release.template_published',
      'industry_template',
      `${template.key}@${template.version}`,
      {
        status: 'published',
        roles: template.roles.length,
        entitlements: template.entitlements.length,
      },
    );
    result.templates.push(`${template.key}@${template.version}`);
  }

  const pack = PAKISTAN_1_0;
  if (!(await prisma.countryPack.count({ where: { country: pack.country } }))) {
    await prisma.countryPack.create({
      data: {
        country: pack.country,
        version: pack.version,
        status: 'published',
        effectiveFrom: new Date(pack.effective_from),
        data: pack.data as object,
        publishedAt: new Date(),
      },
    });
    await audit(
      'release.country_pack_published',
      'country_pack',
      `${pack.country}@${pack.version}`,
      {
        status: 'published',
        effective_from: pack.effective_from,
      },
    );
    result.countryPacks.push(`${pack.country}@${pack.version}`);
  }

  if (!(await prisma.plan.count())) {
    for (const plan of PLAN_TIERS) {
      await prisma.plan.create({
        data: { ...plan, featureKeys: [], prices: {}, visibility: 'private' },
      });
      await audit('release.plan_created', 'plan', plan.key, {
        ...plan,
        prices: {},
        visibility: 'private',
      });
      result.plans.push(plan.key);
    }
  }
  return result;
}
