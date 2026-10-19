import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  AccountDeterminationArea,
  PaymentDirection,
  RecurrenceFrequency,
  TaxCodeType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── CURRENCY ─────────────────────────────────────────────────────────────────
export class CreateCurrencyDto {
  @ApiProperty({ example: 'PKR' })
  @IsString() @Length(3, 3) code!: string;

  @ApiProperty({ example: 'Pakistani Rupee' })
  @IsString() @IsNotEmpty() name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() intlDescription?: string;
  @ApiPropertyOptional({ example: 'Paisa' }) @IsOptional() @IsString() hundredthName?: string;
  @ApiPropertyOptional({ default: 2 }) @IsOptional() @IsInt() @Min(0) @Max(6) decimals?: number;
  @ApiPropertyOptional({ enum: ['standard', 'up', 'down'] }) @IsOptional() @IsString() rounding?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCurrencyDto extends PartialType(CreateCurrencyDto) {}

// ─── EXCHANGE RATE ────────────────────────────────────────────────────────────
export class CreateExchangeRateDto {
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() @Length(3, 3) baseCurrency?: string;
  @ApiProperty({ example: 'PKR' }) @IsString() @Length(3, 3) targetCurrency!: string;

  @ApiProperty({ example: 278.5 })
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) rate!: number;

  @ApiProperty({ example: '2026-08-17' }) @IsDateString() date!: string;
  @ApiPropertyOptional({ example: 'manual' }) @IsOptional() @IsString() source?: string;
}
export class UpdateExchangeRateDto extends PartialType(CreateExchangeRateDto) {}

// ─── PAYMENT TERMS ────────────────────────────────────────────────────────────
export class CreatePaymentTermsDto {
  @ApiProperty({ example: 'NET30' }) @IsString() @IsNotEmpty() code!: string;
  @ApiProperty({ example: 'Net 30 days' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 30 }) @IsInt() @Min(0) netDays!: number;

  @ApiPropertyOptional({ example: 10, description: 'Early-payment discount window' })
  @IsOptional() @IsInt() @Min(0) discountDays?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discountPercent?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdatePaymentTermsDto extends PartialType(CreatePaymentTermsDto) {}

// ─── PROJECT / TRANSACTION CODE ───────────────────────────────────────────────
export class CreateFinanceProjectDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateFinanceProjectDto extends PartialType(CreateFinanceProjectDto) {}

export class CreateTransactionCodeDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTransactionCodeDto extends PartialType(CreateTransactionCodeDto) {}

// ─── TAX CODE ─────────────────────────────────────────────────────────────────
export class CreateTaxCodeDto {
  @ApiProperty({ example: 'GST17' }) @IsString() @IsNotEmpty() code!: string;
  @ApiProperty({ example: 'GST 17%' }) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ enum: TaxCodeType }) @IsOptional() @IsEnum(TaxCodeType) type?: TaxCodeType;

  @ApiProperty({ example: 17, description: 'Percentage, e.g. 17 for 17%' })
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) rate!: number;

  @ApiPropertyOptional({ description: 'G/L account the tax posts to' })
  @IsOptional() @IsString() accountId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTaxCodeDto extends PartialType(CreateTaxCodeDto) {}

// ─── CASH FLOW LINE ITEM ──────────────────────────────────────────────────────
export class CreateCashFlowLineItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional({ enum: ['operating', 'investing', 'financing'] })
  @IsOptional() @IsString() section?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCashFlowLineItemDto extends PartialType(CreateCashFlowLineItemDto) {}

// ─── ACCOUNT DETERMINATION ────────────────────────────────────────────────────
export class SetAccountDeterminationDto {
  @ApiProperty({ enum: AccountDeterminationArea })
  @IsEnum(AccountDeterminationArea) area!: AccountDeterminationArea;

  @ApiProperty({ example: 'domestic_ar' }) @IsString() @IsNotEmpty() key!: string;
  @ApiProperty() @IsString() @IsNotEmpty() accountId!: string;
}

// ─── POSTING TEMPLATE ─────────────────────────────────────────────────────────
export class PostingTemplateLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() accountId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty({ example: 50, description: 'Share of the amount, in percent' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  percentage!: number;

  @ApiProperty({ enum: ['debit', 'credit'] })
  @IsIn(['debit', 'credit'])
  side!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() ordering?: number;
}

export class CreatePostingTemplateDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiProperty({ type: [PostingTemplateLineDto] })
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => PostingTemplateLineDto)
  lines!: PostingTemplateLineDto[];
}
export class UpdatePostingTemplateDto extends PartialType(CreatePostingTemplateDto) {}

export class ApplyPostingTemplateQueryDto {
  @ApiProperty({
    example: 120000,
    description: 'Total to spread across the template lines',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

// ─── RECURRING POSTING ────────────────────────────────────────────────────────
export class RecurringPostingLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() accountId!: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) debit?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) credit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() ordering?: number;
}

