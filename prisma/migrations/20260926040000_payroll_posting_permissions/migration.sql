-- The posting duty as its own permission set (see permission-catalog.ts,
-- ACCOUNTANT_SET). The catalog is normally loaded by `prisma seed`, which is a
-- script — this migration puts the two new global rows in place the reviewable
-- way, so the onboarding template's new "Accountant" and "Company Admin" role
-- bindings resolve on the first company created after deploy.
--
-- Global rows only. It does NOT attach the set to any existing company's
-- roles: who in an existing tenant may post is that tenant's (owner's)
-- decision, done through Roles & Permissions / Module Grants.
--
-- Idempotent: ON CONFLICT DO NOTHING on every insert.
--
-- It also inserts the nine catalog permissions that 20260904000000
-- (Economic Indexes, License, Utilities) added to permission-catalog.ts but
-- that never reached the live database — the catalog is only loaded by
-- `prisma seed`, which was not re-run there. Without the rows, no role can
-- hold them, so on live only a platform super admin could open those windows
-- or run Period-End Closing. (Found in QA Round 4, when the period-end suite
-- kept returning 403 even for a role holding every permission in the table.)

INSERT INTO "permissions" ("id", "key", "resource", "action", "moduleSlug", "description")
VALUES (gen_random_uuid()::TEXT, 'finance.payment.create', 'finance.payment', 'create', 'financials',
        'Pay out salaries, disburse loans/advances, remit tax')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permission_sets" ("id", "key", "name", "description", "isSystem", "companyId", "updatedAt")
VALUES (gen_random_uuid()::TEXT, 'financials.accountant', 'Financials — Accountant (posting)',
        'Post journal entries and payroll runs, and record payments. Read-only access to payroll.', true, NULL, now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permission_set_items" ("id", "setId", "permissionId", "scope")
SELECT gen_random_uuid()::TEXT, s."id", p."id", 'ALL'
FROM "permission_sets" s
JOIN "permissions" p ON p."key" IN ('financials.view', 'financials.journal.view', 'finance.journal.post',
                                     'finance.payment.create', 'hr.payroll.view')
WHERE s."key" = 'financials.accountant'
ON CONFLICT ("setId", "permissionId", "scope") DO NOTHING;

-- The nine Administration permissions missing from live (see header).
INSERT INTO "permissions" ("id", "key", "resource", "action", "moduleSlug", "description")
SELECT gen_random_uuid()::TEXT, v.key, v.resource, v.action, 'administration', v.description
FROM (VALUES
  ('administration.index.view',   'administration.index', 'view',   'View economic indexes'),
  ('administration.index.create', 'administration.index', 'create', 'Create economic indexes'),
  ('administration.index.update', 'administration.index', 'update', 'Update economic indexes'),
  ('administration.index.delete', 'administration.index', 'delete', 'Delete economic indexes'),
  ('administration.index.manage', 'administration.index', 'manage', 'Manage economic indexes'),
  ('administration.license.view',   'administration.license',   'view',    'View licenses, seat allocation and the support log'),
  ('administration.license.manage', 'administration.license',   'manage',  'Import licenses, assign seats, generate add-on identifiers'),
  ('administration.utilities.view',    'administration.utilities', 'view',    'Run Utilities reports and previews'),
  ('administration.utilities.execute', 'administration.utilities', 'execute', 'Execute period-end closing, log cleanup and client disconnects')
) v(key, resource, action, description)
ON CONFLICT ("key") DO NOTHING;
