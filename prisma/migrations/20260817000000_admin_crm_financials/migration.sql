-- ============================================================================
-- Administration, CRM & Financials
--
-- Brings the database up to the full schema. The migrations recorded in
-- _prisma_migrations only ever created 21 tables; everything from documents,
-- workflows, notifications, billing and HR through the entire finance, CRM and
-- administration surface has been schema-only until now. That is why saved
-- records had nowhere to land.
--
-- Also reconciles two pieces of live drift:
--   * UserRoleType labels (data-migrated, see below)
--   * the permission catalog's shape (cleared and re-seeded, see below)
-- ============================================================================

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'DEPARTMENT', 'BRANCH', 'ALL');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED', 'RETIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "LeaveAccrualMode" AS ENUM ('NONE', 'PERIODIC');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'TAKEN');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('WEB', 'DESKTOP', 'MOBILE', 'DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('CHECKED_IN', 'CHECKED_OUT', 'AUTO_CLOSED', 'MISSED');

-- CreateEnum
CREATE TYPE "OnboardingItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'WAITING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'ERRORED');

-- CreateEnum
CREATE TYPE "WorkflowStepType" AS ENUM ('APPROVAL', 'AUTOMATED_ACTION', 'CONDITIONAL_BRANCH', 'WAIT', 'ESCALATION');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalSemantics" AS ENUM ('FIRST_RESPONSE', 'UNANIMOUS', 'MAJORITY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'DESKTOP_TOAST');

-- CreateEnum
CREATE TYPE "NotificationDigest" AS ENUM ('IMMEDIATE', 'HOURLY', 'DAILY', 'WEEKLY', 'OFF');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ', 'DISMISSED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "DocumentAccessType" AS ENUM ('VIEWED', 'DOWNLOADED', 'PREVIEWED', 'SHARED_LINK_OPENED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountSubtype" AS ENUM ('CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'INVENTORY', 'FIXED_ASSET', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'TAX_PAYABLE', 'TAX_RECOVERABLE', 'SHARE_CAPITAL', 'RETAINED_EARNINGS', 'REVENUE', 'COST_OF_GOODS_SOLD', 'OPERATING_EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "SubPeriodType" AS ENUM ('YEAR', 'MONTHS', 'QUARTERS', 'DAYS');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ARInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "APBillStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "AlertPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('ON_EVENT', 'MINUTES', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'GENERATED');

-- CreateEnum
CREATE TYPE "BpCardType" AS ENUM ('CUSTOMER', 'VENDOR', 'LEAD');

-- CreateEnum
CREATE TYPE "BpAddressType" AS ENUM ('BILL_TO', 'SHIP_TO');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('MEETING', 'PHONE_CALL', 'TASK', 'NOTE', 'CAMPAIGN', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountDeterminationArea" AS ENUM ('SALES', 'PURCHASING', 'GENERAL', 'INVENTORY');

-- CreateEnum
CREATE TYPE "TaxCodeType" AS ENUM ('SALES', 'PURCHASE', 'WITHHOLDING');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'ANNUALLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'SUM_OF_YEARS', 'IMMEDIATE', 'NONE');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('NEW', 'CAPITALIZED', 'RETIRED', 'SOLD');

-- CreateEnum
CREATE TYPE "AssetTransactionType" AS ENUM ('CAPITALIZATION', 'CAPITALIZATION_CREDIT_MEMO', 'DEPRECIATION', 'MANUAL_DEPRECIATION', 'REVALUATION', 'TRANSFER', 'RETIREMENT');

-- AlterEnum
BEGIN;
CREATE TYPE "UserRoleType_new" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'DEPARTMENT_HEAD', 'EMPLOYEE');
ALTER TABLE "users" ALTER COLUMN "roleType" DROP DEFAULT;
-- Data migration: the live DB drifted to SAP-style labels. Map them onto the
-- spec's four-tier hierarchy so no user loses their tier.
--   SUB_ADMIN -> COMPANY_ADMIN | MANAGER -> DEPARTMENT_HEAD | NORMAL_USER -> EMPLOYEE
ALTER TABLE "users" ALTER COLUMN "roleType" TYPE "UserRoleType_new" USING ((
  CASE "roleType"::text
    WHEN 'SUPER_ADMIN'     THEN 'SUPER_ADMIN'
    WHEN 'SUB_ADMIN'       THEN 'COMPANY_ADMIN'
    WHEN 'MANAGER'         THEN 'DEPARTMENT_HEAD'
    WHEN 'NORMAL_USER'     THEN 'EMPLOYEE'
    WHEN 'COMPANY_ADMIN'   THEN 'COMPANY_ADMIN'
    WHEN 'DEPARTMENT_HEAD' THEN 'DEPARTMENT_HEAD'
    WHEN 'EMPLOYEE'        THEN 'EMPLOYEE'
    ELSE 'EMPLOYEE'
  END)::"UserRoleType_new");
ALTER TYPE "UserRoleType" RENAME TO "UserRoleType_old";
ALTER TYPE "UserRoleType_new" RENAME TO "UserRoleType";
DROP TYPE "UserRoleType_old";
ALTER TABLE "users" ALTER COLUMN "roleType" SET DEFAULT 'EMPLOYEE';
COMMIT;

-- DropForeignKey
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_moduleId_fkey";

-- DropIndex
DROP INDEX "permissions_moduleId_action_key";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "branding" JSONB,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "defaultApAccountId" TEXT,
ADD COLUMN     "defaultArAccountId" TEXT,
ADD COLUMN     "defaultCashAccountId" TEXT,
ADD COLUMN     "defaultExpenseAccountId" TEXT,
ADD COLUMN     "defaultRevenueAccountId" TEXT,
ADD COLUMN     "defaultTaxPayableAccountId" TEXT,
ADD COLUMN     "defaultTaxRecoverableAccountId" TEXT,
ADD COLUMN     "fiscalYearStart" INTEGER,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "locale" TEXT,
ADD COLUMN     "templateApplied" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "employeeNumber" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "terminationDate" TIMESTAMP(3),
ADD COLUMN     "userId" TEXT;

-- AlterTable
-- Permission catalog reset.
-- `permissions` and `role_permissions` hold platform catalog data that
-- prisma/seed.ts regenerates from PERMISSION_CATALOG. The IAM refactor changes
-- their shape incompatibly (moduleId + PermissionAction enum -> key/resource/
-- action/moduleSlug text), so the 60 legacy rows cannot be migrated in place.
-- They are cleared here and rebuilt by the seed.
--
--   >>> RUN `npm run prisma:seed` AFTER THIS MIGRATION, then re-assign
--   >>> role -> permission grants for any custom roles.
DELETE FROM "role_permissions";
DELETE FROM "permissions";

ALTER TABLE "permissions" DROP COLUMN "moduleId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "moduleSlug" TEXT NOT NULL,
ADD COLUMN     "resource" TEXT NOT NULL,
DROP COLUMN "action",
ADD COLUMN     "action" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "scope" "PermissionScope" NOT NULL DEFAULT 'ALL',
ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "defaultScope" "PermissionScope" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "sourceRoleId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "userDefaultsGroupId" TEXT,
ALTER COLUMN "roleType" SET DEFAULT 'EMPLOYEE';

-- DropEnum
DROP TYPE "PermissionAction";

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "managerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_sets" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_set_items" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "permission_set_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission_sets" (
    "roleId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,

    CONSTRAINT "role_permission_sets_pkey" PRIMARY KEY ("roleId","setId")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "level" INTEGER,
    "departmentId" TEXT,
    "branchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_contracts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "positionId" TEXT,
    "type" "EmploymentType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "salaryAmountMinor" INTEGER,
    "salaryCurrency" TEXT DEFAULT 'USD',
    "salaryFrequency" TEXT,
    "workHoursPerWeek" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accrualMode" "LeaveAccrualMode" NOT NULL DEFAULT 'NONE',
    "accrualDays" DECIMAL(6,2),
    "accrualPeriod" TEXT,
    "maxBalance" DECIMAL(6,2),
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "workflowKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "accruedDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "usedDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "pendingDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "carryOverDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "workflowInstanceId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isOvernight" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workDays" INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_shifts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "source" "AttendanceSource" NOT NULL DEFAULT 'WEB',
    "status" "AttendanceStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "workedMinutes" INTEGER,
    "shiftId" TEXT,
    "notes" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "positionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "assigneeRole" TEXT,
    "daysFromStart" INTEGER,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "onboarding_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_instances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetEndAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "onboarding_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_instance_items" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "assigneeId" TEXT,
    "status" "OnboardingItemStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "onboarding_instance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "hash" TEXT NOT NULL,
    "chainHash" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "isEnforced" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monthlyPrice" INTEGER,
    "annualPrice" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "maxUsers" INTEGER,
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_modules" (
    "planId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,

    CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("planId","moduleId")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pastDueAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "seatsOverride" INTEGER,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "number" TEXT NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "initiatorId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "currentStepKey" TEXT,
    "context" JSONB,
    "resumeAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_history" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stepType" "WorkflowStepType" NOT NULL,
    "status" TEXT NOT NULL,
    "actorId" TEXT,
    "message" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_approvals" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision",
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "refType" TEXT,
    "refId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '*',
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest" "NotificationDigest" NOT NULL DEFAULT 'IMMEDIATE',

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventFilters" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "lastAttemptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" TEXT,
    "ownerId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "tags" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_logs" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT,
    "accessType" "DocumentAccessType" NOT NULL,
    "shareLinkId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxAccesses" INTEGER,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "subtype" "AccountSubtype",
    "parentId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isTitle" BOOLEAN NOT NULL DEFAULT false,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER NOT NULL DEFAULT 1,
    "cashFlowLineItemId" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "parentId" TEXT,
    "fiscalYear" INTEGER,
    "subPeriodType" "SubPeriodType" NOT NULL DEFAULT 'MONTHS',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "dueDateFrom" TIMESTAMP(3),
    "dueDateTo" TIMESTAMP(3),
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "salesStatus" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "purchasingStatus" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "generalStatus" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "inventoryStatus" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "reversalOfId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalDebit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "source" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seriesId" TEXT,
    "docDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "transactionCodeId" TEXT,
    "projectId" TEXT,
    "templateId" TEXT,
    "indicator" TEXT,
    "ref1" TEXT,
    "ref2" TEXT,
    "ref3" TEXT,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "autoReverseDate" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "bpId" TEXT,
    "costCenterId" TEXT,
    "distributionRuleId" TEXT,
    "projectId" TEXT,
    "taxCodeId" TEXT,
    "taxAmount" DECIMAL(15,2),
    "dueDate" TIMESTAMP(3),
    "ref1" TEXT,
    "ref2" TEXT,
    "ref3" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "targetCurrency" TEXT NOT NULL,
    "rate" DECIMAL(15,6) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "netDays" INTEGER NOT NULL,
    "discountDays" INTEGER,
    "discountPercent" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bpId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "ARInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentTermsId" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "taxPercent" DECIMAL(5,2),
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT,

    CONSTRAINT "ar_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_bills" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bpId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "APBillStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentTermsId" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_bill_lines" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "taxPercent" DECIMAL(5,2),
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT,

    CONSTRAINT "ap_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileExtension" TEXT,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "targetPath" TEXT,
    "storageKey" TEXT,
    "freeText" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "numbering_series" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT,
    "suffix" TEXT,
    "firstNumber" INTEGER NOT NULL DEFAULT 1,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "lastNumber" INTEGER,
    "digits" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "periodIndicator" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "numbering_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "user_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_defaults_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_defaults_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predefined_texts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "text" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predefined_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressFormat" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_regions" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "state_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" "AlertPriority" NOT NULL DEFAULT 'NORMAL',
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'ON_EVENT',
    "frequencyValue" INTEGER,
    "eventKey" TEXT,
    "savedQuery" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_subscriptions" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alert_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_instances" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_stages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_stage_approvers" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "approval_stage_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "documentTypes" TEXT[],
    "terms" JSONB NOT NULL DEFAULT '{}',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_template_originators" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "approval_template_originators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_template_stages" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "approval_template_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT,
    "documentNumber" TEXT,
    "originatorId" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "currentStageOrder" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "documentSnapshot" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request_stages" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "approval_request_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_approval_decisions" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestStageId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "remarks" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onBehalfOfId" TEXT,

    CONSTRAINT "document_approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitute_authorizers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT,
    "originalUserId" TEXT NOT NULL,
    "substituteUserId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "substitute_authorizers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bp_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "BpCardType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_partners" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cardCode" TEXT NOT NULL,
    "cardName" TEXT NOT NULL,
    "cardType" "BpCardType" NOT NULL DEFAULT 'CUSTOMER',
    "foreignName" TEXT,
    "groupId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "federalTaxId" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "mobile" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "website" TEXT,
    "shippingType" TEXT,
    "territoryId" TEXT,
    "salesEmployeeId" TEXT,
    "paymentTermsId" TEXT,
    "paymentMethodId" TEXT,
    "dunningTermId" TEXT,
    "creditLimit" DECIMAL(15,2),
    "commitmentLimit" DECIMAL(15,2),
    "discountPercent" DECIMAL(5,2),
    "interestOnArrears" DECIMAL(5,2),
    "priceListId" TEXT,
    "controlAccountId" TEXT,
    "downPaymentAccountId" TEXT,
    "accountBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ordersBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deliveriesBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "opportunitiesAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "properties" JSONB,
    "industry" TEXT,
    "businessType" TEXT,
    "priority" TEXT,
    "blockDunning" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bp_contact_persons" (
    "id" TEXT NOT NULL,
    "bpId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "title" TEXT,
    "address" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "mobile" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "pager" TEXT,
    "profession" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "remarks1" TEXT,
    "remarks2" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bp_contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bp_addresses" (
    "id" TEXT NOT NULL,
    "bpId" TEXT NOT NULL,
    "addressName" TEXT NOT NULL,
    "addressType" "BpAddressType" NOT NULL DEFAULT 'BILL_TO',
    "street" TEXT,
    "streetNo" TEXT,
    "block" TEXT,
    "building" TEXT,
    "city" TEXT,
    "zipCode" TEXT,
    "county" TEXT,
    "state" TEXT,
    "country" TEXT,
    "gln" TEXT,
    "taxCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bp_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bp_bank_accounts" (
    "id" TEXT NOT NULL,
    "bpId" TEXT NOT NULL,
    "bankCode" TEXT,
    "bankName" TEXT,
    "branch" TEXT,
    "accountNo" TEXT,
    "accountName" TEXT,
    "iban" TEXT,
    "swift" TEXT,
    "controlKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bp_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bp_relationship_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "bp_relationship_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bp_relationships" (
    "id" TEXT NOT NULL,
    "fromBpId" TEXT NOT NULL,
    "toBpId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "bp_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "commissionGroupId" TEXT,
    "commissionPercent" DECIMAL(5,2),
    "territoryId" TEXT,
    "telephone" TEXT,
    "mobile" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNumber" INTEGER,
    "kind" "ActivityKind" NOT NULL DEFAULT 'TASK',
    "subject" TEXT NOT NULL,
    "activityType" TEXT,
    "bpId" TEXT,
    "contactPersonId" TEXT,
    "priority" "ActivityPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ActivityStatus" NOT NULL DEFAULT 'OPEN',
    "startDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endDate" TIMESTAMP(3),
    "endTime" TEXT,
    "durationMinutes" INTEGER,
    "location" TEXT,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderMinutesBefore" INTEGER,
    "reminderSentAt" TIMESTAMP(3),
    "recurrence" JSONB,
    "parentActivityId" TEXT,
    "linkedDocType" TEXT,
    "linkedDocId" TEXT,
    "linkedDocNumber" TEXT,
    "content" TEXT,
    "remarks" TEXT,
    "ownerId" TEXT,
    "assignedToUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stage_defs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stageNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "closingPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "opportunity_stage_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threatLevel" TEXT,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_partners" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crm_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "information_sources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "information_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNumber" INTEGER,
    "name" TEXT NOT NULL,
    "bpId" TEXT NOT NULL,
    "contactPersonId" TEXT,
    "salesEmployeeId" TEXT,
    "territoryId" TEXT,
    "currentStageId" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "level" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "closingDate" TIMESTAMP(3),
    "predictedClosingDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "potentialAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "weightedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "closePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL(15,2),
    "grossProfitPercent" DECIMAL(5,2),
    "informationSourceId" TEXT,
    "industry" TEXT,
    "interestField" TEXT,
    "interestLevel" TEXT,
    "reasonId" TEXT,
    "wonLostReason" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stage_entries" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "stageDefId" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "closePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "potentialAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "weightedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "salesEmployeeId" TEXT,
    "activityId" TEXT,
    "docType" TEXT,
    "docNumber" TEXT,
    "remarks" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "opportunity_stage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_competitors" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "threatLevel" TEXT,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "remarks" TEXT,

    CONSTRAINT "opportunity_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_partners" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "role" TEXT,
    "remarks" TEXT,

    CONSTRAINT "opportunity_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campaignNumber" INTEGER,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "salesEmployeeId" TEXT,
    "targetGroup" TEXT,
    "budgetAmount" DECIMAL(15,2),
    "revenueAmount" DECIMAL(15,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_targets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "bpId" TEXT,
    "contactPersonId" TEXT,
    "response" TEXT,
    "remarks" TEXT,

    CONSTRAINT "campaign_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intlDescription" TEXT,
    "hundredthName" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "rounding" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_determinations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "area" "AccountDeterminationArea" NOT NULL,
    "key" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_determinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_projects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_codes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "transaction_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxCodeType" NOT NULL DEFAULT 'SALES',
    "rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_line_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "section" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cash_flow_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_template_lines" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "percentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "side" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "posting_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_postings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "nextExecution" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "maxExecutions" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_posting_lines" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recurring_posting_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimensions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dimensionNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalRatio" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_rule_lines" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "ratio" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "distribution_rule_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_scenarios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "basedOnScenarioId" TEXT,
    "initialRatio" DECIMAL(7,4) NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_distribution_methods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyRatios" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "budget_distribution_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "periodId" TEXT,
    "distributionMethodId" TEXT,
    "annualDebit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "annualCredit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "swift" TEXT,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "accountName" TEXT,
    "branch" TEXT,
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "glAccountId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "house_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL DEFAULT 'INCOMING',
    "paymentMeans" TEXT,
    "houseBankAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dunning_terms" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "levels" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dunning_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_reconciliations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bpId" TEXT,
    "accountId" TEXT,
    "reconciledAt" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reconciledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_reconciliation_lines" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "internal_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" TEXT,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'NEW',
    "capitalizedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "usefulLifeMonths" INTEGER NOT NULL DEFAULT 60,
    "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "acquisitionCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "salvageValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "accumulatedDepreciation" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netBookValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costAccountId" TEXT,
    "depreciationAccountId" TEXT,
    "accumulatedAccountId" TEXT,
    "costCenterId" TEXT,
    "serialNumber" TEXT,
    "location" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_transactions" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetTransactionType" NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "journalEntryId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_companyId_idx" ON "branches"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_companyId_name_key" ON "branches"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permission_sets_key_key" ON "permission_sets"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permission_sets_name_companyId_key" ON "permission_sets"("name", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "permission_set_items_setId_permissionId_scope_key" ON "permission_set_items"("setId", "permissionId", "scope");

-- CreateIndex
CREATE INDEX "positions_companyId_idx" ON "positions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "positions_companyId_title_key" ON "positions"("companyId", "title");

-- CreateIndex
CREATE INDEX "employment_contracts_employeeId_idx" ON "employment_contracts"("employeeId");

-- CreateIndex
CREATE INDEX "leave_types_companyId_idx" ON "leave_types"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_companyId_code_key" ON "leave_types"("companyId", "code");

-- CreateIndex
CREATE INDEX "leave_balances_employeeId_idx" ON "leave_balances"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveTypeId_periodKey_key" ON "leave_balances"("employeeId", "leaveTypeId", "periodKey");

-- CreateIndex
CREATE INDEX "leave_requests_companyId_idx" ON "leave_requests"("companyId");

-- CreateIndex
CREATE INDEX "leave_requests_employeeId_status_idx" ON "leave_requests"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_companyId_code_key" ON "shifts"("companyId", "code");

-- CreateIndex
CREATE INDEX "employee_shifts_employeeId_idx" ON "employee_shifts"("employeeId");

-- CreateIndex
CREATE INDEX "attendance_entries_companyId_date_idx" ON "attendance_entries"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_entries_employeeId_date_key" ON "attendance_entries"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_companyId_name_key" ON "onboarding_templates"("companyId", "name");

-- CreateIndex
CREATE INDEX "onboarding_template_items_templateId_idx" ON "onboarding_template_items"("templateId");

-- CreateIndex
CREATE INDEX "onboarding_instances_employeeId_idx" ON "onboarding_instances"("employeeId");

-- CreateIndex
CREATE INDEX "onboarding_instance_items_instanceId_idx" ON "onboarding_instance_items"("instanceId");

-- CreateIndex
CREATE INDEX "onboarding_instance_items_assigneeId_status_idx" ON "onboarding_instance_items"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "audit_events_companyId_at_idx" ON "audit_events"("companyId", "at");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_refType_refId_idx" ON "audit_events"("refType", "refId");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_dataClass_key" ON "retention_policies"("dataClass");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_companyId_key" ON "subscriptions"("companyId");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_idx" ON "subscription_events"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_number_key" ON "billing_invoices"("number");

-- CreateIndex
CREATE INDEX "billing_invoices_companyId_idx" ON "billing_invoices"("companyId");

-- CreateIndex
CREATE INDEX "billing_invoices_subscriptionId_idx" ON "billing_invoices"("subscriptionId");

-- CreateIndex
CREATE INDEX "billing_payments_invoiceId_idx" ON "billing_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "workflow_definitions_companyId_idx" ON "workflow_definitions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_companyId_key_version_key" ON "workflow_definitions"("companyId", "key", "version");

-- CreateIndex
CREATE INDEX "workflow_instances_companyId_status_idx" ON "workflow_instances"("companyId", "status");

-- CreateIndex
CREATE INDEX "workflow_instances_definitionId_idx" ON "workflow_instances"("definitionId");

-- CreateIndex
CREATE INDEX "workflow_instances_refType_refId_idx" ON "workflow_instances"("refType", "refId");

-- CreateIndex
CREATE INDEX "workflow_instances_resumeAt_idx" ON "workflow_instances"("resumeAt");

-- CreateIndex
CREATE INDEX "workflow_history_instanceId_idx" ON "workflow_history"("instanceId");

-- CreateIndex
CREATE INDEX "workflow_approvals_approverId_decision_idx" ON "workflow_approvals"("approverId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_approvals_instanceId_stepKey_approverId_key" ON "workflow_approvals"("instanceId", "stepKey", "approverId");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");

-- CreateIndex
CREATE INDEX "notifications_category_idx" ON "notifications"("category");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_channel_key" ON "notification_preferences"("userId", "category", "channel");

-- CreateIndex
CREATE INDEX "webhook_endpoints_companyId_idx" ON "webhook_endpoints"("companyId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_status_idx" ON "webhook_deliveries"("endpointId", "status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_eventKey_idx" ON "webhook_deliveries"("eventKey");

-- CreateIndex
CREATE INDEX "folders_companyId_idx" ON "folders"("companyId");

-- CreateIndex
CREATE INDEX "folders_parentId_idx" ON "folders"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "folders_companyId_parentId_name_key" ON "folders"("companyId", "parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "documents_currentVersionId_key" ON "documents"("currentVersionId");

-- CreateIndex
CREATE INDEX "documents_companyId_status_idx" ON "documents"("companyId", "status");

-- CreateIndex
CREATE INDEX "documents_folderId_idx" ON "documents"("folderId");

-- CreateIndex
CREATE INDEX "documents_refType_refId_idx" ON "documents"("refType", "refId");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "document_access_logs_documentId_at_idx" ON "document_access_logs"("documentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_documentId_idx" ON "share_links"("documentId");

-- CreateIndex
CREATE INDEX "accounts_companyId_type_idx" ON "accounts"("companyId", "type");

-- CreateIndex
CREATE INDEX "accounts_parentId_idx" ON "accounts"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_companyId_code_key" ON "accounts"("companyId", "code");

-- CreateIndex
CREATE INDEX "fiscal_periods_companyId_status_idx" ON "fiscal_periods"("companyId", "status");

-- CreateIndex
CREATE INDEX "fiscal_periods_companyId_startDate_endDate_idx" ON "fiscal_periods"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "fiscal_periods_parentId_idx" ON "fiscal_periods"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_companyId_name_key" ON "fiscal_periods"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_status_idx" ON "journal_entries"("companyId", "status");

-- CreateIndex
CREATE INDEX "journal_entries_periodId_idx" ON "journal_entries"("periodId");

-- CreateIndex
CREATE INDEX "journal_entries_source_sourceId_idx" ON "journal_entries"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_companyId_number_key" ON "journal_entries"("companyId", "number");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_bpId_idx" ON "journal_lines"("bpId");

-- CreateIndex
CREATE INDEX "journal_lines_costCenterId_idx" ON "journal_lines"("costCenterId");

-- CreateIndex
CREATE INDEX "exchange_rates_companyId_date_idx" ON "exchange_rates"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_companyId_baseCurrency_targetCurrency_date_key" ON "exchange_rates"("companyId", "baseCurrency", "targetCurrency", "date");

-- CreateIndex
CREATE INDEX "payment_terms_companyId_idx" ON "payment_terms"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_companyId_code_key" ON "payment_terms"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_journalEntryId_key" ON "ar_invoices"("journalEntryId");

-- CreateIndex
CREATE INDEX "ar_invoices_companyId_status_idx" ON "ar_invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "ar_invoices_bpId_idx" ON "ar_invoices"("bpId");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_companyId_number_key" ON "ar_invoices"("companyId", "number");

-- CreateIndex
CREATE INDEX "ar_invoice_lines_invoiceId_idx" ON "ar_invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ar_payments_journalEntryId_key" ON "ar_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "ar_payments_invoiceId_idx" ON "ar_payments"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_journalEntryId_key" ON "ap_bills"("journalEntryId");

-- CreateIndex
CREATE INDEX "ap_bills_companyId_status_idx" ON "ap_bills"("companyId", "status");

-- CreateIndex
CREATE INDEX "ap_bills_bpId_idx" ON "ap_bills"("bpId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_companyId_bpId_number_key" ON "ap_bills"("companyId", "bpId", "number");

-- CreateIndex
CREATE INDEX "ap_bill_lines_billId_idx" ON "ap_bill_lines"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payments_journalEntryId_key" ON "ap_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "ap_payments_billId_idx" ON "ap_payments"("billId");

-- CreateIndex
CREATE INDEX "attachments_companyId_entityType_entityId_idx" ON "attachments"("companyId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "company_settings_companyId_group_idx" ON "company_settings"("companyId", "group");

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_companyId_group_key_key" ON "company_settings"("companyId", "group", "key");

-- CreateIndex
CREATE INDEX "numbering_series_companyId_documentType_idx" ON "numbering_series"("companyId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "numbering_series_companyId_documentType_name_key" ON "numbering_series"("companyId", "documentType", "name");

-- CreateIndex
CREATE UNIQUE INDEX "document_settings_companyId_documentType_key" ON "document_settings"("companyId", "documentType");

-- CreateIndex
CREATE INDEX "user_groups_companyId_idx" ON "user_groups"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_companyId_code_key" ON "user_groups"("companyId", "code");

-- CreateIndex
CREATE INDEX "user_group_members_userId_idx" ON "user_group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_members_groupId_userId_key" ON "user_group_members"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_defaults_groups_companyId_code_key" ON "user_defaults_groups"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "predefined_texts_companyId_code_key" ON "predefined_texts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "countries_companyId_code_key" ON "countries"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "state_regions_countryId_code_key" ON "state_regions"("countryId", "code");

-- CreateIndex
CREATE INDEX "alert_definitions_companyId_isActive_idx" ON "alert_definitions"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "alert_definitions_companyId_name_key" ON "alert_definitions"("companyId", "name");

-- CreateIndex
CREATE INDEX "alert_subscriptions_userId_idx" ON "alert_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_subscriptions_alertId_userId_key" ON "alert_subscriptions"("alertId", "userId");

-- CreateIndex
CREATE INDEX "alert_instances_userId_readAt_idx" ON "alert_instances"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_stages_companyId_name_key" ON "approval_stages"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "approval_stage_approvers_stageId_userId_key" ON "approval_stage_approvers"("stageId", "userId");

-- CreateIndex
CREATE INDEX "approval_templates_companyId_isActive_idx" ON "approval_templates"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "approval_templates_companyId_name_key" ON "approval_templates"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "approval_template_originators_templateId_userId_key" ON "approval_template_originators"("templateId", "userId");

-- CreateIndex
CREATE INDEX "approval_template_stages_templateId_ordering_idx" ON "approval_template_stages"("templateId", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "approval_template_stages_templateId_stageId_key" ON "approval_template_stages"("templateId", "stageId");

-- CreateIndex
CREATE INDEX "approval_requests_companyId_status_idx" ON "approval_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "approval_requests_documentType_documentId_idx" ON "approval_requests"("documentType", "documentId");

-- CreateIndex
CREATE INDEX "approval_request_stages_requestId_ordering_idx" ON "approval_request_stages"("requestId", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_stages_requestId_stageId_key" ON "approval_request_stages"("requestId", "stageId");

-- CreateIndex
CREATE INDEX "document_approval_decisions_requestId_idx" ON "document_approval_decisions"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "document_approval_decisions_requestStageId_approverId_key" ON "document_approval_decisions"("requestStageId", "approverId");

-- CreateIndex
CREATE INDEX "substitute_authorizers_companyId_isActive_idx" ON "substitute_authorizers"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "substitute_authorizers_originalUserId_idx" ON "substitute_authorizers"("originalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "bp_groups_companyId_type_code_key" ON "bp_groups"("companyId", "type", "code");

-- CreateIndex
CREATE INDEX "business_partners_companyId_cardType_idx" ON "business_partners"("companyId", "cardType");

-- CreateIndex
CREATE INDEX "business_partners_companyId_cardName_idx" ON "business_partners"("companyId", "cardName");

-- CreateIndex
CREATE UNIQUE INDEX "business_partners_companyId_cardCode_key" ON "business_partners"("companyId", "cardCode");

-- CreateIndex
CREATE INDEX "bp_contact_persons_bpId_idx" ON "bp_contact_persons"("bpId");

-- CreateIndex
CREATE INDEX "bp_addresses_bpId_idx" ON "bp_addresses"("bpId");

-- CreateIndex
CREATE UNIQUE INDEX "bp_addresses_bpId_addressType_addressName_key" ON "bp_addresses"("bpId", "addressType", "addressName");

-- CreateIndex
CREATE INDEX "bp_bank_accounts_bpId_idx" ON "bp_bank_accounts"("bpId");

-- CreateIndex
CREATE UNIQUE INDEX "bp_relationship_types_companyId_code_key" ON "bp_relationship_types"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bp_relationships_fromBpId_toBpId_typeId_key" ON "bp_relationships"("fromBpId", "toBpId", "typeId");

-- CreateIndex
CREATE INDEX "territories_parentId_idx" ON "territories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "territories_companyId_name_key" ON "territories"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "commission_groups_companyId_code_key" ON "commission_groups"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_employees_userId_key" ON "sales_employees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_employees_employeeId_key" ON "sales_employees"("employeeId");

-- CreateIndex
CREATE INDEX "sales_employees_companyId_isActive_idx" ON "sales_employees"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "sales_employees_companyId_code_key" ON "sales_employees"("companyId", "code");

-- CreateIndex
CREATE INDEX "activities_companyId_status_idx" ON "activities"("companyId", "status");

-- CreateIndex
CREATE INDEX "activities_bpId_idx" ON "activities"("bpId");

-- CreateIndex
CREATE INDEX "activities_assignedToUserId_status_idx" ON "activities"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "activities_companyId_startDate_idx" ON "activities"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "activities_companyId_docNumber_key" ON "activities"("companyId", "docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_stage_defs_companyId_stageNo_key" ON "opportunity_stage_defs"("companyId", "stageNo");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_companyId_code_key" ON "competitors"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "crm_partners_companyId_code_key" ON "crm_partners"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "information_sources_companyId_code_key" ON "information_sources"("companyId", "code");

-- CreateIndex
CREATE INDEX "opportunities_companyId_status_idx" ON "opportunities"("companyId", "status");

-- CreateIndex
CREATE INDEX "opportunities_bpId_idx" ON "opportunities"("bpId");

-- CreateIndex
CREATE INDEX "opportunities_salesEmployeeId_idx" ON "opportunities"("salesEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_companyId_docNumber_key" ON "opportunities"("companyId", "docNumber");

-- CreateIndex
CREATE INDEX "opportunity_stage_entries_opportunityId_ordering_idx" ON "opportunity_stage_entries"("opportunityId", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_competitors_opportunityId_competitorId_key" ON "opportunity_competitors"("opportunityId", "competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_partners_opportunityId_partnerId_key" ON "opportunity_partners"("opportunityId", "partnerId");

-- CreateIndex
CREATE INDEX "campaigns_companyId_status_idx" ON "campaigns"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_companyId_campaignNumber_key" ON "campaigns"("companyId", "campaignNumber");

-- CreateIndex
CREATE INDEX "campaign_targets_campaignId_idx" ON "campaign_targets"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_companyId_code_key" ON "currencies"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "account_determinations_companyId_area_key_key" ON "account_determinations"("companyId", "area", "key");

-- CreateIndex
CREATE UNIQUE INDEX "finance_projects_companyId_code_key" ON "finance_projects"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_codes_companyId_code_key" ON "transaction_codes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_companyId_code_key" ON "tax_codes"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flow_line_items_companyId_code_key" ON "cash_flow_line_items"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "posting_templates_companyId_code_key" ON "posting_templates"("companyId", "code");

-- CreateIndex
CREATE INDEX "posting_template_lines_templateId_ordering_idx" ON "posting_template_lines"("templateId", "ordering");

-- CreateIndex
CREATE INDEX "recurring_postings_companyId_isActive_nextExecution_idx" ON "recurring_postings"("companyId", "isActive", "nextExecution");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_postings_companyId_code_key" ON "recurring_postings"("companyId", "code");

-- CreateIndex
CREATE INDEX "recurring_posting_lines_recurringId_idx" ON "recurring_posting_lines"("recurringId");

-- CreateIndex
CREATE UNIQUE INDEX "dimensions_companyId_dimensionNo_key" ON "dimensions"("companyId", "dimensionNo");

-- CreateIndex
CREATE INDEX "cost_centers_companyId_idx" ON "cost_centers"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_companyId_dimensionId_code_key" ON "cost_centers"("companyId", "dimensionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_rules_companyId_dimensionId_code_key" ON "distribution_rules"("companyId", "dimensionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_rule_lines_ruleId_costCenterId_key" ON "distribution_rule_lines"("ruleId", "costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_scenarios_companyId_code_key" ON "budget_scenarios"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "budget_distribution_methods_companyId_code_key" ON "budget_distribution_methods"("companyId", "code");

-- CreateIndex
CREATE INDEX "budget_lines_companyId_scenarioId_idx" ON "budget_lines"("companyId", "scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_scenarioId_accountId_costCenterId_periodId_key" ON "budget_lines"("scenarioId", "accountId", "costCenterId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "banks_companyId_code_key" ON "banks"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "house_bank_accounts_companyId_bankId_accountNo_key" ON "house_bank_accounts"("companyId", "bankId", "accountNo");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_companyId_code_key" ON "payment_methods"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dunning_terms_companyId_code_key" ON "dunning_terms"("companyId", "code");

-- CreateIndex
CREATE INDEX "internal_reconciliations_companyId_bpId_idx" ON "internal_reconciliations"("companyId", "bpId");

-- CreateIndex
CREATE INDEX "internal_reconciliation_lines_reconciliationId_idx" ON "internal_reconciliation_lines"("reconciliationId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_status_idx" ON "fixed_assets"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_companyId_code_key" ON "fixed_assets"("companyId", "code");

-- CreateIndex
CREATE INDEX "fixed_asset_transactions_assetId_postingDate_idx" ON "fixed_asset_transactions"("assetId", "postingDate");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "departments_branchId_idx" ON "departments"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_branchId_idx" ON "employees"("branchId");

-- CreateIndex
CREATE INDEX "employees_managerId_idx" ON "employees"("managerId");

-- CreateIndex
CREATE INDEX "employees_positionId_idx" ON "employees"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_moduleSlug_idx" ON "permissions"("moduleSlug");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "role_permissions_roleId_idx" ON "role_permissions"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_scope_key" ON "role_permissions"("roleId", "permissionId", "scope");

-- CreateIndex
CREATE INDEX "users_branchId_idx" ON "users"("branchId");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_userDefaultsGroupId_fkey" FOREIGN KEY ("userDefaultsGroupId") REFERENCES "user_defaults_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_sourceRoleId_fkey" FOREIGN KEY ("sourceRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_sets" ADD CONSTRAINT "permission_sets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_set_items" ADD CONSTRAINT "permission_set_items_setId_fkey" FOREIGN KEY ("setId") REFERENCES "permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_set_items" ADD CONSTRAINT "permission_set_items_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission_sets" ADD CONSTRAINT "role_permission_sets_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission_sets" ADD CONSTRAINT "role_permission_sets_setId_fkey" FOREIGN KEY ("setId") REFERENCES "permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_items" ADD CONSTRAINT "onboarding_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "onboarding_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "onboarding_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instance_items" ADD CONSTRAINT "onboarding_instance_items_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "onboarding_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "system_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "billing_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_cashFlowLineItemId_fkey" FOREIGN KEY ("cashFlowLineItemId") REFERENCES "cash_flow_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "numbering_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transactionCodeId_fkey" FOREIGN KEY ("transactionCodeId") REFERENCES "transaction_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "finance_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "posting_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_distributionRuleId_fkey" FOREIGN KEY ("distributionRuleId") REFERENCES "distribution_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "finance_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_settings" ADD CONSTRAINT "document_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_defaults_groups" ADD CONSTRAINT "user_defaults_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predefined_texts" ADD CONSTRAINT "predefined_texts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_regions" ADD CONSTRAINT "state_regions_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_definitions" ADD CONSTRAINT "alert_definitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alert_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_instances" ADD CONSTRAINT "alert_instances_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alert_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_instances" ADD CONSTRAINT "alert_instances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stage_approvers" ADD CONSTRAINT "approval_stage_approvers_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "approval_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stage_approvers" ADD CONSTRAINT "approval_stage_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_templates" ADD CONSTRAINT "approval_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_template_originators" ADD CONSTRAINT "approval_template_originators_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "approval_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_template_originators" ADD CONSTRAINT "approval_template_originators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_template_stages" ADD CONSTRAINT "approval_template_stages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "approval_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_template_stages" ADD CONSTRAINT "approval_template_stages_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "approval_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "approval_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_originatorId_fkey" FOREIGN KEY ("originatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request_stages" ADD CONSTRAINT "approval_request_stages_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request_stages" ADD CONSTRAINT "approval_request_stages_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "approval_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approval_decisions" ADD CONSTRAINT "document_approval_decisions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approval_decisions" ADD CONSTRAINT "document_approval_decisions_requestStageId_fkey" FOREIGN KEY ("requestStageId") REFERENCES "approval_request_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_approval_decisions" ADD CONSTRAINT "document_approval_decisions_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitute_authorizers" ADD CONSTRAINT "substitute_authorizers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitute_authorizers" ADD CONSTRAINT "substitute_authorizers_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "approval_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitute_authorizers" ADD CONSTRAINT "substitute_authorizers_originalUserId_fkey" FOREIGN KEY ("originalUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitute_authorizers" ADD CONSTRAINT "substitute_authorizers_substituteUserId_fkey" FOREIGN KEY ("substituteUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_groups" ADD CONSTRAINT "bp_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "bp_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_salesEmployeeId_fkey" FOREIGN KEY ("salesEmployeeId") REFERENCES "sales_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_dunningTermId_fkey" FOREIGN KEY ("dunningTermId") REFERENCES "dunning_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_contact_persons" ADD CONSTRAINT "bp_contact_persons_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_addresses" ADD CONSTRAINT "bp_addresses_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_bank_accounts" ADD CONSTRAINT "bp_bank_accounts_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_relationship_types" ADD CONSTRAINT "bp_relationship_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_relationships" ADD CONSTRAINT "bp_relationships_fromBpId_fkey" FOREIGN KEY ("fromBpId") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_relationships" ADD CONSTRAINT "bp_relationships_toBpId_fkey" FOREIGN KEY ("toBpId") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bp_relationships" ADD CONSTRAINT "bp_relationships_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "bp_relationship_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_groups" ADD CONSTRAINT "commission_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_employees" ADD CONSTRAINT "sales_employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_employees" ADD CONSTRAINT "sales_employees_commissionGroupId_fkey" FOREIGN KEY ("commissionGroupId") REFERENCES "commission_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_employees" ADD CONSTRAINT "sales_employees_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_employees" ADD CONSTRAINT "sales_employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_employees" ADD CONSTRAINT "sales_employees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "bp_contact_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_parentActivityId_fkey" FOREIGN KEY ("parentActivityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_defs" ADD CONSTRAINT "opportunity_stage_defs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_partners" ADD CONSTRAINT "crm_partners_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "information_sources" ADD CONSTRAINT "information_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "bp_contact_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_salesEmployeeId_fkey" FOREIGN KEY ("salesEmployeeId") REFERENCES "sales_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "opportunity_stage_defs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_informationSourceId_fkey" FOREIGN KEY ("informationSourceId") REFERENCES "information_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_entries" ADD CONSTRAINT "opportunity_stage_entries_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_entries" ADD CONSTRAINT "opportunity_stage_entries_stageDefId_fkey" FOREIGN KEY ("stageDefId") REFERENCES "opportunity_stage_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_entries" ADD CONSTRAINT "opportunity_stage_entries_salesEmployeeId_fkey" FOREIGN KEY ("salesEmployeeId") REFERENCES "sales_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_entries" ADD CONSTRAINT "opportunity_stage_entries_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_competitors" ADD CONSTRAINT "opportunity_competitors_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_competitors" ADD CONSTRAINT "opportunity_competitors_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_partners" ADD CONSTRAINT "opportunity_partners_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_partners" ADD CONSTRAINT "opportunity_partners_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "crm_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_salesEmployeeId_fkey" FOREIGN KEY ("salesEmployeeId") REFERENCES "sales_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "bp_contact_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_determinations" ADD CONSTRAINT "account_determinations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_determinations" ADD CONSTRAINT "account_determinations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_projects" ADD CONSTRAINT "finance_projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_codes" ADD CONSTRAINT "transaction_codes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flow_line_items" ADD CONSTRAINT "cash_flow_line_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flow_line_items" ADD CONSTRAINT "cash_flow_line_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cash_flow_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_templates" ADD CONSTRAINT "posting_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_template_lines" ADD CONSTRAINT "posting_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "posting_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_template_lines" ADD CONSTRAINT "posting_template_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_postings" ADD CONSTRAINT "recurring_postings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_posting_lines" ADD CONSTRAINT "recurring_posting_lines_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "recurring_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_posting_lines" ADD CONSTRAINT "recurring_posting_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimensions" ADD CONSTRAINT "dimensions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rules" ADD CONSTRAINT "distribution_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rules" ADD CONSTRAINT "distribution_rules_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rule_lines" ADD CONSTRAINT "distribution_rule_lines_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "distribution_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rule_lines" ADD CONSTRAINT "distribution_rule_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_scenarios" ADD CONSTRAINT "budget_scenarios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_scenarios" ADD CONSTRAINT "budget_scenarios_basedOnScenarioId_fkey" FOREIGN KEY ("basedOnScenarioId") REFERENCES "budget_scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_distribution_methods" ADD CONSTRAINT "budget_distribution_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "budget_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_distributionMethodId_fkey" FOREIGN KEY ("distributionMethodId") REFERENCES "budget_distribution_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banks" ADD CONSTRAINT "banks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_bank_accounts" ADD CONSTRAINT "house_bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_bank_accounts" ADD CONSTRAINT "house_bank_accounts_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_bank_accounts" ADD CONSTRAINT "house_bank_accounts_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_houseBankAccountId_fkey" FOREIGN KEY ("houseBankAccountId") REFERENCES "house_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_terms" ADD CONSTRAINT "dunning_terms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_reconciliations" ADD CONSTRAINT "internal_reconciliations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_reconciliations" ADD CONSTRAINT "internal_reconciliations_bpId_fkey" FOREIGN KEY ("bpId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_reconciliation_lines" ADD CONSTRAINT "internal_reconciliation_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "internal_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_reconciliation_lines" ADD CONSTRAINT "internal_reconciliation_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_costAccountId_fkey" FOREIGN KEY ("costAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciationAccountId_fkey" FOREIGN KEY ("depreciationAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accumulatedAccountId_fkey" FOREIGN KEY ("accumulatedAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transactions" ADD CONSTRAINT "fixed_asset_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

