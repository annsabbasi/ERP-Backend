import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ActivityKind,
  ActivityPriority,
  ActivityStatus,
  BpAddressType,
  BpCardType,
  CampaignStatus,
  OpportunityStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── BUSINESS PARTNER ─────────────────────────────────────────────────────────
export class BpContactPersonDto {
  @ApiPropertyOptional({ description: 'Present when updating an existing contact' })
  @IsOptional() @IsString() id?: string;

  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fax?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pager?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() profession?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks2?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BpAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() id?: string;
  @ApiProperty() @IsString() @IsNotEmpty() addressName!: string;
  @ApiProperty({ enum: BpAddressType }) @IsEnum(BpAddressType) addressType!: BpAddressType;
  @ApiPropertyOptional() @IsOptional() @IsString() street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() streetNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() block?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() building?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zipCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() county?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gln?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class BpBankAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branch?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() swift?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() controlKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CreateBusinessPartnerDto {
  @ApiPropertyOptional({
    description: 'Card code. Auto-generated from the business_partner series when omitted.',
  })
  @IsOptional() @IsString() cardCode?: string;

  @ApiProperty({ example: 'Acme Construction (Pvt) Ltd' })
  @IsString() @IsNotEmpty() cardName!: string;

  @ApiProperty({ enum: BpCardType, default: BpCardType.CUSTOMER })
  @IsEnum(BpCardType) cardType!: BpCardType;

  @ApiPropertyOptional() @IsOptional() @IsString() foreignName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() groupId?: string;
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() federalTaxId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fax?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() shippingType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() territoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() salesEmployeeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() paymentTermsId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentMethodId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dunningTermId?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) creditLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) commitmentLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discountPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) interestOnArrears?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() priceListId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() controlAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() downPaymentAccountId?: string;

  @ApiPropertyOptional({ description: 'Named property flags, e.g. { "vip": true }' })
  @IsOptional() @IsObject() properties?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() industry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() businessType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blockDunning?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;

  @ApiPropertyOptional({ type: [BpContactPersonDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BpContactPersonDto)
  contacts?: BpContactPersonDto[];

  @ApiPropertyOptional({ type: [BpAddressDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BpAddressDto)
  addresses?: BpAddressDto[];

  @ApiPropertyOptional({ type: [BpBankAccountDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BpBankAccountDto)
  bankAccounts?: BpBankAccountDto[];
}

export class UpdateBusinessPartnerDto extends PartialType(CreateBusinessPartnerDto) {}

// ─── SALES ORGANISATION ───────────────────────────────────────────────────────
export class CreateTerritoryDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTerritoryDto extends PartialType(CreateTerritoryDto) {}

export class CreateCommissionGroupDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) commissionPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCommissionGroupDto extends PartialType(CreateCommissionGroupDto) {}

export class CreateSalesEmployeeDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() commissionGroupId?: string;
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) commissionPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() territoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telephone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fax?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ description: 'Link to a login user' })
  @IsOptional() @IsString() userId?: string;

  @ApiPropertyOptional({ description: 'Link to an HR employee record' })
  @IsOptional() @IsString() employeeId?: string;
}
export class UpdateSalesEmployeeDto extends PartialType(CreateSalesEmployeeDto) {}

// ─── CRM SETUP CATALOGS ───────────────────────────────────────────────────────
export class CreateBpGroupDto {
  @ApiProperty({ enum: BpCardType }) @IsEnum(BpCardType) type!: BpCardType;
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBpGroupDto extends PartialType(CreateBpGroupDto) {}

export class CreateOpportunityStageDefDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) stageNo!: number;
  @ApiProperty({ example: 'Qualification' }) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ example: 20, description: 'Default probability at this stage' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) closingPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateOpportunityStageDefDto extends PartialType(CreateOpportunityStageDefDto) {}

export class CreateCompetitorDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() threatLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCompetitorDto extends PartialType(CreateCompetitorDto) {}

export class CreateCrmPartnerDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCrmPartnerDto extends PartialType(CreateCrmPartnerDto) {}

export class CreateInformationSourceDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateInformationSourceDto extends PartialType(CreateInformationSourceDto) {}

export class CreateBpRelationshipTypeDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
}
export class UpdateBpRelationshipTypeDto extends PartialType(CreateBpRelationshipTypeDto) {}

// ─── ACTIVITY ─────────────────────────────────────────────────────────────────
export class CreateActivityDto {
  @ApiProperty({ enum: ActivityKind }) @IsEnum(ActivityKind) kind!: ActivityKind;
  @ApiProperty() @IsString() @IsNotEmpty() subject!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() activityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bpId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPersonId?: string;
  @ApiPropertyOptional({ enum: ActivityPriority }) @IsOptional() @IsEnum(ActivityPriority) priority?: ActivityPriority;
  @ApiPropertyOptional({ enum: ActivityStatus }) @IsOptional() @IsEnum(ActivityStatus) status?: ActivityStatus;

  @ApiProperty({ example: '2026-08-20' }) @IsDateString() startDate!: string;
  @ApiPropertyOptional({ example: '09:30' }) @IsOptional() @IsString() startTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ example: '10:30' }) @IsOptional() @IsString() endTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) durationMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() reminderEnabled?: boolean;
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @IsInt() @Min(0) reminderMinutesBefore?: number;

  @ApiPropertyOptional({ description: '{ freq: "WEEKLY", interval: 1, until: "2026-12-31" }' })
  @IsOptional() @IsObject() recurrence?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() linkedDocType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() linkedDocId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() linkedDocNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToUserId?: string;
}
export class UpdateActivityDto extends PartialType(CreateActivityDto) {}

// ─── OPPORTUNITY ──────────────────────────────────────────────────────────────
export class OpportunityStageEntryDto {
  @ApiProperty() @IsString() @IsNotEmpty() stageDefId!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() ordering?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() closingDate?: string;
  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) closePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) potentialAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() salesEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() activityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() docType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() docNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class OpportunityCompetitorDto {
  @ApiProperty() @IsString() @IsNotEmpty() competitorId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() threatLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() strengths?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() weaknesses?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class OpportunityPartnerDto {
  @ApiProperty() @IsString() @IsNotEmpty() partnerId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class CreateOpportunityDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty() @IsString() @IsNotEmpty() bpId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPersonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() salesEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() territoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currentStageId?: string;
  @ApiPropertyOptional({ enum: OpportunityStatus }) @IsOptional() @IsEnum(OpportunityStatus) status?: OpportunityStatus;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) level?: number;

  @ApiProperty() @IsDateString() startDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() closingDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() predictedClosingDate?: string;

  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) potentialAmount?: number;

  @ApiPropertyOptional({
    description: 'Probability. Weighted amount is derived from this and potentialAmount.',
  })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) closePercent?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) grossProfit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() informationSourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() industry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() interestField?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() interestLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() wonLostReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;

  @ApiPropertyOptional({ type: [OpportunityStageEntryDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OpportunityStageEntryDto)
  stages?: OpportunityStageEntryDto[];

  @ApiPropertyOptional({ type: [OpportunityCompetitorDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OpportunityCompetitorDto)
  competitors?: OpportunityCompetitorDto[];

  @ApiPropertyOptional({ type: [OpportunityPartnerDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OpportunityPartnerDto)
  partners?: OpportunityPartnerDto[];
}
export class UpdateOpportunityDto extends PartialType(CreateOpportunityDto) {}

export class CloseOpportunityDto {
  @ApiProperty({ enum: [OpportunityStatus.WON, OpportunityStatus.LOST] })
  @IsEnum(OpportunityStatus) status!: OpportunityStatus;

  @ApiPropertyOptional() @IsOptional() @IsDateString() closingDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

// ─── CAMPAIGN ─────────────────────────────────────────────────────────────────
export class CreateCampaignDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional({ enum: CampaignStatus }) @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() salesEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() targetGroup?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) budgetAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) revenueAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;

  @ApiPropertyOptional({ type: [String], description: 'Business partner ids to target' })
  @IsOptional() @IsArray() @IsString({ each: true }) targetBpIds?: string[];
}
export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}
