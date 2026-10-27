-- Platform Console I (Part 03 §3.2–3.3, §3.11, §3.17): staff-edited catalogue display fields,
-- versioned country packs, four-eyes approvals, and the console's own database role.
--
-- Prisma proposes dropping the same-tenant foreign keys (migration tenant_safe_references) in
-- every migration; those lines are removed by hand (docs/local-dev.md).

-- AlterTable
ALTER TABLE "addons" ADD COLUMN     "archived_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "catalogue_features" ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "display_order" INTEGER,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "status_override" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "catalogue_modules" ADD COLUMN     "description" TEXT,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "display_order" INTEGER,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "industry_templates" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_by" UUID;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "archived_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_by" UUID;

-- CreateTable
CREATE TABLE "country_packs" (
    "country" CHAR(2) NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "country_packs_pkey" PRIMARY KEY ("country","version")
);

-- CreateTable
CREATE TABLE "staff_approvals" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "executed_at" TIMESTAMPTZ(6),
    "result" JSONB,

    CONSTRAINT "staff_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_approvals_status_requested_at_idx" ON "staff_approvals"("status", "requested_at");

-- CreateIndex
CREATE INDEX "staff_approvals_target_type_target_id_idx" ON "staff_approvals"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "staff_approvals" ADD CONSTRAINT "staff_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_approvals" ADD CONSTRAINT "staff_approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Rules on the new rows ────────────────────────────────────────────────────────────────────

ALTER TABLE "platform"."catalogue_features"
  ADD CONSTRAINT "catalogue_features_status_override_check"
    CHECK ("status_override" IS NULL OR "status_override" IN ('ga', 'beta', 'preview', 'deprecated')),
  ADD CONSTRAINT "catalogue_features_countries_check"
    CHECK ("countries" IS NULL OR array_to_string("countries", ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
ALTER TABLE "platform"."country_packs"
  ADD CONSTRAINT "country_packs_status_check" CHECK ("status" IN ('draft', 'in_review', 'published', 'deprecated')),
  ADD CONSTRAINT "country_packs_country_check" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "country_packs_version_check" CHECK ("version" ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$');
ALTER TABLE "platform"."industry_templates"
  ADD CONSTRAINT "industry_templates_version_check" CHECK ("version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$');
ALTER TABLE "platform"."staff_approvals"
  ADD CONSTRAINT "staff_approvals_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  -- Four-eyes: the decider is never the requester (Part 03 §3.2.1).
  ADD CONSTRAINT "staff_approvals_not_self_check" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by"),
  ADD CONSTRAINT "staff_approvals_reason_check" CHECK (length(btrim("reason")) > 0);

-- At most one published version of a template or country pack at a time.
CREATE UNIQUE INDEX "industry_templates_one_published" ON "platform"."industry_templates" ("key")
  WHERE "status" = 'published';
CREATE UNIQUE INDEX "country_packs_one_published" ON "platform"."country_packs" ("country")
  WHERE "status" = 'published';

-- ── app_platform: the Platform Console's role (Stage 1 QA finding F4) ────────────────────────
-- The API's platform module connects as app_platform (PLATFORM_DATABASE_URL). Control-plane
-- tables only, no tenant data, no sign-in secrets, no BYPASSRLS. Staff setup links and staff
-- sessions stay with app_auth (ADR 0008); the platform module asks the auth module for them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN NOBYPASSRLS;     -- the API's platform module only
  END IF;
END $$;
GRANT USAGE ON SCHEMA "platform" TO app_platform;

-- Staff accounts (managed by the Platform Owner): read, invite, change roles, deactivate.
GRANT SELECT ON "platform"."staff_users", "platform"."staff_roles", "platform"."staff_role_assignments" TO app_platform;
GRANT INSERT ON "platform"."staff_users" TO app_platform;
GRANT UPDATE ("name", "status", "updated_at", "version") ON "platform"."staff_users" TO app_platform;
GRANT INSERT, DELETE ON "platform"."staff_role_assignments" TO app_platform;

-- Catalogue: the code owns the definitions (catalogue sync); staff own the display columns.
GRANT SELECT ON "platform"."catalogue_modules", "platform"."catalogue_features",
  "platform"."catalogue_permissions" TO app_platform;
GRANT UPDATE ("display_name", "description", "icon", "display_order", "updated_at", "updated_by")
  ON "platform"."catalogue_modules" TO app_platform;
GRANT UPDATE ("display_name", "description", "icon", "display_order", "countries", "status_override",
  "updated_at", "updated_by") ON "platform"."catalogue_features" TO app_platform;

-- Plans, add-ons, templates, country packs and approvals: never deleted (archived, deprecated,
-- cancelled), so no DELETE.
GRANT SELECT, INSERT, UPDATE ON "platform"."plans", "platform"."addons",
  "platform"."industry_templates", "platform"."country_packs", "platform"."staff_approvals" TO app_platform;

-- The console's search and tenant lists read the tenant directory, not tenant data.
GRANT SELECT ("id", "code", "slug", "display_name", "legal_name", "status", "industry_key",
  "template_key", "template_version", "country", "created_at") ON "platform"."tenants" TO app_platform;

-- Platform audit log: read and verify; write only through append_audit, which tenant code
-- (app_user) can no longer call with a staff actor of its choice (F4).
GRANT SELECT ON "platform"."platform_audit_log" TO app_platform;
REVOKE EXECUTE ON FUNCTION "platform"."append_audit"(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) FROM app_user;
GRANT EXECUTE ON FUNCTION "platform"."append_audit"(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text, text, text) TO app_platform;
GRANT EXECUTE ON FUNCTION "platform"."verify_audit_chain"() TO app_platform;
