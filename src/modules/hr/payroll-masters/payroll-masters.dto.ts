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

// ─── EMPLOYEE CATEGORY MASTER ─────────────────────────────────────────────────
export class CreateEmployeeCategoryDto {
  @IsString() code: string;
  @IsString() name: string;
  @IsString() @IsOptional() remarks?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
export class UpdateEmployeeCategoryDto extends PartialType(CreateEmployeeCategoryDto) {}

// ─── GRADE MASTER ──────────────────────────────────────────────────────────────
export class CreateGradeDto {
  @IsString() code: string;
  @IsString() description: string;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) overtimeRatePerHour?: number;
  @IsString() @IsOptional() remarks?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
export class UpdateGradeDto extends PartialType(CreateGradeDto) {}

// ─── GRADE PAY SCALE ───────────────────────────────────────────────────────────
export class GradePayScaleStageRowDto {
  @IsInt() @Min(1) @Type(() => Number) stage: number;
  @IsNumber() @IsOptional() @Type(() => Number) basicPay?: number;
  @IsNumber() @IsOptional() @Type(() => Number) hra?: number;
  @IsNumber() @IsOptional() @Type(() => Number) utilityAllowance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) medicalAllowance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) conveyanceAllowance?: number;
  @IsNumber() @IsOptional() @Type(() => Number) adhoc2017?: number;
  @IsNumber() @IsOptional() @Type(() => Number) adhoc2018?: number;
}
export class ReplaceGradePayScaleDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GradePayScaleStageRowDto)
  rows: GradePayScaleStageRowDto[];
}

// ─── LOAN MASTER ───────────────────────────────────────────────────────────────
export class CreateLoanTypeDto {
  @IsString() code: string;
  @IsString() description: string;
  @IsString() @IsOptional() loanType?: string;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxAmount?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) rateOfInterest?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minRepaymentAmount?: number;
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) maxInstallments?: number;
  @IsString() @IsOptional() remarks?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
export class UpdateLoanTypeDto extends PartialType(CreateLoanTypeDto) {}

// ─── PAY PERIOD MASTER ─────────────────────────────────────────────────────────
export class CreatePayPeriodDto {
  @IsString() code: string;
  @IsString() name: string;
  @IsString() @IsOptional() status?: string;
  @IsDateString() fromDate: string;
  @IsDateString() toDate: string;
  @IsString() @IsOptional() payMonth?: string;
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) workingDays?: number;
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) saturdays?: number;
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) holidays?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxNormalOtHoursMonth?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxWorkingHoursMonth?: number;
  @IsString() @IsOptional() remarks?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
export class UpdatePayPeriodDto extends PartialType(CreatePayPeriodDto) {}

// ─── TAX FORMULA CALCULATION ───────────────────────────────────────────────────
export class CreateTaxFormulaDto {
  @IsString() code: string;
  @IsUUID() @IsOptional() employeeCategoryId?: string;
  @IsInt() @IsOptional() @Type(() => Number) periodYear?: number;
  @IsDateString() @IsOptional() fromDate?: string;
  @IsDateString() @IsOptional() toDate?: string;
  @IsInt() @IsOptional() @Type(() => Number) startYear?: number;
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) noOfMonths?: number;
  @IsDateString() @IsOptional() documentDate?: string;
  @IsString() @IsOptional() remarks?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
export class UpdateTaxFormulaDto extends PartialType(CreateTaxFormulaDto) {}

export class TaxSlabRowDto {
  @IsNumber() @Min(0) @Type(() => Number) lowerAmount: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) higherAmount?: number;
  @IsNumber() @Min(0) @Type(() => Number) percentage: number;
}
export class ReplaceTaxSlabsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TaxSlabRowDto)
  rows: TaxSlabRowDto[];
}
