import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Prisma does not know the hand-written same-tenant foreign keys (*_tenant_fk), so every
// `prisma migrate dev` proposes dropping them. This check fails when a committed migration
// drops one without adding it back; delete those lines from the generated migration.

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');

/** Same-tenant foreign keys that a migration drops and does not add back. */
function droppedTenantFks(sql: string): string[] {
  const added = new Set([...sql.matchAll(/ADD CONSTRAINT "(\w+_tenant_fk)"/g)].map((m) => m[1]));
  return [...sql.matchAll(/DROP CONSTRAINT (?:IF EXISTS )?"(\w+_tenant_fk)"/g)]
    .map((m) => m[1]!)
    .filter((name) => !added.has(name));
}

describe('migrations', () => {
  it('never drop a same-tenant foreign key without adding it back', () => {
    const problems = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        droppedTenantFks(readFileSync(join(MIGRATIONS, d.name, 'migration.sql'), 'utf8')).map(
          (fk) => `${d.name} drops ${fk}`,
        ),
      );
    expect(problems).toEqual([]);
  });

  it('notices the drop that prisma migrate dev generates', () => {
    const generated = `-- DropForeignKey
ALTER TABLE "app"."teams" DROP CONSTRAINT "teams_lead_membership_tenant_fk";`;
    expect(droppedTenantFks(generated)).toEqual(['teams_lead_membership_tenant_fk']);
    const recreated = `${generated}
ALTER TABLE "app"."teams" ADD CONSTRAINT "teams_lead_membership_tenant_fk" FOREIGN KEY ("tenant_id", "lead_membership_id") REFERENCES "app"."memberships" ("tenant_id", "id");`;
    expect(droppedTenantFks(recreated)).toEqual([]);
  });
});
