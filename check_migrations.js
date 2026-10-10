const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at, applied_steps_count, logs FROM _prisma_migrations ORDER BY started_at ASC`
  );
  for (const r of rows) {
    console.log(r.migration_name, '| finished:', r.finished_at, '| steps:', r.applied_steps_count, '| logs:', r.logs);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
