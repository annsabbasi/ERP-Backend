import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
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
}

export class DecideLeaveRequestDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
