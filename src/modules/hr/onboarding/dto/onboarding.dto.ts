import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { OnboardingItemStatus } from '@prisma/client';

export class OnboardingTemplateItemDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  assigneeRole?: string;

  @IsInt() @Min(0) @IsOptional() @Type(() => Number)
  daysFromStart?: number;

  @IsInt() @Min(0) @IsOptional() @Type(() => Number)
  ordering?: number;
}

export class CreateOnboardingTemplateDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  positionId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingTemplateItemDto)
  items: OnboardingTemplateItemDto[];
}

export class UpdateOnboardingTemplateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsUUID() @IsOptional() positionId?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OnboardingTemplateItemDto)
  items?: OnboardingTemplateItemDto[];
}

export class StartOnboardingDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsDateString()
  @IsOptional()
  targetEndAt?: string;
}

export class UpdateOnboardingItemDto {
  @IsEnum(OnboardingItemStatus)
  @IsOptional()
  status?: OnboardingItemStatus;

  @IsUUID()
  @IsOptional()
  assigneeId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
