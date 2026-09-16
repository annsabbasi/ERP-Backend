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

  // ── HR Payroll → Masters → Employee Current Information (Employee Details tab) ──
  @IsString() @IsOptional() fatherName?: string;
  @IsString() @IsOptional() gender?: string;
  @IsDateString() @IsOptional() dateOfBirth?: string;
  @IsDateString() @IsOptional() originalDateOfBirth?: string;
  @IsString() @IsOptional() nationality?: string;
  @IsString() @IsOptional() mobilePhone2?: string;
  @IsDateString() @IsOptional() dateOfJoining?: string;
  @IsString() @IsOptional() insurancePolicyNo?: string;
  @IsString() @IsOptional() pfNo?: string;
  @IsString() @IsOptional() esiNo?: string;
  @IsString() @IsOptional() otherInfo?: string;
  @IsNumber() @IsOptional() @Type(() => Number) fuelLiters?: number;
  @IsString() @IsOptional() address1?: string;
  @IsString() @IsOptional() address2?: string;
  @IsString() @IsOptional() address3?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() pinCode?: string;
  @IsString() @IsOptional() state?: string;
  @IsString() @IsOptional() sectionType?: string;
  @IsString() @IsOptional() locationProjectSite?: string;
  @IsUUID() @IsOptional() employeeCategoryId?: string;
  @IsUUID() @IsOptional() gradeId?: string;
  @IsUUID() @IsOptional() currentShiftId?: string;
}
