// Seed for the local stack, run by `pnpm local:up` after `migrate deploy` and
// `db:local-roles`. Each stage adds what its screens need (the Platform Owner in Stage 2, the
// shipped templates, country pack and plans in Stage 4, demo companies through provisioning in
// Stage 5).
import { syncCatalogue } from './catalogue-sync';
import { seedConsoleData } from './console-seed';
import { createPrismaClient } from './client';
import { assertLocalOnly } from './local-only';

// Run from packages/db, like prisma.config.ts: the workspace .env holds the local URLs.
try {
  process.loadEnvFile('../../.env');
} catch {
  // no .env file: use the environment as it is
}

async function main(): Promise<void> {
  assertLocalOnly(process.env, 'the seed');
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error('the seed needs DIRECT_URL (the database owner)');
  const prisma = createPrismaClient(url, { max: 2 });
  try {
    const result = await syncCatalogue(prisma);
    console.log(
      `seed: catalogue synced (${result.modules} modules, ${result.features} features, ` +
        `${result.permissions} permissions; marked removed: ${result.removed.features} features, ` +
        `${result.removed.permissions} permissions)`,
    );
    const shipped = await seedConsoleData(prisma);
    console.log(
      `seed: shipped catalogue data added (templates: ${shipped.templates.join(', ') || 'none new'}; ` +
        `country packs: ${shipped.countryPacks.join(', ') || 'none new'}; plans: ${shipped.plans.join(', ') || 'none new'})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
