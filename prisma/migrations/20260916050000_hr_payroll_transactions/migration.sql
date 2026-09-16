-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "contactNo" TEXT,
ADD COLUMN     "leaveDurationType" TEXT DEFAULT 'Full',
ADD COLUMN     "preparedBy" TEXT,
ADD COLUMN     "signedBy" TEXT;

-- CreateTable
CREATE TABLE "monthly_attendance_sheets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "payPeriodId" TEXT,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "payPeriodMonth" TEXT,
    "docType" TEXT,
    "status" TEXT DEFAULT 'Open',
    "year" INTEGER,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_attendance_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sheet_lines" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "idNo" TEXT,
    "totalDays" DECIMAL(19,4),
    "workingDays" DECIMAL(19,4),
    "presentDays" DECIMAL(19,4),
    "lopDays" DECIMAL(19,4),
    "payableLeaves" DECIMAL(19,4),
    "otHours" DECIMAL(19,4),
    "shortTimeHours" DECIMAL(19,4),
    "normalOtHours" DECIMAL(19,4),
    "sunday" DECIMAL(19,4),
    "misBioMaterDays" DECIMAL(19,4),
    "compOffDays" DECIMAL(19,4),
    "annualLeave" DECIMAL(19,4),
    "halfDayLeave" DECIMAL(19,4),
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attendance_sheet_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeType" TEXT,
    "payPeriodId" TEXT,
    "payMonth" TEXT,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "jeNo" TEXT,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT DEFAULT 'Open',
    "cancellationJeNo" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeType" TEXT,
    "totalDaysWorking" DECIMAL(19,4),
    "lopDays" DECIMAL(19,4),
    "totalDaysWorked" DECIMAL(19,4),
    "paidDays" DECIMAL(19,4),
    "payLeaves" DECIMAL(19,4),
    "basic" DECIMAL(19,4),
    "entertainment" DECIMAL(19,4),
    "eligibleBasic" DECIMAL(19,4),
    "conveyance" DECIMAL(19,4),
    "education" DECIMAL(19,4),
    "eligibleConveyance" DECIMAL(19,4),
    "hra" DECIMAL(19,4),
    "bigCity" DECIMAL(19,4),
    "eligibleHra" DECIMAL(19,4),
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeType" TEXT,
    "payPeriodId" TEXT,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT DEFAULT 'Open',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustment_lines" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "idNo" TEXT,
    "arrears" DECIMAL(19,4),
    "generalDeduction" DECIMAL(19,4),
    "carAllowance" DECIMAL(19,4),
    "carInsLaptopDed" DECIMAL(19,4),
    "taDa" DECIMAL(19,4),
    "dowryAllowance" DECIMAL(19,4),
    "taxableAddition" DECIMAL(19,4),
    "fuel" DECIMAL(19,4),
    "messDeduction" DECIMAL(19,4),
    "generalDeduction2" DECIMAL(19,4),
    "carInsLaptopDed2" DECIMAL(19,4),
    "loanDeduction" DECIMAL(19,4),
    "deduction11" DECIMAL(19,4),
    "deduction12" DECIMAL(19,4),
    "deduction13" DECIMAL(19,4),
    "deduction14" DECIMAL(19,4),
    "deduction15" DECIMAL(19,4),
    "amount" DECIMAL(19,4),
    "remarks" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_loans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "loanTypeId" TEXT NOT NULL,
    "loanAmount" DECIMAL(19,4) NOT NULL,
    "sanctionedAmount" DECIMAL(19,4),
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT DEFAULT 'Open',
    "effectivePayPeriodId" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "noOfInstallments" INTEGER,
    "amountPerMonth" DECIMAL(19,4),
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_loan_installments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "month" TEXT,
    "year" INTEGER,
    "dueDate" TIMESTAMP(3),
    "amount" DECIMAL(19,4) NOT NULL,
    "status" TEXT DEFAULT 'Pending',

    CONSTRAINT "employee_loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_attendance_sheets_companyId_idx" ON "monthly_attendance_sheets"("companyId");

-- CreateIndex
CREATE INDEX "monthly_attendance_sheets_payPeriodId_idx" ON "monthly_attendance_sheets"("payPeriodId");

-- CreateIndex
CREATE INDEX "monthly_attendance_sheets_branchId_idx" ON "monthly_attendance_sheets"("branchId");

-- CreateIndex
CREATE INDEX "attendance_sheet_lines_sheetId_idx" ON "attendance_sheet_lines"("sheetId");

-- CreateIndex
CREATE INDEX "attendance_sheet_lines_employeeId_idx" ON "attendance_sheet_lines"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sheet_lines_sheetId_employeeId_key" ON "attendance_sheet_lines"("sheetId", "employeeId");

-- CreateIndex
CREATE INDEX "payroll_runs_companyId_idx" ON "payroll_runs"("companyId");

-- CreateIndex
CREATE INDEX "payroll_runs_payPeriodId_idx" ON "payroll_runs"("payPeriodId");

-- CreateIndex
CREATE INDEX "payroll_run_lines_payrollRunId_idx" ON "payroll_run_lines"("payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_run_lines_employeeId_idx" ON "payroll_run_lines"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_payrollRunId_employeeId_key" ON "payroll_run_lines"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "payroll_adjustments_companyId_idx" ON "payroll_adjustments"("companyId");

-- CreateIndex
CREATE INDEX "payroll_adjustments_payPeriodId_idx" ON "payroll_adjustments"("payPeriodId");

-- CreateIndex
CREATE INDEX "payroll_adjustment_lines_adjustmentId_idx" ON "payroll_adjustment_lines"("adjustmentId");

-- CreateIndex
CREATE INDEX "payroll_adjustment_lines_employeeId_idx" ON "payroll_adjustment_lines"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_adjustment_lines_adjustmentId_employeeId_key" ON "payroll_adjustment_lines"("adjustmentId", "employeeId");

-- CreateIndex
CREATE INDEX "employee_loans_companyId_idx" ON "employee_loans"("companyId");

-- CreateIndex
CREATE INDEX "employee_loans_employeeId_idx" ON "employee_loans"("employeeId");

-- CreateIndex
CREATE INDEX "employee_loans_loanTypeId_idx" ON "employee_loans"("loanTypeId");

-- CreateIndex
CREATE INDEX "employee_loans_effectivePayPeriodId_idx" ON "employee_loans"("effectivePayPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_loans_companyId_code_key" ON "employee_loans"("companyId", "code");

-- CreateIndex
CREATE INDEX "employee_loan_installments_loanId_idx" ON "employee_loan_installments"("loanId");

-- AddForeignKey
ALTER TABLE "monthly_attendance_sheets" ADD CONSTRAINT "monthly_attendance_sheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_attendance_sheets" ADD CONSTRAINT "monthly_attendance_sheets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_attendance_sheets" ADD CONSTRAINT "monthly_attendance_sheets_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "pay_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sheet_lines" ADD CONSTRAINT "attendance_sheet_lines_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "monthly_attendance_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sheet_lines" ADD CONSTRAINT "attendance_sheet_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "pay_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "pay_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustment_lines" ADD CONSTRAINT "payroll_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "payroll_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustment_lines" ADD CONSTRAINT "payroll_adjustment_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_loanTypeId_fkey" FOREIGN KEY ("loanTypeId") REFERENCES "loan_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_effectivePayPeriodId_fkey" FOREIGN KEY ("effectivePayPeriodId") REFERENCES "pay_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loan_installments" ADD CONSTRAINT "employee_loan_installments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "employee_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

