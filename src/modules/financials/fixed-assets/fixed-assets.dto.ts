import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  AssetCapitalizationKind,
  AssetCapitalizationOrigin,
  DepreciationMethod,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** QA FA-D13: at most 2 decimals, at most 999,999,999,999,999.99. */
export const MAX_AMOUNT = 999_999_999_999_999.99;

// ─── ASSET CLASS ──────────────────────────────────────────────────────────────
export class CreateAssetClassDto {
  @ApiProperty({ example: 'IT' }) @IsString() @Length(1, 20) code!: string;
  @ApiProperty({ example: 'Computer equipment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ enum: DepreciationMethod, default: DepreciationMethod.STRAIGHT_LINE })
  @IsOptional()
  @IsEnum(DepreciationMethod)
  depreciationMethod?: DepreciationMethod;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  usefulLifeMonths?: number;

  @ApiProperty({ description: 'Acquisition and production cost (APC) account: an asset account of subtype FIXED_ASSET' })
  @IsString()
  @IsNotEmpty()
  assetAccountId!: string;
  @ApiProperty({ description: 'Accumulated depreciation (contra-asset) account' })
  @IsString()
  @IsNotEmpty()
  accumulatedDepreciationAccountId!: string;
  @ApiProperty({ description: 'Depreciation expense account' })
  @IsString()
  @IsNotEmpty()
  depreciationExpenseAccountId!: string;
  @ApiProperty({ description: 'Asset acquisition clearing account' })
  @IsString()
  @IsNotEmpty()
  clearingAccountId!: string;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}
export class UpdateAssetClassDto extends PartialType(CreateAssetClassDto) {}

// ─── DEPRECIATION AREA ────────────────────────────────────────────────────────
export class CreateDepreciationAreaDto {
  @ApiProperty({ example: 'TAX' }) @IsString() @Length(1, 20) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional({ default: false, description: 'Exactly one active area per company posts to the G/L' })
  @IsOptional()
  @IsBoolean()
  postsToGl?: boolean;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(999) ordering?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDepreciationAreaDto extends PartialType(CreateDepreciationAreaDto) {}

// ─── ASSET MASTER DATA ────────────────────────────────────────────────────────
/** One depreciation area's parameters on an asset (Fixed Assets → Overview). */
export class AssetAreaParamsDto {
  @ApiProperty() @IsString() @IsNotEmpty() areaId!: string;

  @ApiPropertyOptional({ enum: DepreciationMethod })
  @IsOptional()
  @IsEnum(DepreciationMethod)
  depreciationMethod?: DepreciationMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  usefulLifeMonths?: number;

  @ApiPropertyOptional({ description: 'Defaults to the first capitalization’s asset value date' })
  @IsOptional()
  @IsDateString()
  depreciationStartDate?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  salvageValue?: number;
}

export class CreateFixedAssetDto {
  @ApiPropertyOptional({ description: 'Leave empty to take the next number from the fixed asset numbering series' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  code?: string;
  @ApiPropertyOptional({ description: 'Numbering series for the asset number (default series when empty)' })
  @IsOptional()
  @IsString()
  seriesId?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) foreignName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) barCode?: string;
  @ApiProperty() @IsString() @IsNotEmpty() assetClassId!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;

  // General
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) manufacturer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) additionalIdentifier?: string;

  // Fixed Assets → Overview
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) inventoryNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @ApiPropertyOptional({ description: 'Location (branch)' }) @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional({ description: 'Employee responsible for the asset' })
  @IsOptional()
  @IsString()
  employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() technicianId?: string;

  // Purchasing data
  @ApiPropertyOptional({ description: 'Preferred vendor (a VENDOR business partner)' })
  @IsOptional()
  @IsString()
  vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) mfrCatalogNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() purchaseDate?: string | null;
  @ApiPropertyOptional({ description: 'Planned purchase cost; offered as the capitalization amount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  purchaseCost?: number | null;

  // Cost accounting (cost center and distribution rule are mutually exclusive)
  @ApiPropertyOptional() @IsOptional() @IsString() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() distributionRuleId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) remarks?: string;

  @ApiPropertyOptional({ type: [AssetAreaParamsDto], description: 'Overrides of the asset class defaults, per area' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssetAreaParamsDto)
  areas?: AssetAreaParamsDto[];
}
export class UpdateFixedAssetDto extends PartialType(CreateFixedAssetDto) {}

// ─── CAPITALIZATION / CAPITALIZATION CREDIT MEMO ──────────────────────────────
export class AssetCapitalizationLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() assetId!: string;

  @ApiProperty({ description: 'Total (LC) for this asset' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  amount!: number;

  @ApiPropertyOptional({ description: 'Whole units; the first capitalization of an asset needs at least 1' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity?: number;

  @ApiPropertyOptional({ description: 'A/P invoice line this line capitalizes (origin A/P invoice)' })
  @IsOptional()
  @IsString()
  apBillLineId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) remarks?: string;
}

export class CreateAssetCapitalizationDto {
  @ApiPropertyOptional({ enum: AssetCapitalizationKind, default: AssetCapitalizationKind.CAPITALIZATION })
  @IsOptional()
  @IsEnum(AssetCapitalizationKind)
  kind?: AssetCapitalizationKind;

  @ApiPropertyOptional({ enum: AssetCapitalizationOrigin, default: AssetCapitalizationOrigin.MANUAL })
  @IsOptional()
  @IsEnum(AssetCapitalizationOrigin)
  origin?: AssetCapitalizationOrigin;

  @ApiPropertyOptional({ description: 'Origin No.: the posted A/P invoice (origin A/P invoice)' })
  @IsOptional()
  @IsString()
  apBillId?: string;

  @ApiPropertyOptional({ description: 'Credit memo only: the capitalization it credits' })
  @IsOptional()
  @IsString()
  baseCapitalizationId?: string;

  @ApiPropertyOptional({ description: 'Depreciation area; empty = all areas ("*")' })
  @IsOptional()
  @IsString()
  depreciationAreaId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() seriesId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;

  @ApiProperty() @IsDateString() postingDate!: string;
  @ApiPropertyOptional({ description: 'Defaults to the posting date' })
  @IsOptional()
  @IsDateString()
  documentDate?: string;
  @ApiPropertyOptional({
    description: 'Value date for the asset; depreciation starts from it. Same fiscal year as the posting date; defaults to it',
  })
  @IsOptional()
  @IsDateString()
  assetValueDate?: string;

  @ApiPropertyOptional({ description: 'Accounting tab: the journal entry description' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  journalRemark?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) remarks?: string;

  @ApiProperty({ type: [AssetCapitalizationLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AssetCapitalizationLineDto)
  lines!: AssetCapitalizationLineDto[];
}

export class CancelAssetCapitalizationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) reason?: string;
}

export class ListAssetCapitalizationsQuery {
  @ApiPropertyOptional({ enum: AssetCapitalizationKind })
  @IsOptional()
  @IsEnum(AssetCapitalizationKind)
  kind?: AssetCapitalizationKind;
}

// ─── DEPRECIATION RUN ─────────────────────────────────────────────────────────
export class DepreciationRunDto {
  @ApiProperty({ description: 'Depreciate up to and including this date' })
  @IsDateString()
  postingDate!: string;

  @ApiPropertyOptional({ description: 'Limit the run to these assets' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assetIds?: string[];

  @ApiPropertyOptional({ default: false, description: 'Compute without writing' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
