import { uuidv7 } from '@erp/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareTestDatabase } from './testing';
import { grantsOf } from './test-support/grants';

// app_platform, the Platform Console's role (Stage 1 QA finding F4): control-plane tables only.
// It reads and edits the catalogue's display fields, plans, templates, country packs, staff and
// four-eyes approvals, writes the platform audit log only through append_audit, and reaches no
// tenant data and no sign-in secret. A stage that needs more adds it here, on purpose.

const EXPECTED = [
  'platform.addons INSERT',
  'platform.addons SELECT',
  'platform.addons UPDATE',
  'platform.catalogue_features SELECT',
  'platform.catalogue_features UPDATE (countries, description, display_name, display_order, icon, status_override, updated_at, updated_by)',
  'platform.catalogue_modules SELECT',
  'platform.catalogue_modules UPDATE (description, display_name, display_order, icon, updated_at, updated_by)',
  'platform.catalogue_permissions SELECT',
  'platform.country_packs INSERT',
  'platform.country_packs SELECT',
  'platform.country_packs UPDATE',
  'platform.industry_templates INSERT',
  'platform.industry_templates SELECT',
  'platform.industry_templates UPDATE',
  'platform.plans INSERT',
  'platform.plans SELECT',
  'platform.plans UPDATE',
  'platform.platform_audit_log SELECT',
  'platform.staff_approvals INSERT',
  'platform.staff_approvals SELECT',
  'platform.staff_approvals UPDATE',
  'platform.staff_role_assignments DELETE',
  'platform.staff_role_assignments INSERT',
  'platform.staff_role_assignments SELECT',
  'platform.staff_roles SELECT',
  'platform.staff_users INSERT',
  'platform.staff_users SELECT',
  'platform.staff_users UPDATE (name, status, updated_at, version)',
  'platform.tenants SELECT (code, country, created_at, display_name, id, industry_key, legal_name, slug, status, template_key, template_version)',
];

let owner: pg.Client;
let platform: pg.Client;

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_platform_role');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  platform = new pg.Client({ connectionString: db.platformUrl });
  await Promise.all([owner.connect(), platform.connect()]);
}, 120_000);

afterAll(async () => {
  await Promise.all([owner?.end(), platform?.end()]);
});

describe('app_platform privileges', () => {
  it('holds exactly the grants of the console', async () => {
    expect((await grantsOf(owner, 'app_platform')).sort()).toEqual([...EXPECTED].sort());
  });

  it('never bypasses RLS and is no superuser', async () => {
    const { rows } = await owner.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_platform'`,
    );
    expect(rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
  });

  it.each([
    'SELECT * FROM identity.users',
    'SELECT * FROM identity.credentials',
    'SELECT * FROM platform.staff_credentials',
    'SELECT * FROM platform.staff_setup_tokens',
    'SELECT * FROM platform.staff_sessions',
    'SELECT * FROM app.memberships',
    'SELECT * FROM platform.tenant_entitlements',
    'SELECT owner_user_id FROM platform.tenants',
    'SELECT * FROM platform._prisma_migrations',
    "UPDATE platform.catalogue_features SET name = 'renamed'",
    "UPDATE platform.catalogue_features SET requires = '{}'",
    'DELETE FROM platform.plans',
    'DELETE FROM platform.industry_templates',
    'DELETE FROM platform.staff_approvals',
    "UPDATE platform.staff_users SET email = 'x@example.com'",
  ])('is refused: %s', async (sql) => {
    await expect(platform.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  it('calls append_audit and verify_audit_chain', async () => {
    await platform.query(
      `SELECT platform.append_audit($1, NULL, 'test.platform_role', NULL, 'test', 'x', NULL, NULL, 'test', NULL)`,
      [uuidv7()],
    );
    const { rows } = await platform.query('SELECT * FROM platform.verify_audit_chain()');
    expect(rows[0].first_broken_seq).toBeNull();
  });
});

describe('rules on the console’s rows', () => {
  async function staff(name: string): Promise<string> {
    const id = uuidv7();
    await owner.query(
      `INSERT INTO platform.staff_users (id, email, email_normalized, name) VALUES ($1, $2, $2, $3)`,
      [id, `${name}-${id.slice(-6)}@example.com`, name],
    );
    return id;
  }

  it('refuses an approval decided by the person who asked for it', async () => {
    const a = await staff('requester');
    const id = uuidv7();
    await platform.query(
      `INSERT INTO platform.staff_approvals (id, action, target_type, target_id, reason, requested_by, expires_at)
       VALUES ($1, 'template.publish', 'industry_template', 'restaurant_cafe@1.0.1', 'test', $2, now() + interval '7 days')`,
      [id, a],
    );
    await expect(
      platform.query(
        `UPDATE platform.staff_approvals SET status = 'approved', decided_by = requested_by, decided_at = now() WHERE id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ constraint: 'staff_approvals_not_self_check' });
  });

  it('keeps one published version per template and per country pack', async () => {
    const insert = (version: string) =>
      platform.query(
        `INSERT INTO platform.industry_templates (key, version, status, definition) VALUES ('test_t', $1, 'published', '{}')`,
        [version],
      );
    await insert('1.0.0');
    await expect(insert('1.1.0')).rejects.toMatchObject({
      constraint: 'industry_templates_one_published',
    });
    await expect(
      platform.query(
        `INSERT INTO platform.country_packs (country, version, status, effective_from, data) VALUES ('pk', '1.0', 'draft', '2026-07-01', '{}')`,
      ),
    ).rejects.toMatchObject({ constraint: 'country_packs_country_check' });
  });

  it('accepts only known feature statuses and two-letter countries in display fields', async () => {
    await owner.query(
      `INSERT INTO platform.catalogue_modules (key, name, category, group_name, status, sort_order, synced_at)
       VALUES ('tm', 'Test', 'business', 'Test', 'preview', 1, now())`,
    );
    await owner.query(
      `INSERT INTO platform.catalogue_features (key, module_key, name, release, status, always_on, requires, requires_any_of,
         recommends, conflicts, limits, scopes, menu, sort_order, synced_at)
       VALUES ('tm.one', 'tm', 'One', 'R1', 'preview', false, '{}', '{}', '{}', '{}', '{}', '{}', '[]', 1, now())`,
    );
    await platform.query(
      `UPDATE platform.catalogue_features SET status_override = 'beta', countries = '{PK,AE}' WHERE key = 'tm.one'`,
    );
    await expect(
      platform.query(
        `UPDATE platform.catalogue_features SET status_override = 'live' WHERE key = 'tm.one'`,
      ),
    ).rejects.toMatchObject({ constraint: 'catalogue_features_status_override_check' });
    await expect(
      platform.query(
        `UPDATE platform.catalogue_features SET countries = '{Pakistan}' WHERE key = 'tm.one'`,
      ),
    ).rejects.toMatchObject({ constraint: 'catalogue_features_countries_check' });
  });
});
