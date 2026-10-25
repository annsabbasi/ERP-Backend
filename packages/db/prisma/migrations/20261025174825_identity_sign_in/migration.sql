/*
  Warnings:

  - Added the required column `expires_at` to the `sessions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "identity"."credentials" ADD COLUMN     "single_factor_ok" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "identity"."mfa_factors" ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_used_step" BIGINT;

-- AlterTable
ALTER TABLE "identity"."password_resets" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'reset';

-- AlterTable
ALTER TABLE "identity"."sessions" ADD COLUMN     "amr" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "client" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN     "device_hash" TEXT,
ADD COLUMN     "expires_at" TIMESTAMPTZ(6) NOT NULL,
ADD COLUMN     "mfa_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "revoke_reason" TEXT;

-- CreateTable
CREATE TABLE "staff_credentials" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'password',
    "hash" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "single_factor_ok" BOOLEAN NOT NULL DEFAULT false,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_mfa_factors" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "secret" BYTEA,
    "public_key" BYTEA,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "disabled_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_recovery_codes" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'web',
    "ip" INET,
    "user_agent" TEXT,
    "device_hash" TEXT,
    "amr" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mfa_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_setup_tokens" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'setup',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_login_attempts" (
    "id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "ip" INET,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "staff_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."email_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "new_email" TEXT NOT NULL,
    "new_email_normalized" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_credentials_staff_user_id_kind_key" ON "staff_credentials"("staff_user_id", "kind");

-- CreateIndex
CREATE INDEX "staff_mfa_factors_staff_user_id_idx" ON "staff_mfa_factors"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_recovery_codes_staff_user_id_idx" ON "staff_recovery_codes"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_sessions_staff_user_id_idx" ON "staff_sessions"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_refresh_tokens_token_hash_key" ON "staff_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_refresh_tokens_family_id_idx" ON "staff_refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_setup_tokens_token_hash_key" ON "staff_setup_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "staff_setup_tokens_staff_user_id_idx" ON "staff_setup_tokens"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_login_attempts_email_normalized_at_idx" ON "staff_login_attempts"("email_normalized", "at");

-- CreateIndex
CREATE UNIQUE INDEX "email_changes_token_hash_key" ON "identity"."email_changes"("token_hash");

-- CreateIndex
CREATE INDEX "email_changes_user_id_idx" ON "identity"."email_changes"("user_id");

-- AddForeignKey
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_mfa_factors" ADD CONSTRAINT "staff_mfa_factors_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_recovery_codes" ADD CONSTRAINT "staff_recovery_codes_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_refresh_tokens" ADD CONSTRAINT "staff_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "staff_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_setup_tokens" ADD CONSTRAINT "staff_setup_tokens_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."email_changes" ADD CONSTRAINT "email_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Rules on the new columns and tables ─────────────────────────────────────────────────
ALTER TABLE "platform"."staff_users" DROP CONSTRAINT "staff_users_status_check",
  ADD CONSTRAINT "staff_users_status_check" CHECK ("status" IN ('invited', 'active', 'suspended', 'removed'));
ALTER TABLE "identity"."sessions"
  ADD CONSTRAINT "sessions_client_check" CHECK ("client" IN ('web', 'desktop'));
ALTER TABLE "identity"."password_resets"
  ADD CONSTRAINT "password_resets_kind_check" CHECK ("kind" IN ('reset', 'lockout', 'setup'));
ALTER TABLE "platform"."staff_credentials"
  ADD CONSTRAINT "staff_credentials_kind_check" CHECK ("kind" IN ('password'));
ALTER TABLE "platform"."staff_mfa_factors"
  ADD CONSTRAINT "staff_mfa_factors_kind_check" CHECK ("kind" IN ('totp', 'webauthn'));
ALTER TABLE "platform"."staff_sessions"
  ADD CONSTRAINT "staff_sessions_client_check" CHECK ("client" IN ('web', 'desktop'));
ALTER TABLE "platform"."staff_setup_tokens"
  ADD CONSTRAINT "staff_setup_tokens_kind_check" CHECK ("kind" IN ('setup', 'reset'));

GRANT ALL ON ALL TABLES IN SCHEMA "platform", "identity" TO app_migrator;

-- ── app_auth: the only role that reaches sign-in secrets (QA finding F3, ADR 0008) ──────
-- The auth module connects as app_auth (AUTH_DATABASE_URL). It never bypasses RLS and has
-- no access to tenant data; it finds a person's companies through the lookup below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN NOBYPASSRLS;     -- the API's auth module only
  END IF;
END $$;
GRANT USAGE ON SCHEMA "identity", "platform" TO app_auth;

GRANT SELECT, UPDATE ON "identity"."users" TO app_auth;
GRANT SELECT, INSERT, UPDATE ON "identity"."credentials", "identity"."sessions",
  "identity"."refresh_tokens", "identity"."password_resets", "identity"."email_changes" TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."mfa_factors", "identity"."recovery_codes" TO app_auth;
GRANT SELECT, INSERT ON "identity"."login_attempts" TO app_auth;

-- Staff accounts are created by the operator's CLI (as the database owner), never by the API.
GRANT SELECT ON "platform"."staff_users", "platform"."staff_role_assignments",
  "platform"."staff_roles" TO app_auth;
GRANT UPDATE ("status", "last_sign_in_at", "updated_at") ON "platform"."staff_users" TO app_auth;
GRANT SELECT, INSERT, UPDATE ON "platform"."staff_credentials", "platform"."staff_sessions",
  "platform"."staff_refresh_tokens", "platform"."staff_setup_tokens" TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."staff_mfa_factors",
  "platform"."staff_recovery_codes" TO app_auth;
GRANT SELECT, INSERT ON "platform"."staff_login_attempts" TO app_auth;
GRANT EXECUTE ON FUNCTION "platform"."append_audit"(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) TO app_auth;

-- app_user, the role of every tenant request, loses identity: users are global, so even
-- reading them would show other companies' people. Invitations are tenant rows under RLS.
REVOKE ALL ON ALL TABLES IN SCHEMA "identity" FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."invitations" TO app_user;

-- ── Pre-tenant lookups for sign-in (ADR 0006) ───────────────────────────────────────────
-- A person's companies, before any tenant is set: for the workspace choice at sign-in and
-- for /auth/switch. Owned by app_ops (BYPASSRLS), executable by app_auth alone.
CREATE FUNCTION "identity"."memberships_of_user"(p_user_id uuid)
RETURNS TABLE (membership_id uuid, tenant_id uuid, tenant_code text, tenant_slug text,
               tenant_name text, tenant_status text, kind text, status text,
               display_name text, permissions_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = identity, pg_temp AS $fn$
  SELECT m.id, m.tenant_id, t.code, t.slug, t.display_name, t.status, m.kind, m.status,
         m.display_name, m.permissions_version
  FROM app.memberships m JOIN platform.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
  ORDER BY t.display_name, m.id
$fn$;

-- Whether any company the person works in requires MFA (gap G16): the Owner and Company
-- Admin roles always do (§5.4), and a company can require it for everyone.
CREATE FUNCTION "identity"."mfa_required_by_company"(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = identity, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM app.memberships m
    WHERE m.user_id = p_user_id AND m.status = 'active' AND (
      EXISTS (SELECT 1 FROM app.membership_roles mr
              JOIN app.roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
              WHERE mr.tenant_id = m.tenant_id AND mr.membership_id = m.id
                AND (r.is_protected OR r.key IN ('owner', 'company_admin')))
      OR EXISTS (SELECT 1 FROM app.settings s
                 WHERE s.tenant_id = m.tenant_id AND s.scope_type = 'company'
                   AND s.module_key = 'core' AND s.key = 'security.mfa_required'
                   AND s.value = 'true'::jsonb)))
$fn$;

ALTER FUNCTION "identity"."memberships_of_user"(uuid) OWNER TO app_ops;
ALTER FUNCTION "identity"."mfa_required_by_company"(uuid) OWNER TO app_ops;
REVOKE ALL ON FUNCTION "identity"."memberships_of_user"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "identity"."mfa_required_by_company"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "identity"."memberships_of_user"(uuid) TO app_auth;
GRANT EXECUTE ON FUNCTION "identity"."mfa_required_by_company"(uuid) TO app_auth;

-- What the two lookups read, column by column.
GRANT SELECT ("id", "tenant_id", "user_id", "kind", "status", "display_name", "permissions_version")
  ON "app"."memberships" TO app_ops;
GRANT SELECT ("id", "code", "slug", "display_name", "status") ON "platform"."tenants" TO app_ops;
GRANT SELECT ("tenant_id", "membership_id", "role_id") ON "app"."membership_roles" TO app_ops;
GRANT SELECT ("tenant_id", "id", "key", "is_protected") ON "app"."roles" TO app_ops;
GRANT SELECT ("tenant_id", "scope_type", "module_key", "key", "value") ON "app"."settings" TO app_ops;
