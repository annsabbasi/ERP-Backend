-- DropForeignKey
ALTER TABLE "app"."departments" DROP CONSTRAINT "departments_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."memberships" DROP CONSTRAINT "memberships_department_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."memberships" DROP CONSTRAINT "memberships_primary_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."positions" DROP CONSTRAINT "positions_department_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."positions" DROP CONSTRAINT "positions_reports_to_position_id_fkey";

-- CreateIndex
CREATE INDEX "branches_tenant_id_manager_membership_id_idx" ON "app"."branches"("tenant_id", "manager_membership_id");

-- CreateIndex
CREATE INDEX "departments_tenant_id_parent_id_idx" ON "app"."departments"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "departments_tenant_id_head_membership_id_idx" ON "app"."departments"("tenant_id", "head_membership_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "app"."memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_primary_branch_id_idx" ON "app"."memberships"("tenant_id", "primary_branch_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_department_id_idx" ON "app"."memberships"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "positions_tenant_id_department_id_idx" ON "app"."positions"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "positions_tenant_id_reports_to_position_id_idx" ON "app"."positions"("tenant_id", "reports_to_position_id");

-- CreateIndex
CREATE INDEX "teams_tenant_id_lead_membership_id_idx" ON "app"."teams"("tenant_id", "lead_membership_id");

-- AddForeignKey
ALTER TABLE "identity"."invitations" ADD CONSTRAINT "invitations_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Same-tenant references (QA finding F1, Part 10 §10.5.3) ─────────────────────────────
-- Every optional reference between tenant tables includes tenant_id, so a row can only
-- point at a row of its own tenant. Prisma cannot model these (the key mixes the required
-- tenant_id with an optional id), so they are written here and named *_tenant_fk.
-- MATCH SIMPLE (the default) skips the check while the id is NULL. ON DELETE SET NULL (col)
-- clears only the id; tenant_id stays. A reference to another tenant's row and to a row that
-- does not exist fail with the same error, so the error tells nothing about other tenants.
-- `prisma migrate dev` does not know these constraints and proposes dropping them in every
-- new migration: delete those lines. The schema test fails if one is missing.
ALTER TABLE "app"."memberships"
  ADD CONSTRAINT "memberships_primary_branch_tenant_fk" FOREIGN KEY ("tenant_id", "primary_branch_id")
    REFERENCES "app"."branches" ("tenant_id", "id") ON DELETE SET NULL ("primary_branch_id"),
  ADD CONSTRAINT "memberships_department_tenant_fk" FOREIGN KEY ("tenant_id", "department_id")
    REFERENCES "app"."departments" ("tenant_id", "id") ON DELETE SET NULL ("department_id");

ALTER TABLE "app"."departments"
  ADD CONSTRAINT "departments_parent_tenant_fk" FOREIGN KEY ("tenant_id", "parent_id")
    REFERENCES "app"."departments" ("tenant_id", "id") ON DELETE SET NULL ("parent_id"),
  ADD CONSTRAINT "departments_head_membership_tenant_fk" FOREIGN KEY ("tenant_id", "head_membership_id")
    REFERENCES "app"."memberships" ("tenant_id", "id") ON DELETE SET NULL ("head_membership_id");

ALTER TABLE "app"."positions"
  ADD CONSTRAINT "positions_department_tenant_fk" FOREIGN KEY ("tenant_id", "department_id")
    REFERENCES "app"."departments" ("tenant_id", "id") ON DELETE SET NULL ("department_id"),
  ADD CONSTRAINT "positions_reports_to_position_tenant_fk" FOREIGN KEY ("tenant_id", "reports_to_position_id")
    REFERENCES "app"."positions" ("tenant_id", "id") ON DELETE SET NULL ("reports_to_position_id");

ALTER TABLE "app"."branches"
  ADD CONSTRAINT "branches_manager_membership_tenant_fk" FOREIGN KEY ("tenant_id", "manager_membership_id")
    REFERENCES "app"."memberships" ("tenant_id", "id") ON DELETE SET NULL ("manager_membership_id");

ALTER TABLE "app"."teams"
  ADD CONSTRAINT "teams_lead_membership_tenant_fk" FOREIGN KEY ("tenant_id", "lead_membership_id")
    REFERENCES "app"."memberships" ("tenant_id", "id") ON DELETE SET NULL ("lead_membership_id");
