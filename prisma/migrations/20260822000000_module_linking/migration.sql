-- ============================================================================
-- Module-to-module linking (roadmap sections 7, 10, 20, 21)
--
-- Closes the core ERP chain and enforces cross-module references in the
-- database rather than in application code:
--
--   business_partners -> orders -> ar_invoices -> ar_payments -> journal_entries
--
-- `orders` previously had no customer column at all, and `ar_invoices` had no
-- link to the order it billed, so the chain was severed at both joints.
--
-- Also adds the foreign keys that were missing behind existing *Id columns
-- (company accounting defaults, BP control accounts, ledger audit trail),
-- indexes every foreign key column, and replaces three CASCADE rules that
-- would have destroyed financial history:
--
--   ar_payments.invoiceId        CASCADE -> RESTRICT  (money received)
--   ap_payments.billId           CASCADE -> RESTRICT  (money paid)
--   attendance_entries.employeeId CASCADE -> RESTRICT (payroll evidence)
--
-- Document lines keep CASCADE: they are composition, not independent records.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "ap_payments" DROP CONSTRAINT "ap_payments_billId_fkey";

-- DropForeignKey
ALTER TABLE "ar_payments" DROP CONSTRAINT "ar_payments_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "attendance_entries" DROP CONSTRAINT "attendance_entries_employeeId_fkey";

-- AlterTable
ALTER TABLE "ar_invoice_lines" ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "ar_invoices" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bpId" TEXT;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "account_determinations_accountId_idx" ON "account_determinations"("accountId");

-- CreateIndex
CREATE INDEX "accounts_cashFlowLineItemId_idx" ON "accounts"("cashFlowLineItemId");

-- CreateIndex
CREATE INDEX "activities_contactPersonId_idx" ON "activities"("contactPersonId");

-- CreateIndex
CREATE INDEX "activities_ownerId_idx" ON "activities"("ownerId");

-- CreateIndex
CREATE INDEX "activities_parentActivityId_idx" ON "activities"("parentActivityId");

-- CreateIndex
CREATE INDEX "alert_instances_alertId_idx" ON "alert_instances"("alertId");

-- CreateIndex
CREATE INDEX "ap_bill_lines_accountId_idx" ON "ap_bill_lines"("accountId");

-- CreateIndex
CREATE INDEX "ap_bills_paymentTermsId_idx" ON "ap_bills"("paymentTermsId");

-- CreateIndex
CREATE INDEX "ap_payments_companyId_idx" ON "ap_payments"("companyId");

-- CreateIndex
CREATE INDEX "approval_request_stages_stageId_idx" ON "approval_request_stages"("stageId");

-- CreateIndex
CREATE INDEX "approval_requests_originatorId_idx" ON "approval_requests"("originatorId");

-- CreateIndex
CREATE INDEX "approval_requests_templateId_idx" ON "approval_requests"("templateId");

-- CreateIndex
CREATE INDEX "approval_stage_approvers_userId_idx" ON "approval_stage_approvers"("userId");

-- CreateIndex
CREATE INDEX "approval_template_originators_userId_idx" ON "approval_template_originators"("userId");

-- CreateIndex
CREATE INDEX "approval_template_stages_stageId_idx" ON "approval_template_stages"("stageId");

-- CreateIndex
CREATE INDEX "ar_invoice_lines_productId_idx" ON "ar_invoice_lines"("productId");

-- CreateIndex
CREATE INDEX "ar_invoice_lines_accountId_idx" ON "ar_invoice_lines"("accountId");

-- CreateIndex
CREATE INDEX "ar_invoices_orderId_idx" ON "ar_invoices"("orderId");

-- CreateIndex
CREATE INDEX "ar_invoices_paymentTermsId_idx" ON "ar_invoices"("paymentTermsId");

-- CreateIndex
CREATE INDEX "ar_payments_companyId_idx" ON "ar_payments"("companyId");

-- CreateIndex
CREATE INDEX "attachments_uploadedById_idx" ON "attachments"("uploadedById");

-- CreateIndex
CREATE INDEX "bp_relationships_toBpId_idx" ON "bp_relationships"("toBpId");

-- CreateIndex
CREATE INDEX "bp_relationships_typeId_idx" ON "bp_relationships"("typeId");

-- CreateIndex
CREATE INDEX "branches_managerId_idx" ON "branches"("managerId");

-- CreateIndex
CREATE INDEX "budget_lines_accountId_idx" ON "budget_lines"("accountId");

-- CreateIndex
CREATE INDEX "budget_lines_costCenterId_idx" ON "budget_lines"("costCenterId");

