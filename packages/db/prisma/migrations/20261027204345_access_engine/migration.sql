-- Access engine (Part 02 §2.11–2.12, Part 10 §10.7.2–10.7.3). Two version numbers move whenever
-- what a member may do can change, and together they are the access token's pv: the member's
-- permissions_version (roles, grants, exceptions, branch, department, status) and the tenant's
-- entitlements_version (entitlements, limits, status). Triggers keep them moving whoever writes,
-- so no code path can change access and forget to say so. Read-only views give app_user its own
-- tenant's entitlements and limits, and nothing of other tenants.

-- Prisma proposes dropping the same-tenant foreign keys (written in SQL, see migration
-- tenant_safe_references) in every migration; those lines are removed by hand.

-- ── Tenant entitlements version ──────────────────────────────────────────────────────────────

ALTER TABLE "platform"."tenants" ADD COLUMN "entitlements_version" INTEGER NOT NULL DEFAULT 1;

-- A status change changes what everyone in the company may do (read-only, Owner only).
CREATE FUNCTION "platform"."tenants_status_bumps_version"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.entitlements_version := OLD.entitlements_version + 1;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION "platform"."tenants_status_bumps_version"() FROM PUBLIC;
CREATE TRIGGER "tenants_status_bumps_version" BEFORE UPDATE OF "status" ON "platform"."tenants"
  FOR EACH ROW EXECUTE FUNCTION "platform"."tenants_status_bumps_version"();

-- Entitlement and limit rows: whoever writes them, the tenant's version moves. SECURITY DEFINER
-- so the writer needs no UPDATE right on platform.tenants.
CREATE FUNCTION "platform"."bump_entitlements_version"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE platform.tenants SET entitlements_version = entitlements_version + 1
    WHERE id = OLD.tenant_id;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    UPDATE platform.tenants SET entitlements_version = entitlements_version + 1
    WHERE id = NEW.tenant_id;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION "platform"."bump_entitlements_version"() FROM PUBLIC;
CREATE TRIGGER "tenant_entitlements_bump_version"
  AFTER INSERT OR UPDATE OR DELETE ON "platform"."tenant_entitlements"
  FOR EACH ROW EXECUTE FUNCTION "platform"."bump_entitlements_version"();
CREATE TRIGGER "tenant_limits_bump_version"
  AFTER INSERT OR UPDATE OR DELETE ON "platform"."tenant_limits"
  FOR EACH ROW EXECUTE FUNCTION "platform"."bump_entitlements_version"();

-- ── Membership permissions version ───────────────────────────────────────────────────────────
-- These run as the writer (app_user under RLS), inside the writer's tenant.

-- The membership's own branch, department and status decide its default scopes.
CREATE FUNCTION "app"."memberships_bump_version"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.primary_branch_id IS DISTINCT FROM OLD.primary_branch_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.permissions_version := OLD.permissions_version + 1;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION "app"."memberships_bump_version"() FROM PUBLIC;
CREATE TRIGGER "memberships_bump_version"
  BEFORE UPDATE OF "primary_branch_id", "department_id", "status" ON "app"."memberships"
  FOR EACH ROW EXECUTE FUNCTION "app"."memberships_bump_version"();

-- Roles given to a membership, and per-member exceptions.
CREATE FUNCTION "app"."bump_membership_version"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE app.memberships SET permissions_version = permissions_version + 1
    WHERE tenant_id = OLD.tenant_id AND id = OLD.membership_id;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.membership_id IS DISTINCT FROM OLD.membership_id) THEN
    UPDATE app.memberships SET permissions_version = permissions_version + 1
    WHERE tenant_id = NEW.tenant_id AND id = NEW.membership_id;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION "app"."bump_membership_version"() FROM PUBLIC;
CREATE TRIGGER "membership_roles_bump_version"
  AFTER INSERT OR UPDATE OR DELETE ON "app"."membership_roles"
  FOR EACH ROW EXECUTE FUNCTION "app"."bump_membership_version"();
CREATE TRIGGER "membership_exceptions_bump_version"
  AFTER INSERT OR UPDATE OR DELETE ON "app"."membership_exceptions"
  FOR EACH ROW EXECUTE FUNCTION "app"."bump_membership_version"();

