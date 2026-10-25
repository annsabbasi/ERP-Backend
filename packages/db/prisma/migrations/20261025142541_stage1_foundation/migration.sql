-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "industry_key" TEXT NOT NULL,
    "template_key" TEXT,
    "template_version" TEXT,
    "status" TEXT NOT NULL,
    "isolation_model" TEXT NOT NULL DEFAULT 'pooled',
    "region" TEXT NOT NULL,
    "database_ref" TEXT,
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "terminated_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "certificate_status" TEXT,
    "retired_at" TIMESTAMPTZ(6),
    "redirects_until" TIMESTAMPTZ(6),
    "reusable_after" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue_modules" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalogue_modules_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "catalogue_features" (
    "key" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "always_on" BOOLEAN NOT NULL,
    "requires" TEXT[],
    "requires_any_of" TEXT[],
    "recommends" TEXT[],
    "conflicts" TEXT[],
    "limits" TEXT[],
    "scopes" TEXT[],
    "menu" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalogue_features_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "catalogue_permissions" (
    "key" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "feature_keys" TEXT[],
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalogue_permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "plans" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "feature_keys" TEXT[],
    "prices" JSONB NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "addons" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "feature_keys" TEXT[],
    "prices" JSONB NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "industry_templates" (
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_templates_pkey" PRIMARY KEY ("key","version")
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "tenant_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "reason" TEXT,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("tenant_id","feature_key","source")
);

-- CreateTable
CREATE TABLE "tenant_limits" (
    "tenant_id" UUID NOT NULL,
    "limit_key" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "valid_to" TIMESTAMPTZ(6),
    "reason" TEXT,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_limits_pkey" PRIMARY KEY ("tenant_id","limit_key","source")
);

-- CreateTable
CREATE TABLE "entitlement_change_sets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "items" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_change_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_roles" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "staff_role_assignments" (
    "staff_user_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_role_assignments_pkey" PRIMARY KEY ("staff_user_id","role_key")
);

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "seq" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "actor_staff_id" UUID,
    "action" TEXT NOT NULL,
    "target_tenant_id" UUID,
    "target_type" TEXT,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "correlation_id" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "prev_hash" BYTEA,
    "hash" BYTEA NOT NULL,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "account_kind" TEXT NOT NULL DEFAULT 'member',
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'password',
    "hash" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "secret" BYTEA,
    "public_key" BYTEA,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "membership_id" UUID,
    "device_label" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."login_attempts" (
    "id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "ip" INET,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "primary_branch_id" UUID,
    "department_id" UUID,
    "employee_id" UUID,
    "starts_on" DATE,
    "ends_on" DATE,
    "permissions_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "origin" TEXT NOT NULL,
    "template_key" TEXT,
    "is_customised" BOOLEAN NOT NULL DEFAULT false,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."role_grants" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("tenant_id","role_id","permission_key")
);

-- CreateTable
CREATE TABLE "app"."membership_roles" (
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_values" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("tenant_id","membership_id","role_id")
);

-- CreateTable
CREATE TABLE "app"."membership_exceptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "scope_type" TEXT,
    "scope_values" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "membership_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."legal_entities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "tax_ids" JSONB NOT NULL DEFAULT '{}',
    "base_currency" CHAR(3) NOT NULL,
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 7,
    "address" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" JSONB NOT NULL DEFAULT '{}',
    "phone" TEXT,
    "time_zone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "manager_membership_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parent_id" UUID,
    "head_membership_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."teams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lead_membership_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."team_members" (
    "tenant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("tenant_id","team_id","membership_id")
);

-- CreateTable
CREATE TABLE "app"."positions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "grade" TEXT,
    "department_id" UUID,
    "reports_to_position_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_membership_id" UUID,
    "actor_staff_id" UUID,
    "support_grant_id" UUID,
    "action" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "device_id" UUID,
    "correlation_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT,
    "aggregate_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."processed_events" (
    "tenant_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("tenant_id","consumer","event_id")
);