-- CreateIndex
CREATE INDEX "budget_lines_distributionMethodId_idx" ON "budget_lines"("distributionMethodId");

-- CreateIndex
CREATE INDEX "budget_lines_periodId_idx" ON "budget_lines"("periodId");

-- CreateIndex
CREATE INDEX "budget_scenarios_basedOnScenarioId_idx" ON "budget_scenarios"("basedOnScenarioId");

-- CreateIndex
CREATE INDEX "business_partners_dunningTermId_idx" ON "business_partners"("dunningTermId");

-- CreateIndex
CREATE INDEX "business_partners_groupId_idx" ON "business_partners"("groupId");

-- CreateIndex
CREATE INDEX "business_partners_paymentMethodId_idx" ON "business_partners"("paymentMethodId");

-- CreateIndex
CREATE INDEX "business_partners_paymentTermsId_idx" ON "business_partners"("paymentTermsId");

-- CreateIndex
CREATE INDEX "business_partners_salesEmployeeId_idx" ON "business_partners"("salesEmployeeId");

-- CreateIndex
CREATE INDEX "business_partners_territoryId_idx" ON "business_partners"("territoryId");

-- CreateIndex
CREATE INDEX "campaign_targets_bpId_idx" ON "campaign_targets"("bpId");

-- CreateIndex
CREATE INDEX "campaign_targets_contactPersonId_idx" ON "campaign_targets"("contactPersonId");

-- CreateIndex
CREATE INDEX "campaigns_salesEmployeeId_idx" ON "campaigns"("salesEmployeeId");

-- CreateIndex
CREATE INDEX "cash_flow_line_items_parentId_idx" ON "cash_flow_line_items"("parentId");

-- CreateIndex
CREATE INDEX "company_modules_moduleId_idx" ON "company_modules"("moduleId");

-- CreateIndex
CREATE INDEX "cost_centers_dimensionId_idx" ON "cost_centers"("dimensionId");

-- CreateIndex
CREATE INDEX "cost_centers_parentId_idx" ON "cost_centers"("parentId");

-- CreateIndex
CREATE INDEX "distribution_rule_lines_costCenterId_idx" ON "distribution_rule_lines"("costCenterId");

-- CreateIndex
CREATE INDEX "distribution_rules_dimensionId_idx" ON "distribution_rules"("dimensionId");

-- CreateIndex
CREATE INDEX "document_approval_decisions_approverId_idx" ON "document_approval_decisions"("approverId");

-- CreateIndex
CREATE INDEX "employee_shifts_shiftId_idx" ON "employee_shifts"("shiftId");

-- CreateIndex
CREATE INDEX "employees_userId_idx" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employment_contracts_positionId_idx" ON "employment_contracts"("positionId");

-- CreateIndex
CREATE INDEX "fixed_assets_accumulatedAccountId_idx" ON "fixed_assets"("accumulatedAccountId");

-- CreateIndex
CREATE INDEX "fixed_assets_costAccountId_idx" ON "fixed_assets"("costAccountId");

-- CreateIndex
CREATE INDEX "fixed_assets_depreciationAccountId_idx" ON "fixed_assets"("depreciationAccountId");

-- CreateIndex
CREATE INDEX "house_bank_accounts_bankId_idx" ON "house_bank_accounts"("bankId");

-- CreateIndex
CREATE INDEX "house_bank_accounts_glAccountId_idx" ON "house_bank_accounts"("glAccountId");

-- CreateIndex
CREATE INDEX "internal_reconciliation_lines_journalEntryId_idx" ON "internal_reconciliation_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "internal_reconciliations_bpId_idx" ON "internal_reconciliations"("bpId");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX "journal_entries_projectId_idx" ON "journal_entries"("projectId");

-- CreateIndex
CREATE INDEX "journal_entries_seriesId_idx" ON "journal_entries"("seriesId");

-- CreateIndex
CREATE INDEX "journal_entries_templateId_idx" ON "journal_entries"("templateId");

-- CreateIndex
CREATE INDEX "journal_entries_transactionCodeId_idx" ON "journal_entries"("transactionCodeId");

-- CreateIndex
CREATE INDEX "journal_lines_distributionRuleId_idx" ON "journal_lines"("distributionRuleId");

-- CreateIndex
CREATE INDEX "journal_lines_projectId_idx" ON "journal_lines"("projectId");

-- CreateIndex
CREATE INDEX "journal_lines_taxCodeId_idx" ON "journal_lines"("taxCodeId");

-- CreateIndex
CREATE INDEX "leave_balances_leaveTypeId_idx" ON "leave_balances"("leaveTypeId");

