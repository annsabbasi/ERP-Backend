import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AlertFrequency, AlertPriority, ApprovalDecision } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── COMPANY SETTINGS ─────────────────────────────────────────────────────────
export class UpsertSettingsDto {
  @ApiProperty({
    example: 'general',
    description: 'Settings group — mirrors a tab of the General Settings window',
  })
  @IsString() @IsNotEmpty() group!: string;

  @ApiProperty({
    example: { defaultCurrency: 'PKR', useSegmentedAccounts: false },
    description: 'Flat key → value map. Keys are merged into the group, not replaced wholesale.',
  })
  @IsObject() values!: Record<string, unknown>;
}

export class UpdateCompanyDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logoUrl?: string;
  @ApiPropertyOptional({ example: 'PK' }) @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional({ example: 'PKR' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ example: 'en-US' }) @IsOptional() @IsString() locale?: string;
  @ApiPropertyOptional({ example: 'Asia/Karachi' }) @IsOptional() @IsString() timezone?: string;

  @ApiPropertyOptional({ example: 7, description: 'First month of the fiscal year (1-12)' })
  @IsOptional() @IsInt() @Min(1) fiscalYearStart?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() industry?: string;

  @ApiPropertyOptional({ description: 'Branding and terminology overrides' })
  @IsOptional() @IsObject() branding?: Record<string, unknown>;

  // Accounting defaults live on Company so posting routines can find them
  // without a settings lookup on every call.
  @ApiPropertyOptional() @IsOptional() @IsString() defaultArAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultApAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultCashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultTaxPayableAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultTaxRecoverableAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultRevenueAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultExpenseAccountId?: string;
}

/**
 * Company Details saved as one unit.
 *
 * The window writes to two places — the `companies` row for what the ledger
 * reads, and a settings group for the address/tax/initialization fields. Sending
 * them as two requests meant the first could commit and the second fail, leaving
 * the window reporting an error over a half-applied save. One request, one
 * transaction.
 */
export class SaveCompanyDetailsDto {
  @ApiPropertyOptional({ description: 'Fields stored on the company record itself' })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateCompanyDetailsDto)
  company?: UpdateCompanyDetailsDto;

  @ApiPropertyOptional({
    description: 'SAP address / tax / initialization fields, stored as a settings group',
  })
  @IsOptional() @IsObject() details?: Record<string, unknown>;
}

export class UpsertDocumentSettingsDto {
  @ApiPropertyOptional({
    description: 'Document type these settings apply to. Omit for the General tab.',
  })
  @IsOptional() @IsString() documentType?: string;

  @ApiProperty() @IsObject() settings!: Record<string, unknown>;
}

// ─── NUMBERING ────────────────────────────────────────────────────────────────
export class CreateNumberingSeriesDto {
  @ApiProperty({ example: 'journal_entry' }) @IsString() @IsNotEmpty() documentType!: string;
  @ApiProperty({ example: 'Primary' }) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ example: 'JE-' }) @IsOptional() @IsString() prefix?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() suffix?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(0) firstNumber?: number;
  @ApiPropertyOptional({ description: 'Defaults to firstNumber on create' })
  @IsOptional() @IsInt() @Min(0) nextNumber?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) lastNumber?: number;

  @ApiPropertyOptional({ default: 0, description: 'Zero-pad width; 0 disables padding' })
  @IsOptional() @IsInt() @Min(0) digits?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isLocked?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() periodIndicator?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}
export class UpdateNumberingSeriesDto extends PartialType(CreateNumberingSeriesDto) {}

// ─── USER GROUPS / DEFAULTS ───────────────────────────────────────────────────
export class CreateUserGroupDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'User ids to place in the group' })
  @IsOptional() @IsArray() @IsString({ each: true }) memberIds?: string[];
}
export class UpdateUserGroupDto extends PartialType(CreateUserGroupDto) {}

export class CreateUserDefaultsGroupDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;

  @ApiPropertyOptional({ description: 'Grouped defaults keyed by the window tab' })
  @IsOptional() @IsObject() defaults?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) userIds?: string[];
}
export class UpdateUserDefaultsGroupDto extends PartialType(CreateUserDefaultsGroupDto) {}

// ─── PREDEFINED TEXT / GEOGRAPHY ──────────────────────────────────────────────
export class CreatePredefinedTextDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiProperty() @IsString() @IsNotEmpty() text!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdatePredefinedTextDto extends PartialType(CreatePredefinedTextDto) {}

export class CreateCountryDto {
  @ApiProperty({ example: 'PK' }) @IsString() @IsNotEmpty() code!: string;
  @ApiProperty({ example: 'Pakistan' }) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() addressFormat?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCountryDto extends PartialType(CreateCountryDto) {}

export class CreateStateRegionDto {
  @ApiProperty() @IsString() @IsNotEmpty() countryId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────
export class CreateAlertDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: AlertPriority }) @IsOptional() @IsEnum(AlertPriority) priority?: AlertPriority;
  @ApiPropertyOptional({ enum: AlertFrequency }) @IsOptional() @IsEnum(AlertFrequency) frequency?: AlertFrequency;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) frequencyValue?: number;

  @ApiPropertyOptional({ description: 'Platform event that fires this alert' })
  @IsOptional() @IsString() eventKey?: string;

  @ApiPropertyOptional({ description: 'Saved query evaluated on a schedule' })
  @IsOptional() @IsString() savedQuery?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Users to subscribe' })
  @IsOptional() @IsArray() @IsString({ each: true }) recipientIds?: string[];
}
export class UpdateAlertDto extends PartialType(CreateAlertDto) {}

// ─── APPROVALS ────────────────────────────────────────────────────────────────
export class CreateApprovalStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ default: 1, description: 'How many approvers must approve' })
  @IsOptional() @IsInt() @Min(1) requiredApprovals?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiProperty({ type: [String], description: 'Users who may approve at this stage' })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) approverIds!: string[];
}
export class UpdateApprovalStageDto extends PartialType(CreateApprovalStageDto) {}

export class CreateApprovalTemplateDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiProperty({ type: [String], example: ['ar_invoice', 'purchase_order'] })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) documentTypes!: string[];

  @ApiPropertyOptional({
    description:
      'Trigger terms. { always: true } fires for every document; otherwise ' +
      '{ conditions: [{ field, op, value }], match: "all" | "any" }.',
    example: { conditions: [{ field: 'total', op: 'gt', value: 500000 }], match: 'all' },
  })
  @IsOptional() @IsObject() terms?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;

  @ApiPropertyOptional({ type: [String], description: 'Originators this template watches. Empty = everyone.' })
  @IsOptional() @IsArray() @IsString({ each: true }) originatorIds?: string[];

  @ApiProperty({ type: [String], description: 'Stage ids, in the order they must clear' })
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) stageIds!: string[];
}
export class UpdateApprovalTemplateDto extends PartialType(CreateApprovalTemplateDto) {}

export class SubmitForApprovalDto {
  @ApiProperty({ example: 'ar_invoice' }) @IsString() @IsNotEmpty() documentType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() documentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() documentNumber?: string;

  @ApiProperty({ description: 'The document being submitted; used to evaluate template terms' })
  @IsObject() document!: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class ApprovalDecisionDto {
  @ApiProperty({ enum: ApprovalDecision }) @IsEnum(ApprovalDecision) decision!: ApprovalDecision;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class CreateSubstituteAuthorizerDto {
  @ApiPropertyOptional({ description: 'Limit to one template. Omit for all templates.' })
  @IsOptional() @IsString() templateId?: string;

  @ApiProperty() @IsString() @IsNotEmpty() originalUserId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() substituteUserId!: string;
  @ApiProperty() @IsDateString() validFrom!: string;
  @ApiProperty() @IsDateString() validTo!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSubstituteAuthorizerDto extends PartialType(CreateSubstituteAuthorizerDto) {}