export class CreateRecurringPostingDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiProperty({ enum: RecurrenceFrequency }) @IsEnum(RecurrenceFrequency) frequency!: RecurrenceFrequency;
  @ApiProperty() @IsDateString() nextExecution!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxExecutions?: number;
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiProperty({ type: [RecurringPostingLineDto] })
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => RecurringPostingLineDto)
  lines!: RecurringPostingLineDto[];
}
export class UpdateRecurringPostingDto extends PartialType(CreateRecurringPostingDto) {}

export class ExecuteRecurringPostingDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Posting date of the journal entry; defaults to the scheduled date',
  })
  @IsOptional()
  @IsDateString()
  postingDate?: string;
}

// ─── COST ACCOUNTING ──────────────────────────────────────────────────────────
export class CreateDimensionDto {
  @ApiProperty({ example: 1, description: '1-5' }) @IsInt() @Min(1) @Max(5) dimensionNo!: number;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDimensionDto extends PartialType(CreateDimensionDto) {}

export class CreateCostCenterDto {
  @ApiProperty() @IsString() @IsNotEmpty() dimensionId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCostCenterDto extends PartialType(CreateCostCenterDto) {}

export class DistributionRuleLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() costCenterId!: string;

  @ApiProperty({ example: 3, description: 'Share numerator; totalRatio is the denominator' })
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) ratio!: number;
}

export class CreateDistributionRuleDto {
  @ApiProperty() @IsString() @IsNotEmpty() dimensionId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiProperty({ type: [DistributionRuleLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DistributionRuleLineDto)
  lines!: DistributionRuleLineDto[];
}
export class UpdateDistributionRuleDto extends PartialType(CreateDistributionRuleDto) {}

// ─── BUDGETS ──────────────────────────────────────────────────────────────────
export class CreateBudgetScenarioDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(1900) @Max(2200) fiscalYear!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() basedOnScenarioId?: string;

  @ApiPropertyOptional({ example: 110, description: 'Percent applied to the base scenario' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) initialRatio?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBudgetScenarioDto extends PartialType(CreateBudgetScenarioDto) {}

export class CreateBudgetDistributionMethodDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;

  @ApiProperty({
    type: [Number],
    example: [8.33, 8.33, 8.34, 8.33, 8.33, 8.34, 8.33, 8.33, 8.34, 8.33, 8.33, 8.34],
    description: 'Twelve percentages summing to 100',
  })
  @IsArray() @ArrayMinSize(12) @IsNumber({ maxDecimalPlaces: 4 }, { each: true })
  monthlyRatios!: number[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBudgetDistributionMethodDto extends PartialType(CreateBudgetDistributionMethodDto) {}

export class CreateBudgetLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() scenarioId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() accountId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() periodId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() distributionMethodId?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) annualDebit?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) annualCredit?: number;
}
export class UpdateBudgetLineDto extends PartialType(CreateBudgetLineDto) {}

export class CopyBudgetScenarioDto {
  @ApiProperty() @IsString() @IsNotEmpty() sourceScenarioId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(1900) @Max(2200) fiscalYear!: number;
  @ApiPropertyOptional({ example: 100 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) initialRatio?: number;
}

export class BulkBudgetLineItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() accountId!: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) annualDebit?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) annualCredit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() distributionMethodId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() costCenterId?: string;
}

export class BulkBudgetLinesDto {
  @ApiProperty() @IsString() @IsNotEmpty() scenarioId!: string;
  @ApiProperty({ type: [BulkBudgetLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkBudgetLineItemDto)
  lines!: BulkBudgetLineItemDto[];
}

// ─── BANKING SETUP ────────────────────────────────────────────────────────────
export class CreateBankDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() swift?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBankDto extends PartialType(CreateBankDto) {}

export class CreateHouseBankAccountDto {
  @ApiProperty() @IsString() @IsNotEmpty() bankId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() accountNo!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branch?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() glAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateHouseBankAccountDto extends PartialType(CreateHouseBankAccountDto) {}

export const PAYMENT_MEANS = [
  'cash',
  'check',
  'online',
  'ibft',
  'loan',
  'advance',
  'bank_transfer',
  'credit_card',
] as const;

export class CreatePaymentMethodDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional({ enum: PaymentDirection }) @IsOptional() @IsEnum(PaymentDirection) direction?: PaymentDirection;
  // Outgoing payroll methods (Phase 2): cash, check, online, ibft, loan, advance.
  // Incoming: bank_transfer, credit_card. Each decides what a payment made with
  // it must carry (cheque no., bank account, transfer reference, IBAN).
  @ApiPropertyOptional({ enum: PAYMENT_MEANS })
  @IsOptional()
  @IsIn(PAYMENT_MEANS)
  paymentMeans?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() houseBankAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdatePaymentMethodDto extends PartialType(CreatePaymentMethodDto) {}

export class CreateDunningTermDto {
  @ApiProperty() @IsString() @IsNotEmpty() code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;

  @ApiPropertyOptional({
    description: '[{ level, daysAfterDue, feeAmount, interestPercent, letterTemplate }]',
  })
  @IsOptional() @IsArray() levels?: unknown[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDunningTermDto extends PartialType(CreateDunningTermDto) {}