-- CreateTable
CREATE TABLE "app"."tenant_module_state" (
    "tenant_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "tenant_module_state_pkey" PRIMARY KEY ("tenant_id","module_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

-- CreateIndex
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains"("tenant_id");

-- CreateIndex
CREATE INDEX "catalogue_features_module_key_idx" ON "catalogue_features"("module_key");

-- CreateIndex
CREATE INDEX "catalogue_permissions_module_key_idx" ON "catalogue_permissions"("module_key");

-- CreateIndex
CREATE INDEX "entitlement_change_sets_tenant_id_idx" ON "entitlement_change_sets"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_normalized_key" ON "staff_users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "platform_audit_log_seq_key" ON "platform_audit_log"("seq");

-- CreateIndex
CREATE INDEX "platform_audit_log_target_tenant_id_idx" ON "platform_audit_log"("target_tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_account_kind_key" ON "identity"."users"("email_normalized", "account_kind");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_user_id_kind_key" ON "identity"."credentials"("user_id", "kind");

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_idx" ON "identity"."mfa_factors"("user_id");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "identity"."recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "identity"."sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "identity"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "identity"."refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "identity"."invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_membership_id_idx" ON "identity"."invitations"("tenant_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "identity"."password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "password_resets_user_id_idx" ON "identity"."password_resets"("user_id");

-- CreateIndex
CREATE INDEX "login_attempts_email_normalized_at_idx" ON "identity"."login_attempts"("email_normalized", "at");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_id_key" ON "app"."memberships"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "app"."memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "app"."roles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "app"."roles"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "membership_exceptions_tenant_id_membership_id_idx" ON "app"."membership_exceptions"("tenant_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_entities_tenant_id_id_key" ON "app"."legal_entities"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "app"."branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "app"."branches"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_id_key" ON "app"."departments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_code_key" ON "app"."departments"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "teams_tenant_id_id_key" ON "app"."teams"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_tenant_id_id_key" ON "app"."positions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_tenant_id_scope_type_scope_id_module_key_key_key" ON "app"."settings"("tenant_id", "scope_type", "scope_id", "module_key", "key");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_at_idx" ON "app"."audit_log"("tenant_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_record_type_record_id_idx" ON "app"."audit_log"("tenant_id", "record_type", "record_id");

-- CreateIndex
CREATE INDEX "outbox_dispatched_at_occurred_at_idx" ON "app"."outbox"("dispatched_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_features" ADD CONSTRAINT "catalogue_features_module_key_fkey" FOREIGN KEY ("module_key") REFERENCES "catalogue_modules"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_limits" ADD CONSTRAINT "tenant_limits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "staff_roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."credentials" ADD CONSTRAINT "credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "identity"."sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_primary_branch_id_fkey" FOREIGN KEY ("primary_branch_id") REFERENCES "app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "app"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_grants" ADD CONSTRAINT "role_grants_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "app"."roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "app"."roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."membership_exceptions" ADD CONSTRAINT "membership_exceptions_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."branches" ADD CONSTRAINT "branches_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "app"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_tenant_id_team_id_fkey" FOREIGN KEY ("tenant_id", "team_id") REFERENCES "app"."teams"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."positions" ADD CONSTRAINT "positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "app"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."positions" ADD CONSTRAINT "positions_reports_to_position_id_fkey" FOREIGN KEY ("reports_to_position_id") REFERENCES "app"."positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Written by hand from here on: what Prisma does not model (Part 10 §10.5, Part 11 §11.1,
-- §11.6). Schema public is never touched.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ── CHECK constraints for status and kind columns (§11.1) ──────────────────────────────
ALTER TABLE "platform"."tenants"
  ADD CONSTRAINT "tenants_status_check" CHECK ("status" IN ('provisioning', 'trial', 'trial_expired',
    'active', 'past_due', 'suspended_read_only', 'suspended_locked', 'pending_termination', 'terminated')),
  ADD CONSTRAINT "tenants_isolation_model_check" CHECK ("isolation_model" IN ('pooled', 'dedicated')),
  ADD CONSTRAINT "tenants_code_check" CHECK ("code" ~ '^T-[0-9A-HJKMNP-TV-Z]{6}$'),
  ADD CONSTRAINT "tenants_slug_check" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
ALTER TABLE "platform"."tenant_domains"
  ADD CONSTRAINT "tenant_domains_kind_check" CHECK ("kind" IN ('slug', 'custom'));
ALTER TABLE "platform"."catalogue_modules"
  ADD CONSTRAINT "catalogue_modules_category_check" CHECK ("category" IN ('core', 'business', 'industry', 'addon', 'localization')),
  ADD CONSTRAINT "catalogue_modules_status_check" CHECK ("status" IN ('ga', 'beta', 'preview', 'deprecated'));
ALTER TABLE "platform"."catalogue_features"
  ADD CONSTRAINT "catalogue_features_release_check" CHECK ("release" IN ('R1', 'R2', 'R3', 'later')),
  ADD CONSTRAINT "catalogue_features_status_check" CHECK ("status" IN ('ga', 'beta', 'preview', 'deprecated'));
ALTER TABLE "platform"."plans"
  ADD CONSTRAINT "plans_visibility_check" CHECK ("visibility" IN ('public', 'private'));
ALTER TABLE "platform"."addons"
  ADD CONSTRAINT "addons_visibility_check" CHECK ("visibility" IN ('public', 'private'));
ALTER TABLE "platform"."industry_templates"
  ADD CONSTRAINT "industry_templates_status_check" CHECK ("status" IN ('draft', 'in_review', 'published', 'deprecated'));
ALTER TABLE "platform"."tenant_entitlements"
  ADD CONSTRAINT "tenant_entitlements_state_check" CHECK ("state" IN ('on', 'read_only', 'off')),
  ADD CONSTRAINT "tenant_entitlements_source_check" CHECK ("source" IN ('plan', 'template', 'addon', 'manual', 'trial'));
ALTER TABLE "platform"."tenant_limits"
  ADD CONSTRAINT "tenant_limits_source_check" CHECK ("source" IN ('plan', 'template', 'addon', 'manual', 'trial')),
  ADD CONSTRAINT "tenant_limits_value_check" CHECK ("value" >= 0);
ALTER TABLE "platform"."staff_users"
  ADD CONSTRAINT "staff_users_status_check" CHECK ("status" IN ('active', 'suspended', 'removed'));
ALTER TABLE "platform"."platform_audit_log"
  ADD CONSTRAINT "platform_audit_log_result_check" CHECK ("result" IN ('success', 'failure'));

ALTER TABLE "identity"."users"
  ADD CONSTRAINT "users_account_kind_check" CHECK ("account_kind" IN ('member', 'portal')),
  ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('invited', 'active', 'locked', 'deleted'));
ALTER TABLE "identity"."credentials"
  ADD CONSTRAINT "credentials_kind_check" CHECK ("kind" IN ('password'));
ALTER TABLE "identity"."mfa_factors"
  ADD CONSTRAINT "mfa_factors_kind_check" CHECK ("kind" IN ('totp', 'webauthn'));
ALTER TABLE "identity"."sessions"
  ADD CONSTRAINT "sessions_audience_check" CHECK ("audience" IN ('app', 'console', 'device', 'support', 'portal'));
ALTER TABLE "identity"."invitations"
  ADD CONSTRAINT "invitations_kind_check" CHECK ("kind" IN ('owner', 'member', 'portal'));

ALTER TABLE "app"."memberships"
  ADD CONSTRAINT "memberships_kind_check" CHECK ("kind" IN ('member', 'device', 'portal')),
  ADD CONSTRAINT "memberships_status_check" CHECK ("status" IN ('invited', 'expired', 'active', 'suspended', 'deactivated'));
ALTER TABLE "app"."roles"
  ADD CONSTRAINT "roles_origin_check" CHECK ("origin" IN ('template', 'custom'));
ALTER TABLE "app"."role_grants"
  ADD CONSTRAINT "role_grants_scope_type_check" CHECK ("scope_type" IN ('own', 'assigned', 'team', 'department', 'branch', 'legal_entity', 'company'));
ALTER TABLE "app"."membership_exceptions"
  ADD CONSTRAINT "membership_exceptions_effect_check" CHECK ("effect" IN ('allow', 'deny')),
  ADD CONSTRAINT "membership_exceptions_scope_type_check" CHECK ("scope_type" IN ('own', 'assigned', 'team', 'department', 'branch', 'legal_entity', 'company'));
ALTER TABLE "app"."legal_entities"
  ADD CONSTRAINT "legal_entities_fiscal_year_start_month_check" CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12);
ALTER TABLE "app"."branches"
  ADD CONSTRAINT "branches_type_check" CHECK ("type" IN ('outlet', 'campus', 'store', 'warehouse', 'office', 'site', 'clinic', 'project')),
  ADD CONSTRAINT "branches_status_check" CHECK ("status" IN ('active', 'closed'));
ALTER TABLE "app"."settings"
  ADD CONSTRAINT "settings_scope_type_check" CHECK ("scope_type" IN ('company', 'legal_entity', 'branch', 'role', 'membership'));
ALTER TABLE "app"."tenant_module_state"
  ADD CONSTRAINT "tenant_module_state_status_check" CHECK ("status" IN ('installing', 'installed', 'disabled', 'failed'));

-- ── Database roles (§10.5.3) ────────────────────────────────────────────────────────────
-- Created without LOGIN. Each environment gives them a password outside the migrations
-- (locally and in CI: pnpm --filter @erp/db db:local-roles).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;     -- API and workers
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator NOLOGIN NOBYPASSRLS; -- migrations on hosted databases
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_ops') THEN
    CREATE ROLE app_ops NOLOGIN BYPASSRLS;        -- audited jobs only: provisioning, exports, outbox
  END IF;
END $$;

REVOKE ALL ON SCHEMA "platform", "identity", "app" FROM PUBLIC;
GRANT USAGE ON SCHEMA "platform", "identity", "app" TO app_user, app_ops, app_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA "platform", "identity", "app" TO app_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA "platform", "identity", "app" TO app_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "platform", "identity" TO app_ops;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "platform" TO app_ops;

-- app_user reads only the global catalogue and flags in platform (§10.5.2); everything else
-- there is reached through functions or, from Stage 3, views.
GRANT SELECT ON "platform"."catalogue_modules", "platform"."catalogue_features",
  "platform"."catalogue_permissions", "platform"."feature_flags" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "identity" TO app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON "platform"."platform_audit_log" FROM app_ops;

-- ── Row-Level Security on every app.* table (§10.5.3) ───────────────────────────────────
-- NULLIF: a pooled connection that once held a tenant keeps app.tenant_id = '' afterwards;
-- that must mean "no tenant" (0 rows), not an invalid-uuid error. Every later migration that
-- adds app.* tables ends with SELECT platform.secure_tenant_tables();
CREATE FUNCTION "platform"."secure_tenant_tables"() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  secured integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel, c.relname AS name
    FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'app' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t.rel);
    IF NOT EXISTS (SELECT FROM pg_policies
                   WHERE schemaname = 'app' AND tablename = t.name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %s
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t.rel);
    END IF;
    IF coalesce(obj_description(t.rel, 'pg_class'), '') LIKE '%@append-only%' THEN
      EXECUTE format('GRANT SELECT, INSERT ON %s TO app_user, app_ops', t.rel);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM app_user, app_ops', t.rel);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user, app_ops', t.rel);
    END IF;
    secured := secured + 1;
  END LOOP;
  RETURN secured;
