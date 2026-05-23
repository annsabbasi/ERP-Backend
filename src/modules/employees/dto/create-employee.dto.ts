import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { EmployeeStatus } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString()
  name: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  employeeNumber?: string;

  @IsUUID()
  @IsOptional()
  userId?: string;          // link to existing User account

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  positionId?: string;

  @IsUUID()
  @IsOptional()
  managerId?: string;

  /** Legacy free-text position; superseded by `positionId`. */
  @IsString()
  @IsOptional()
  position?: string;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  status?: EmployeeStatus;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  salary?: number;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @IsObject()
  @IsOptional()
  customFields?: Record<string, unknown>;
}
