import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateContractDto {
  @IsEnum(EmploymentType)
  type: EmploymentType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsUUID()
  @IsOptional()
  positionId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  salaryAmount?: number;

  @IsString()
  @IsOptional()
  salaryCurrency?: string;

  @IsString()
  @IsOptional()
  salaryFrequency?: string; // "MONTHLY" | "ANNUAL" | "HOURLY" | "DAILY"

  @IsInt()
  @Min(0)
  @IsOptional()
  workHoursPerWeek?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateContractDto {
  @IsEnum(EmploymentType)
  @IsOptional()
  type?: EmploymentType;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsUUID()
  @IsOptional()
  positionId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  salaryAmount?: number;

  @IsString()
  @IsOptional()
  salaryCurrency?: string;

  @IsString()
  @IsOptional()
  salaryFrequency?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  workHoursPerWeek?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