-- A role's grants, key, protection or archiving: every member holding the role.
CREATE FUNCTION "app"."bump_role_members"(p_tenant_id uuid, p_role_id uuid) RETURNS void
LANGUAGE sql AS $fn$
  UPDATE app.memberships m SET permissions_version = m.permissions_version + 1
  FROM app.membership_roles mr
  WHERE mr.tenant_id = p_tenant_id AND mr.role_id = p_role_id
    AND m.tenant_id = mr.tenant_id AND m.id = mr.membership_id
$fn$;
REVOKE ALL ON FUNCTION "app"."bump_role_members"(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."bump_role_members"(uuid, uuid) TO app_user;

CREATE FUNCTION "app"."role_grants_bump_version"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM app.bump_role_members(OLD.tenant_id, OLD.role_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id) THEN
    PERFORM app.bump_role_members(NEW.tenant_id, NEW.role_id);
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION "app"."role_grants_bump_version"() FROM PUBLIC;
CREATE TRIGGER "role_grants_bump_version"
  AFTER INSERT OR UPDATE OR DELETE ON "app"."role_grants"
  FOR EACH ROW EXECUTE FUNCTION "app"."role_grants_bump_version"();

CREATE FUNCTION "app"."roles_bump_version"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM app.bump_role_members(OLD.tenant_id, OLD.id);
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION "app"."roles_bump_version"() FROM PUBLIC;
CREATE TRIGGER "roles_bump_version"
  AFTER UPDATE OF "key", "is_protected", "archived_at" OR DELETE ON "app"."roles"
  FOR EACH ROW EXECUTE FUNCTION "app"."roles_bump_version"();

-- ── The current tenant's control-plane rows, for app_user ────────────────────────────────────
-- §10.5.3: app_user reads platform tables only through views. Each view shows the tenant of the
-- request's transaction (app.tenant_id) and nothing without one. security_barrier keeps a
-- caller's own conditions from running before the tenant filter.

CREATE VIEW "platform"."current_tenant" WITH (security_barrier) AS
  SELECT "id", "code", "status", "industry_key", "country", "entitlements_version"
  FROM "platform"."tenants"
  WHERE "id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid;

CREATE VIEW "platform"."current_tenant_entitlements" WITH (security_barrier) AS
  SELECT "feature_key", "state", "source", "valid_from", "valid_to"
  FROM "platform"."tenant_entitlements"
  WHERE "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid;

CREATE VIEW "platform"."current_tenant_limits" WITH (security_barrier) AS
  SELECT "limit_key", "value", "source", "valid_to"
  FROM "platform"."tenant_limits"
  WHERE "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid;

GRANT SELECT ON "platform"."current_tenant", "platform"."current_tenant_entitlements",
  "platform"."current_tenant_limits" TO app_user;

-- ── Sign-in lookup: the pv parts and whether the person is the company's Owner ───────────────
-- A locked or closing company lets only its Owner sign in (Part 03 §3.7.2).

DROP FUNCTION "identity"."memberships_of_user"(uuid);
CREATE FUNCTION "identity"."memberships_of_user"(p_user_id uuid)
RETURNS TABLE (membership_id uuid, tenant_id uuid, tenant_code text, tenant_slug text,
               tenant_name text, tenant_status text, kind text, status text,
               display_name text, permissions_version integer, entitlements_version integer,
               is_owner boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = identity, pg_temp AS $fn$
  SELECT m.id, m.tenant_id, t.code, t.slug, t.display_name, t.status, m.kind, m.status,
         m.display_name, m.permissions_version, t.entitlements_version,
         EXISTS (SELECT 1 FROM app.membership_roles mr
                 JOIN app.roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
                 WHERE mr.tenant_id = m.tenant_id AND mr.membership_id = m.id
                   AND r.key = 'owner' AND r.is_protected AND r.archived_at IS NULL)
  FROM app.memberships m JOIN platform.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
  ORDER BY t.display_name, m.id
$fn$;
ALTER FUNCTION "identity"."memberships_of_user"(uuid) OWNER TO app_ops;
REVOKE ALL ON FUNCTION "identity"."memberships_of_user"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "identity"."memberships_of_user"(uuid) TO app_auth;

-- The columns the lookup now reads as well.
GRANT SELECT ("entitlements_version") ON "platform"."tenants" TO app_ops;
GRANT SELECT ("archived_at") ON "app"."roles" TO app_ops;
