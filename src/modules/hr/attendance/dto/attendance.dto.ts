import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { AttendanceSource } from '@prisma/client';

export class CreateShiftDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM (24-hour)' })
  startTime: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM (24-hour)' })
  endTime: string;

  @IsBoolean()
  @IsOptional()
  isOvernight?: boolean;

  @IsInt() @Min(0) @Max(240) @IsOptional() @Type(() => Number)
  breakMinutes?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workDays: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateShiftDto {
  @IsString() @IsOptional() name?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime?: string;
  @IsBoolean() @IsOptional() isOvernight?: boolean;
  @IsInt() @Min(0) @Max(240) @IsOptional() @Type(() => Number) breakMinutes?: number;
  @IsArray() @IsOptional() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsString() @IsOptional() remarks?: string;
}

export class AssignShiftDto {
  @IsUUID()
  shiftId: string;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}

export class CheckInDto {
  @IsEnum(AttendanceSource)
  @IsOptional()
  source?: AttendanceSource;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CheckOutDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

export class EditAttendanceDto {
  @IsDateString()
  @IsOptional()
  checkIn?: string;

  @IsDateString()
  @IsOptional()
  checkOut?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