END $fn$;
REVOKE ALL ON FUNCTION "platform"."secure_tenant_tables"() FROM PUBLIC;

COMMENT ON TABLE "app"."audit_log" IS 'Company audit log (Part 04 §4.19). @append-only';
SELECT "platform"."secure_tenant_tables"();

-- identity.invitations is tenant-owned too.
ALTER TABLE "identity"."invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity"."invitations"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── Append-only audit logs (Part 03 §3.17, Part 04 §4.19) ───────────────────────────────
CREATE FUNCTION "platform"."refuse_change"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $fn$;
REVOKE ALL ON FUNCTION "platform"."refuse_change"() FROM PUBLIC;

CREATE TRIGGER "append_only" BEFORE UPDATE OR DELETE ON "app"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION "platform"."refuse_change"();
CREATE TRIGGER "append_only_truncate" BEFORE TRUNCATE ON "app"."audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "platform"."refuse_change"();
CREATE TRIGGER "append_only" BEFORE UPDATE OR DELETE ON "platform"."platform_audit_log"
  FOR EACH ROW EXECUTE FUNCTION "platform"."refuse_change"();
CREATE TRIGGER "append_only_truncate" BEFORE TRUNCATE ON "platform"."platform_audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "platform"."refuse_change"();

-- ── Platform audit hash chain (§3.17, gap G12) ──────────────────────────────────────────
-- hash = sha256(prev_hash || canonical entry). jsonb text output is deterministic.
CREATE FUNCTION "platform"."audit_entry_hash"(
  p_prev bytea, p_id uuid, p_at timestamptz, p_actor_staff_id uuid, p_action text,
  p_target_tenant_id uuid, p_target_type text, p_target_id text, p_before jsonb,
  p_after jsonb, p_reason text, p_correlation_id text, p_result text
) RETURNS bytea
LANGUAGE sql STABLE AS $fn$
  SELECT sha256(coalesce(p_prev, ''::bytea) || convert_to(jsonb_build_object(
    'id', p_id,
    'at', to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_staff_id', p_actor_staff_id,
    'action', p_action,
    'target_tenant_id', p_target_tenant_id,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'before', p_before,
    'after', p_after,
    'reason', p_reason,
    'correlation_id', p_correlation_id,
    'result', p_result
  )::text, 'UTF8'))