-- CreateIndex
CREATE INDEX "leave_requests_leaveTypeId_idx" ON "leave_requests"("leaveTypeId");

-- CreateIndex
CREATE INDEX "onboarding_instances_companyId_idx" ON "onboarding_instances"("companyId");

-- CreateIndex
CREATE INDEX "onboarding_instances_templateId_idx" ON "onboarding_instances"("templateId");

-- CreateIndex
CREATE INDEX "opportunities_contactPersonId_idx" ON "opportunities"("contactPersonId");

-- CreateIndex
CREATE INDEX "opportunities_currentStageId_idx" ON "opportunities"("currentStageId");

-- CreateIndex
CREATE INDEX "opportunities_informationSourceId_idx" ON "opportunities"("informationSourceId");

-- CreateIndex
CREATE INDEX "opportunities_territoryId_idx" ON "opportunities"("territoryId");

-- CreateIndex
CREATE INDEX "opportunity_competitors_competitorId_idx" ON "opportunity_competitors"("competitorId");

-- CreateIndex
CREATE INDEX "opportunity_partners_partnerId_idx" ON "opportunity_partners"("partnerId");

-- CreateIndex
CREATE INDEX "opportunity_stage_entries_activityId_idx" ON "opportunity_stage_entries"("activityId");

-- CreateIndex
CREATE INDEX "opportunity_stage_entries_salesEmployeeId_idx" ON "opportunity_stage_entries"("salesEmployeeId");

-- CreateIndex
CREATE INDEX "opportunity_stage_entries_stageDefId_idx" ON "opportunity_stage_entries"("stageDefId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "orders_bpId_idx" ON "orders"("bpId");

-- CreateIndex
CREATE INDEX "payment_methods_houseBankAccountId_idx" ON "payment_methods"("houseBankAccountId");

-- CreateIndex
CREATE INDEX "permission_set_items_permissionId_idx" ON "permission_set_items"("permissionId");

-- CreateIndex
CREATE INDEX "permission_sets_companyId_idx" ON "permission_sets"("companyId");

-- CreateIndex
CREATE INDEX "plan_modules_moduleId_idx" ON "plan_modules"("moduleId");

-- CreateIndex
CREATE INDEX "positions_branchId_idx" ON "positions"("branchId");

-- CreateIndex
CREATE INDEX "positions_departmentId_idx" ON "positions"("departmentId");

-- CreateIndex
CREATE INDEX "posting_template_lines_accountId_idx" ON "posting_template_lines"("accountId");

-- CreateIndex
CREATE INDEX "recurring_posting_lines_accountId_idx" ON "recurring_posting_lines"("accountId");

-- CreateIndex
CREATE INDEX "role_permission_sets_setId_idx" ON "role_permission_sets"("setId");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE INDEX "roles_sourceRoleId_idx" ON "roles"("sourceRoleId");

-- CreateIndex
CREATE INDEX "sales_employees_commissionGroupId_idx" ON "sales_employees"("commissionGroupId");

-- CreateIndex
CREATE INDEX "sales_employees_territoryId_idx" ON "sales_employees"("territoryId");

-- CreateIndex
CREATE INDEX "substitute_authorizers_substituteUserId_idx" ON "substitute_authorizers"("substituteUserId");

-- CreateIndex
CREATE INDEX "substitute_authorizers_templateId_idx" ON "substitute_authorizers"("templateId");

-- CreateIndex
CREATE INDEX "tax_codes_accountId_idx" ON "tax_codes"("accountId");

-- CreateIndex
CREATE INDEX "user_modules_moduleId_idx" ON "user_modules"("moduleId");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE INDEX "users_departmentId_idx" ON "users"("departmentId");

-- CreateIndex
CREATE INDEX "users_userDefaultsGroupId_idx" ON "users"("userDefaultsGroupId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultArAccountId_fkey" FOREIGN KEY ("defaultArAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultApAccountId_fkey" FOREIGN KEY ("defaultApAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultCashAccountId_fkey" FOREIGN KEY ("defaultCashAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultTaxPayableAccountId_fkey" FOREIGN KEY ("defaultTaxPayableAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultTaxRecoverableAccountId_fkey" FOREIGN KEY ("defaultTaxRecoverableAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultRevenueAccountId_fkey" FOREIGN KEY ("defaultRevenueAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultExpenseAccountId_fkey" FOREIGN KEY ("defaultExpenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_controlAccountId_fkey" FOREIGN KEY ("controlAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_downPaymentAccountId_fkey" FOREIGN KEY ("downPaymentAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_reconciliations" ADD CONSTRAINT "internal_reconciliations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

