import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── MONTHLY ATTENDANCE SHEET ───────────────────────────────────────────────────
export class CreateAttendanceSheetDto {
  @IsUUID() @IsOptional() branchId?: string;
  @IsUUID() @IsOptional() payPeriodId?: string;
  @IsDateString() @IsOptional() fromDate?: string;
  @IsDateString() @IsOptional() toDate?: string;
  @IsString() @IsOptional() payPeriodMonth?: string;
  @IsString() @IsOptional() docType?: string;
  @IsString() @IsOptional() status?: string;
  @IsInt() @IsOptional() @Type(() => Number) year?: number;
  @IsString() @IsOptional() remarks?: string;
}
export class UpdateAttendanceSheetDto extends PartialType(CreateAttendanceSheetDto) {}

export class AttendanceSheetLineRowDto {
  @IsUUID() employeeId: string;
  @IsString() @IsOptional() idNo?: string;
  @IsNumber() @IsOptional() @Type(() => Number) totalDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) workingDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) presentDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) lopDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) payableLeaves?: number;
  @IsNumber() @IsOptional() @Type(() => Number) otHours?: number;
  @IsNumber() @IsOptional() @Type(() => Number) shortTimeHours?: number;
  @IsNumber() @IsOptional() @Type(() => Number) normalOtHours?: number;
  @IsNumber() @IsOptional() @Type(() => Number) sunday?: number;
  @IsNumber() @IsOptional() @Type(() => Number) misBioMaterDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) compOffDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) annualLeave?: number;
  @IsNumber() @IsOptional() @Type(() => Number) halfDayLeave?: number;
}
export class ReplaceAttendanceSheetLinesDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => AttendanceSheetLineRowDto)
  rows: AttendanceSheetLineRowDto[];
}

// ─── PAYROLL PROCESS (PayrollRun) ───────────────────────────────────────────────
export class CreatePayrollRunDto {
  @IsString() @IsOptional() employeeType?: string;
  @IsUUID() @IsOptional() payPeriodId?: string;
  @IsString() @IsOptional() payMonth?: string;
  @IsDateString() @IsOptional() fromDate?: string;
  @IsDateString() @IsOptional() toDate?: string;
  @IsString() @IsOptional() jeNo?: string;
  @IsDateString() @IsOptional() documentDate?: string;
  @IsString() @IsOptional() status?: string;
  @IsString() @IsOptional() cancellationJeNo?: string;
  @IsString() @IsOptional() remarks?: string;
}
export class UpdatePayrollRunDto extends PartialType(CreatePayrollRunDto) {}

export class PayrollRunLineRowDto {
  @IsUUID() employeeId: string;
  @IsString() @IsOptional() employeeType?: string;
  @IsNumber() @IsOptional() @Type(() => Number) totalDaysWorking?: number;
  @IsNumber() @IsOptional() @Type(() => Number) lopDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) totalDaysWorked?: number;
  @IsNumber() @IsOptional() @Type(() => Number) paidDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) payLeaves?: number;
  @IsNumber() @IsOptional() @Type(() => Number) basic?: number;
  @IsNumber() @IsOptional() @Type(() => Number) entertainment?: number;
  @IsNumber() @IsOptional() @Type(() => Number) eligibleBasic?: number;
  @IsNumber() @IsOptional() @Type(() => Number) conveyance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) education?: number;
  @IsNumber() @IsOptional() @Type(() => Number) eligibleConveyance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) hra?: number;
  @IsNumber() @IsOptional() @Type(() => Number) bigCity?: number;
  @IsNumber() @IsOptional() @Type(() => Number) eligibleHra?: number;

  // ── Payslip inputs a user can type over Generate's suggestion ──
  // grossPay / totalEarnings / totalDeductions / netPay are deliberately NOT
  // accepted here — they are always server-derived from the fields above in
  // PayrollRunsService.replaceLines, never trusted from the client.
  @IsNumber() @IsOptional() @Type(() => Number) perDayRate?: number;
  @IsNumber() @IsOptional() @Type(() => Number) paidLeaveDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) unpaidLeaveDays?: number;
  @IsNumber() @IsOptional() @Type(() => Number) lopDeduction?: number;
  @IsNumber() @IsOptional() @Type(() => Number) loanDeduction?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxableGross?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxDeduction?: number;
  @IsNumber() @IsOptional() @Type(() => Number) adjustmentAdditions?: number;
  @IsNumber() @IsOptional() @Type(() => Number) adjustmentDeductions?: number;
}
export class ReplacePayrollRunLinesDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PayrollRunLineRowDto)
  rows: PayrollRunLineRowDto[];
}

