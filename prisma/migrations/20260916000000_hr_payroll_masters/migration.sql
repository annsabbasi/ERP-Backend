-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "address1" TEXT,
ADD COLUMN     "address2" TEXT,
ADD COLUMN     "address3" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "currentShiftId" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "dateOfJoining" TIMESTAMP(3),
ADD COLUMN     "employeeCategoryId" TEXT,
ADD COLUMN     "esiNo" TEXT,
ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "fuelLiters" DECIMAL(19,4),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "gradeId" TEXT,
ADD COLUMN     "insurancePolicyNo" TEXT,
ADD COLUMN     "locationProjectSite" TEXT,
ADD COLUMN     "mobilePhone2" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "originalDateOfBirth" TIMESTAMP(3),
ADD COLUMN     "otherInfo" TEXT,
ADD COLUMN     "pfNo" TEXT,
ADD COLUMN     "pinCode" TEXT,
ADD COLUMN     "sectionType" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "applicableDuringProbation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "carryForwardToNextYear" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "encashable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaveCategory" TEXT DEFAULT 'Others',
ADD COLUMN     "maxContinuousDays" DECIMAL(19,4),
ADD COLUMN     "maxContinuousDurationProb" DECIMAL(19,4),
ADD COLUMN     "maxLeaveCarryForward" DECIMAL(19,4),
ADD COLUMN     "maxLeaveToEncash" DECIMAL(19,4),
ADD COLUMN     "maxMonthlyApplications" DECIMAL(19,4),
ADD COLUMN     "minBalanceForEncash" DECIMAL(19,4),
ADD COLUMN     "minContinuousDays" DECIMAL(19,4),
ADD COLUMN     "minContinuousDurationProb" DECIMAL(19,4),
ADD COLUMN     "payableLeave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "totalLeavesInYear" DECIMAL(19,4),
ADD COLUMN     "totalLeavesInYearForTrainer" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "remarks" TEXT;

-- CreateTable
CREATE TABLE "leave_type_date_ranges" (
    "id" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "leave_type_date_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "overtimeRatePerHour" DECIMAL(19,4),
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_pay_scale_stages" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "basicPay" DECIMAL(19,4),
    "hra" DECIMAL(19,4),
    "utilityAllowance" DECIMAL(19,4),
    "medicalAllowance" DECIMAL(19,4),
    "conveyanceAllowance" DECIMAL(19,4),
    "adhoc2017" DECIMAL(19,4),
    "adhoc2018" DECIMAL(19,4),

    CONSTRAINT "grade_pay_scale_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "loanType" TEXT NOT NULL DEFAULT 'Personal',
    "maxAmount" DECIMAL(19,4),
    "rateOfInterest" DECIMAL(19,4),
    "minRepaymentAmount" DECIMAL(19,4),
    "maxInstallments" INTEGER,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_periods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "payMonth" TEXT,
    "workingDays" INTEGER,
    "saturdays" INTEGER,
    "holidays" INTEGER,
    "maxNormalOtHoursMonth" DECIMAL(19,4),
    "maxWorkingHoursMonth" DECIMAL(19,4),
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_formulas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "employeeCategoryId" TEXT,
    "periodYear" INTEGER,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "startYear" INTEGER,
    "noOfMonths" INTEGER,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_formulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_slabs" (
    "id" TEXT NOT NULL,
    "taxFormulaId" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "lowerAmount" DECIMAL(19,4) NOT NULL,
    "higherAmount" DECIMAL(19,4),
    "percentage" DECIMAL(9,4) NOT NULL,

    CONSTRAINT "tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_type_date_ranges_leaveTypeId_idx" ON "leave_type_date_ranges"("leaveTypeId");

-- CreateIndex
CREATE INDEX "employee_categories_companyId_idx" ON "employee_categories"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_categories_companyId_code_key" ON "employee_categories"("companyId", "code");

-- CreateIndex
CREATE INDEX "grades_companyId_idx" ON "grades"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "grades_companyId_code_key" ON "grades"("companyId", "code");

-- CreateIndex
CREATE INDEX "grade_pay_scale_stages_gradeId_idx" ON "grade_pay_scale_stages"("gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "grade_pay_scale_stages_gradeId_stage_key" ON "grade_pay_scale_stages"("gradeId", "stage");

-- CreateIndex
CREATE INDEX "loan_types_companyId_idx" ON "loan_types"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_types_companyId_code_key" ON "loan_types"("companyId", "code");

-- CreateIndex
CREATE INDEX "pay_periods_companyId_idx" ON "pay_periods"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "pay_periods_companyId_code_key" ON "pay_periods"("companyId", "code");

-- CreateIndex
CREATE INDEX "tax_formulas_companyId_idx" ON "tax_formulas"("companyId");

-- CreateIndex
CREATE INDEX "tax_formulas_employeeCategoryId_idx" ON "tax_formulas"("employeeCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_formulas_companyId_code_key" ON "tax_formulas"("companyId", "code");

-- CreateIndex
CREATE INDEX "tax_slabs_taxFormulaId_idx" ON "tax_slabs"("taxFormulaId");

-- CreateIndex
CREATE INDEX "employees_employeeCategoryId_idx" ON "employees"("employeeCategoryId");

-- CreateIndex
CREATE INDEX "employees_gradeId_idx" ON "employees"("gradeId");

-- CreateIndex
CREATE INDEX "employees_currentShiftId_idx" ON "employees"("currentShiftId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_employeeCategoryId_fkey" FOREIGN KEY ("employeeCategoryId") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_currentShiftId_fkey" FOREIGN KEY ("currentShiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_type_date_ranges" ADD CONSTRAINT "leave_type_date_ranges_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_categories" ADD CONSTRAINT "employee_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_pay_scale_stages" ADD CONSTRAINT "grade_pay_scale_stages_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_types" ADD CONSTRAINT "loan_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_formulas" ADD CONSTRAINT "tax_formulas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_formulas" ADD CONSTRAINT "tax_formulas_employeeCategoryId_fkey" FOREIGN KEY ("employeeCategoryId") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_slabs" ADD CONSTRAINT "tax_slabs_taxFormulaId_fkey" FOREIGN KEY ("taxFormulaId") REFERENCES "tax_formulas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

