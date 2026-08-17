import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { FiscalPeriodStatus, SubPeriodType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePeriodDto {
  @ApiProperty({ example: '2026-04', description: 'Period code, unique per company' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'April 2026' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ description: 'Parent fiscal-year period' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  fiscalYear?: number;

  @ApiPropertyOptional({ enum: SubPeriodType })
  @IsOptional()
  @IsEnum(SubPeriodType)
  subPeriodType?: SubPeriodType;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-04-30' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  activeFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  activeTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  @ApiPropertyOptional({ enum: FiscalPeriodStatus })
  @IsOptional()
  @IsEnum(FiscalPeriodStatus)
  status?: FiscalPeriodStatus;
}

export class UpdatePeriodDto extends PartialType(CreatePeriodDto) {}

export class GeneratePeriodsDto {
  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(1900)
  @Max(2200)
  fiscalYear!: number;

  @ApiProperty({ enum: SubPeriodType, default: SubPeriodType.MONTHS })
  @IsEnum(SubPeriodType)
  subPeriodType: SubPeriodType = SubPeriodType.MONTHS;

  @ApiPropertyOptional({
    example: 1,
    description: 'First month of the fiscal year (1-12). Defaults to the company setting.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class SetPeriodStatusDto {
  @ApiProperty({ enum: FiscalPeriodStatus })
  @IsEnum(FiscalPeriodStatus)
  status!: FiscalPeriodStatus;

  @ApiPropertyOptional({
    enum: ['general', 'sales', 'purchasing', 'inventory'],
    description: 'Restrict the change to one posting area. Omit to set all four.',
  })
  @IsOptional()
  @IsEnum({ general: 'general', sales: 'sales', purchasing: 'purchasing', inventory: 'inventory' })
  area?: 'general' | 'sales' | 'purchasing' | 'inventory';
}
