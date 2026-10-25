import { uuidv7 } from '@erp/contracts';
import type pg from 'pg';

// Test data for the isolation suites: one tenant with a row in every app.* table (and an
// invitation), written as the database owner so RLS does not get in the way. The isolation
// tests then look at the data as app_user.

/** Table → Prisma model, for every tenant-owned table. The schema test keeps it complete. */
export const TENANT_TABLES: Readonly<Record<string, string>> = {
  'app.legal_entities': 'LegalEntity',
  'app.branches': 'Branch',
  'app.departments': 'Department',
  'app.positions': 'Position',
  'app.teams': 'Team',
  'app.memberships': 'Membership',
  'app.team_members': 'TeamMember',
  'app.roles': 'Role',
  'app.role_grants': 'RoleGrant',
  'app.membership_roles': 'MembershipRole',
  'app.membership_exceptions': 'MembershipException',
  'app.settings': 'Setting',
  'app.audit_log': 'AuditLog',
  'app.outbox': 'OutboxEvent',
  'app.processed_events': 'ProcessedEvent',
  'app.tenant_module_state': 'TenantModuleState',
  'identity.invitations': 'Invitation',
};

export type TenantFixture = {
  tenantId: string;
  code: string;
  slug: string;
  legalEntityId: string;
  branchId: string;
  departmentId: string;
  positionId: string;
  teamId: string;
  membershipId: string;
  roleId: string;
  invitationId: string;
  invitationTokenHash: string;
};

let counter = 0;
function code(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let n = Date.now() * 100 + (counter++ % 100);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = alphabet[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return `T-${out}`;
}

/** Creates a tenant and one row in every tenant-owned table. */
export async function createTenantWithData(
  owner: pg.Client,
  label: string,
): Promise<TenantFixture> {
  const f: TenantFixture = {
    tenantId: uuidv7(),
    code: code(),
    slug: `${label}-${Date.now().toString(36)}-${counter}`,
    legalEntityId: uuidv7(),
    branchId: uuidv7(),
    departmentId: uuidv7(),
    positionId: uuidv7(),
    teamId: uuidv7(),
    membershipId: uuidv7(),
    roleId: uuidv7(),
    invitationId: uuidv7(),
    invitationTokenHash: `${label}-${uuidv7()}`.padEnd(64, '0').slice(0, 64),
  };
  const t = f.tenantId;
  const q = (sql: string, params: unknown[]) => owner.query(sql, params);

  await q(
    `INSERT INTO platform.tenants (id, code, slug, display_name, legal_name, country, base_currency,
       timezone, industry_key, status, region)
     VALUES ($1, $2, $3, $4, $4, 'PK', 'PKR', 'Asia/Karachi', 'restaurant', 'active', 'ap-southeast-1')`,
    [t, f.code, f.slug, `Test ${label}`],
  );
  await q(
    `INSERT INTO app.legal_entities (id, tenant_id, legal_name, base_currency) VALUES ($1, $2, $3, 'PKR')`,
    [f.legalEntityId, t, `Test ${label} (Pvt) Ltd`],
  );
  await q(
    `INSERT INTO app.branches (id, tenant_id, legal_entity_id, name, code, type) VALUES ($1, $2, $3, $4, 'MAIN', 'outlet')`,
    [f.branchId, t, f.legalEntityId, `${label} main`],
  );
  await q(
    `INSERT INTO app.departments (id, tenant_id, name, code) VALUES ($1, $2, 'Kitchen', 'KIT')`,
    [f.departmentId, t],
  );
  await q(
    `INSERT INTO app.positions (id, tenant_id, title, department_id) VALUES ($1, $2, 'Chef', $3)`,
    [f.positionId, t, f.departmentId],
  );
  await q(`INSERT INTO app.teams (id, tenant_id, name) VALUES ($1, $2, 'Evening shift')`, [
    f.teamId,
    t,
  ]);
  await q(
    `INSERT INTO app.memberships (id, tenant_id, kind, display_name, status, primary_branch_id, department_id)
     VALUES ($1, $2, 'device', $3, 'active', $4, $5)`,
    [f.membershipId, t, `${label} waiter`, f.branchId, f.departmentId],
  );
  await q(`INSERT INTO app.team_members (tenant_id, team_id, membership_id) VALUES ($1, $2, $3)`, [
    t,
    f.teamId,
    f.membershipId,
  ]);
  await q(
    `INSERT INTO app.roles (id, tenant_id, key, name, origin) VALUES ($1, $2, 'waiter', 'Waiter', 'template')`,
    [f.roleId, t],
  );
  await q(
    `INSERT INTO app.role_grants (tenant_id, role_id, permission_key, scope_type) VALUES ($1, $2, 'restaurant.orders.create', 'assigned')`,
    [t, f.roleId],
  );
  await q(
    `INSERT INTO app.membership_roles (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)`,
    [t, f.membershipId, f.roleId],
  );
  await q(
    `INSERT INTO app.membership_exceptions (id, tenant_id, membership_id, permission_key, effect, expires_at, reason)
     VALUES ($1, $2, $3, 'restaurant.bills.reprint', 'allow', now() + interval '1 day', 'test')`,
    [uuidv7(), t, f.membershipId],
  );
  await q(
    `INSERT INTO app.settings (id, tenant_id, scope_type, scope_id, module_key, key, value)
     VALUES ($1, $2, 'company', $2, 'core', 'locale', '"en"')`,
    [uuidv7(), t],
  );
  await q(
    `INSERT INTO app.audit_log (id, tenant_id, action, record_type) VALUES ($1, $2, 'test.created', 'tenant')`,
    [uuidv7(), t],
  );
  const eventId = uuidv7();
  await q(`INSERT INTO app.outbox (id, tenant_id, type) VALUES ($1, $2, 'test.happened')`, [
    eventId,
    t,
  ]);
  await q(
    `INSERT INTO app.processed_events (tenant_id, consumer, event_id) VALUES ($1, 'test', $2)`,
    [t, eventId],
  );
  await q(
    `INSERT INTO app.tenant_module_state (tenant_id, module_key, status, version) VALUES ($1, 'restaurant', 'installed', '0')`,
    [t],
  );
  await q(
    `INSERT INTO identity.invitations (id, tenant_id, membership_id, email, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, 'member', $5, now() + interval '7 days')`,
    [f.invitationId, t, f.membershipId, `${label}@example.com`, f.invitationTokenHash],
  );
  return f;
}