$fn$;

-- The advisory lock serialises writers, so parallel inserts cannot fork the chain.
CREATE FUNCTION "platform"."append_audit"(
  p_id uuid, p_actor_staff_id uuid, p_action text, p_target_tenant_id uuid,
  p_target_type text, p_target_id text, p_before jsonb, p_after jsonb, p_reason text,
  p_correlation_id text, p_result text DEFAULT 'success'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
DECLARE
  v_prev bytea;
  v_at timestamptz;
  v_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform.platform_audit_log', 0));
  v_at := clock_timestamp();
  SELECT l.hash INTO v_prev FROM platform.platform_audit_log l ORDER BY l.seq DESC LIMIT 1;
  INSERT INTO platform.platform_audit_log (id, at, actor_staff_id, action, target_tenant_id,
    target_type, target_id, before, after, reason, correlation_id, result, prev_hash, hash)
  VALUES (p_id, v_at, p_actor_staff_id, p_action, p_target_tenant_id, p_target_type,
    p_target_id, p_before, p_after, p_reason, p_correlation_id, p_result, v_prev,
    platform.audit_entry_hash(v_prev, p_id, v_at, p_actor_staff_id, p_action,
      p_target_tenant_id, p_target_type, p_target_id, p_before, p_after, p_reason,
      p_correlation_id, p_result))
  RETURNING seq INTO v_seq;
  RETURN v_seq;
END $fn$;

-- (entries checked, first broken seq or NULL)
CREATE FUNCTION "platform"."verify_audit_chain"()
RETURNS TABLE (checked bigint, first_broken_seq bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
DECLARE
  r record;
  v_prev bytea := NULL;
  v_count bigint := 0;
BEGIN
  FOR r IN SELECT * FROM platform.platform_audit_log ORDER BY seq LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev OR r.hash <> platform.audit_entry_hash(v_prev, r.id,
         r.at, r.actor_staff_id, r.action, r.target_tenant_id, r.target_type, r.target_id,
         r.before, r.after, r.reason, r.correlation_id, r.result) THEN
      RETURN QUERY SELECT v_count, r.seq;
      RETURN;
    END IF;
    v_prev := r.hash;
    v_count := v_count + 1;
  END LOOP;
  RETURN QUERY SELECT v_count, NULL::bigint;
END $fn$;

GRANT SELECT, INSERT ON "platform"."platform_audit_log" TO app_ops;
ALTER FUNCTION "platform"."append_audit"(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) OWNER TO app_ops;
ALTER FUNCTION "platform"."verify_audit_chain"() OWNER TO app_ops;
REVOKE ALL ON FUNCTION "platform"."audit_entry_hash"(bytea, uuid, timestamptz, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "platform"."append_audit"(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "platform"."verify_audit_chain"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "platform"."audit_entry_hash"(bytea, uuid, timestamptz, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) TO app_ops;
GRANT EXECUTE ON FUNCTION "platform"."append_audit"(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) TO app_user, app_ops;
GRANT EXECUTE ON FUNCTION "platform"."verify_audit_chain"() TO app_user, app_ops;

-- ── Pre-tenant lookups (ADR 0006, gap G15) ──────────────────────────────────────────────
-- Before a tenant is known (an invitation link is opened), this narrow function maps the
-- token hash to its invitation and tenant. It runs as app_ops; the caller then sets the
-- tenant context and works under RLS as usual. app_user never bypasses RLS.
CREATE FUNCTION "identity"."invitation_by_token_hash"(p_token_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, membership_id uuid, email text, kind text,
               expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = identity, pg_temp AS $fn$
  SELECT i.id, i.tenant_id, i.membership_id, i.email, i.kind, i.expires_at, i.accepted_at, i.revoked_at
  FROM identity.invitations i
  WHERE i.token_hash = p_token_hash
$fn$;
ALTER FUNCTION "identity"."invitation_by_token_hash"(text) OWNER TO app_ops;
REVOKE ALL ON FUNCTION "identity"."invitation_by_token_hash"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "identity"."invitation_by_token_hash"(text) TO app_user;

-- ── Supabase: nothing reachable through its Data API (gap G9) ───────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA platform, identity, app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA platform, identity, app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform, identity, app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform, identity, app FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ── Platform staff roles (Part 03 §3.2) ─────────────────────────────────────────────────
INSERT INTO "platform"."staff_roles" ("key", "name", "description") VALUES
  ('platform_owner', 'Platform Owner', 'Full control, including staff management, billing configuration, country packs and the break-glass procedure. Two people at most.'),
  ('platform_admin', 'Platform Admin', 'Tenants, entitlements, catalogue and requests. Cannot manage staff or billing configuration.'),
  ('onboarding_specialist', 'Onboarding Specialist', 'Reviews requests, talks to applicants, prepares and runs provisioning, helps companies through setup.'),
  ('billing_manager', 'Billing Manager', 'Subscriptions, invoices, payments, dunning, credit notes.'),
  ('support_agent', 'Support Agent', 'Sees tenant metadata, handles tickets, opens support sessions when a company has granted access.'),
  ('operations', 'Engineer / Operations', 'System health, jobs, releases, feature flags, migrations. No tenant business data, no billing.'),
  ('auditor', 'Auditor', 'Read-only access to everything in the console except secrets; can export the platform audit log.');
