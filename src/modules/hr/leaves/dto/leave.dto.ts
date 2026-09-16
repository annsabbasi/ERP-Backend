import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { LeaveAccrualMode } from '@prisma/client';

export class CreateLeaveTypeDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(LeaveAccrualMode)
  @IsOptional()
  accrualMode?: LeaveAccrualMode;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  accrualDays?: number;

  @IsString()
  @IsOptional()
  accrualPeriod?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  maxBalance?: number;

  @IsBoolean()
  @IsOptional()
  paid?: boolean;

  @IsBoolean()
  @IsOptional()
  requiresApproval?: boolean;

  @IsString()
  @IsOptional()
  workflowKey?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── SAP-style Leave Master fields ──
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) totalLeavesInYear?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) totalLeavesInYearForTrainer?: number;
  @IsString() @IsOptional() leaveCategory?: string;
  @IsBoolean() @IsOptional() applicableDuringProbation?: boolean;
  @IsBoolean() @IsOptional() encashable?: boolean;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minBalanceForEncash?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxLeaveToEncash?: number;
  @IsBoolean() @IsOptional() payableLeave?: boolean;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxMonthlyApplications?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minContinuousDays?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxContinuousDays?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minContinuousDurationProb?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxContinuousDurationProb?: number;
  @IsDateString() @IsOptional() effectiveFrom?: string;
  @IsBoolean() @IsOptional() carryForwardToNextYear?: boolean;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxLeaveCarryForward?: number;
  @IsBoolean() @IsOptional() isClosed?: boolean;
  @IsString() @IsOptional() remarks?: string;
}

export class UpdateLeaveTypeDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(LeaveAccrualMode) @IsOptional() accrualMode?: LeaveAccrualMode;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) accrualDays?: number;
  @IsString() @IsOptional() accrualPeriod?: string;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxBalance?: number;
  @IsBoolean() @IsOptional() paid?: boolean;
  @IsBoolean() @IsOptional() requiresApproval?: boolean;
  @IsString() @IsOptional() workflowKey?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;

  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) totalLeavesInYear?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) totalLeavesInYearForTrainer?: number;
  @IsString() @IsOptional() leaveCategory?: string;
  @IsBoolean() @IsOptional() applicableDuringProbation?: boolean;
  @IsBoolean() @IsOptional() encashable?: boolean;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minBalanceForEncash?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxLeaveToEncash?: number;
  @IsBoolean() @IsOptional() payableLeave?: boolean;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxMonthlyApplications?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minContinuousDays?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxContinuousDays?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) minContinuousDurationProb?: number;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxContinuousDurationProb?: number;
  @IsDateString() @IsOptional() effectiveFrom?: string;
  @IsBoolean() @IsOptional() carryForwardToNextYear?: boolean;
  @IsNumber() @Min(0) @IsOptional() @Type(() => Number) maxLeaveCarryForward?: number;
  @IsBoolean() @IsOptional() isClosed?: boolean;
  @IsString() @IsOptional() remarks?: string;
}

export class LeaveDateRangeRowDto {
  @IsDateString() fromDate: string;
  @IsDateString() toDate: string;
  @IsBoolean() @IsOptional() isLocked?: boolean;
}

export class ReplaceLeaveDateRangesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LeaveDateRangeRowDto)
  rows: LeaveDateRangeRowDto[];
}

export class AdjustBalanceDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  leaveTypeId: string;

  @IsString()
  periodKey: string;

  @IsNumber()
  @Type(() => Number)
  accruedDelta: number; // can be negative

  @IsString()
  @IsOptional()
  notes?: string;
}

export class SubmitLeaveRequestDto {
  @IsUUID()
  leaveTypeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsNumber()
  @Min(0.5)
  @Type(() => Number)
  days: number;

  @IsString()
  @IsOptional()
  reason?: string;

  // ── HR Payroll → Transactions → Leave Application (SAP-style fields) ──
  @IsString() @IsOptional() leaveDurationType?: string; // "Full" | "Half"
  @IsString() @IsOptional() signedBy?: string;
  @IsString() @IsOptional() contactNo?: string;
  @IsString() @IsOptional() preparedBy?: string;
}

export class DecideLeaveRequestDto {
  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  approvedByName?: string;
}
