import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AddOnType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── INDEXES ──────────────────────────────────────────────────────────────────
export class CreateFinancialIndexDto {
  @ApiProperty({ example: 'CPI', description: 'Column header in the Indexes grid' })
  @IsString() @IsNotEmpty() code!: string;

  @ApiProperty({ example: 'Consumer Price Index' })
  @IsString() @IsNotEmpty() name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ example: 2020, description: 'Year the index reads 100' })
  @IsOptional() @IsInt() @Min(1900) @Max(2999) baseYear?: number;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateFinancialIndexDto extends PartialType(CreateFinancialIndexDto) {}

export class IndexGridCellDto {
  @ApiProperty() @IsString() @IsNotEmpty() indexId!: string;

  @ApiProperty({ example: 3, description: '1-12' })
  @IsInt() @Min(1) @Max(12) month!: number;

  @ApiPropertyOptional({
    example: 112.4,
    description: 'Null or an empty string clears the cell — a cleared cell is a gap, not a zero.',
  })
  @IsOptional() value?: number | string | null;
}

export class SaveIndexGridDto {
  @ApiProperty({ example: 2026 })
  @IsInt() @Min(1900) @Max(2999) year!: number;

  @ApiProperty({ type: [IndexGridCellDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => IndexGridCellDto)
  cells!: IndexGridCellDto[];
}

// ─── EXCHANGE RATE GRID ───────────────────────────────────────────────────────
export class ExchangeRateGridCellDto {
  @ApiProperty({ example: 'EUR' }) @IsString() @IsNotEmpty() targetCurrency!: string;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional() @IsString() baseCurrency?: string;

  @ApiProperty({ example: '2026-03-14' }) @IsDateString() date!: string;

  @ApiPropertyOptional({ description: 'Null or empty clears the quote for that day.' })
  @IsOptional() rate?: number | string | null;
}

export class SaveExchangeRateGridDto {
  @ApiProperty({ type: [ExchangeRateGridCellDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExchangeRateGridCellDto)
  cells!: ExchangeRateGridCellDto[];
}

// ─── LICENSE ──────────────────────────────────────────────────────────────────
export class LicenseComponentDto {
  @ApiProperty({ example: 'PROFESSIONAL' }) @IsString() @IsNotEmpty() code!: string;
  @ApiProperty({ example: 'Professional User' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 5 }) @IsInt() @Min(0) totalCount!: number;
}

export class ImportLicenseDto {
  @ApiProperty({ example: '0020345074-0001083' })
  @IsString() @IsNotEmpty() licenseKey!: string;

  @ApiPropertyOptional({ example: '192.168.109.6' })
  @IsOptional() @IsString() licenseServer?: string;

  @ApiPropertyOptional({ example: 40000, default: 40000 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() hardwareKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() installationNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() systemNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() importedFileName?: string;

  @ApiPropertyOptional({ type: [LicenseComponentDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LicenseComponentDto)
  components?: LicenseComponentDto[];
}

export class AssignLicenseSeatDto {
  @ApiProperty() @IsString() @IsNotEmpty() componentId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() userId!: string;
}

export class GenerateAddOnIdentifierDto {
  @ApiProperty({ example: 'Field Service Add-On' })
  @IsString() @IsNotEmpty() addOnName!: string;

  @ApiPropertyOptional({ enum: AddOnType, default: AddOnType.DEVELOPMENT })
  @IsOptional() @IsEnum(AddOnType) addOnType?: AddOnType;

  @ApiPropertyOptional({ example: 'ACME' })
  @IsOptional() @IsString() partnerNamespace?: string;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
export class PeriodEndClosingDto {
  @ApiProperty() @IsString() @IsNotEmpty() fromPeriodId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() toPeriodId!: string;

  @ApiProperty({ description: 'Account the net result is carried to' })
  @IsString() @IsNotEmpty() retainedEarningsAccountId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() closingAccountId?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean() usePrimaryClosingAccount?: boolean;

  @ApiPropertyOptional({ description: 'Defaults to the last day of the "to" period' })
  @IsOptional() @IsDateString() postingDate?: string;
}

export class ChangeLogCleanupDto {
  @ApiProperty({ example: '2025-01-01', description: 'Rows older than this are removed' })
  @IsDateString() olderThan!: string;
}

export class CheckDocumentNumberingDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) documentTypes?: string[];

  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

// ─── PRINT PREFERENCES (per document / per report overrides) ──────────────────
export class UpsertPrintPreferencesDto {
  @ApiPropertyOptional({
    description:
      'Document type these preferences apply to. Omit for the General tab, which applies to all.',
  })
  @IsOptional() @IsString() documentType?: string;

  @ApiProperty({ description: 'Flat key -> value map; merged into the stored group.' })
  values!: Record<string, unknown>;
}

// ─── APPROVAL DECISION FILTERS ────────────────────────────────────────────────
export class ApprovalReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() approverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() take?: number;
}