// ─── PAYROLL MONTHLY ADJUSTMENTS ───────────────────────────────────────────────
export class CreatePayrollAdjustmentDto {
  @IsString() @IsOptional() employeeType?: string;
  @IsUUID() @IsOptional() payPeriodId?: string;
  @IsDateString() @IsOptional() documentDate?: string;
  @IsString() @IsOptional() status?: string;
  @IsString() @IsOptional() remarks?: string;
}
export class UpdatePayrollAdjustmentDto extends PartialType(CreatePayrollAdjustmentDto) {}

export class PayrollAdjustmentLineRowDto {
  @IsUUID() employeeId: string;
  @IsString() @IsOptional() idNo?: string;
  @IsNumber() @IsOptional() @Type(() => Number) arrears?: number;
  @IsNumber() @IsOptional() @Type(() => Number) generalDeduction?: number;
  @IsNumber() @IsOptional() @Type(() => Number) carAllowance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) carInsLaptopDed?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taDa?: number;
  @IsNumber() @IsOptional() @Type(() => Number) dowryAllowance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxableAddition?: number;
  @IsNumber() @IsOptional() @Type(() => Number) fuel?: number;
  @IsNumber() @IsOptional() @Type(() => Number) messDeduction?: number;
  @IsNumber() @IsOptional() @Type(() => Number) generalDeduction2?: number;
  @IsNumber() @IsOptional() @Type(() => Number) carInsLaptopDed2?: number;
  @IsNumber() @IsOptional() @Type(() => Number) loanDeduction?: number;
  @IsNumber() @IsOptional() @Type(() => Number) deduction11?: number;
  @IsNumber() @IsOptional() @Type(() => Number) deduction12?: number;
  @IsNumber() @IsOptional() @Type(() => Number) deduction13?: number;
  @IsNumber() @IsOptional() @Type(() => Number) deduction14?: number;
  @IsNumber() @IsOptional() @Type(() => Number) deduction15?: number;
  @IsNumber() @IsOptional() @Type(() => Number) amount?: number;
  @IsString() @IsOptional() remarks?: string;
}
export class ReplacePayrollAdjustmentLinesDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PayrollAdjustmentLineRowDto)
  rows: PayrollAdjustmentLineRowDto[];
}

// ─── LOAN APPLICATION (EmployeeLoan) ───────────────────────────────────────────
export class CreateEmployeeLoanDto {
  @IsString() code: string;
  @IsUUID() employeeId: string;
  @IsUUID() loanTypeId: string;
  @IsNumber() @Min(0) @Type(() => Number) loanAmount: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) sanctionedAmount?: number;
  @IsDateString() @IsOptional() documentDate?: string;
  @IsString() @IsOptional() status?: string;
  @IsUUID() @IsOptional() effectivePayPeriodId?: string;
  @IsDateString() @IsOptional() effectiveDate?: string;
  @IsInt() @Min(1) @IsOptional() @Type(() => Number) noOfInstallments?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) amountPerMonth?: number;
  @IsBoolean() @IsOptional() approved?: boolean;
  @IsString() @IsOptional() remarks?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
export class UpdateEmployeeLoanDto extends PartialType(CreateEmployeeLoanDto) {}

export class LoanInstallmentRowDto {
  @IsString() @IsOptional() month?: string;
  @IsInt() @IsOptional() @Type(() => Number) year?: number;
  @IsDateString() @IsOptional() dueDate?: string;
  @IsNumber() @Min(0) @Type(() => Number) amount: number;
  @IsString() @IsOptional() status?: string;
}
export class ReplaceLoanInstallmentsDto {
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => LoanInstallmentRowDto)
  rows: LoanInstallmentRowDto[];
}
