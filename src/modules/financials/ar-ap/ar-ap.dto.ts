import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// ─── Lines ────────────────────────────────────────────────────────────────────
// Only quantity, unit price and tax percent are accepted. The line total and
// tax amount are computed on the server: a client that could send its own
// totals could send an invoice whose lines do not add up to its header, and no
// amount of validation downstream would recover the true figure.

export class ARInvoiceLineDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  quantity?: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Tax rate for this line, e.g. 15 for 15%' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxPercent?: number;

  @ApiPropertyOptional({ description: 'Revenue account; falls back to G/L account determination' })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Item sold, when the line came from inventory' })
  @IsOptional()
  @IsString()
  productId?: string;
}

export class APBillLineDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  quantity?: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Tax rate for this line, e.g. 15 for 15%' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxPercent?: number;

  @ApiPropertyOptional({ description: 'Expense account; falls back to G/L account determination' })
  @IsOptional()
  @IsString()
  accountId?: string;
}

// ─── Documents ────────────────────────────────────────────────────────────────

export class CreateARInvoiceDto {
  @ApiProperty({ description: 'Business partner; must be a CUSTOMER' })
  @IsString()
  @IsNotEmpty()
  bpId!: string;

  @ApiProperty()
  @IsDateString()
  issueDate!: string;

  @ApiPropertyOptional({ description: 'Defaults from the payment terms when omitted' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTermsId?: string;

  @ApiPropertyOptional({ description: 'Sales order this invoice was raised from' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [ARInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ARInvoiceLineDto)
  lines!: ARInvoiceLineDto[];
}

export class UpdateARInvoiceDto extends PartialType(CreateARInvoiceDto) {}

export class CreateAPBillDto {
  @ApiProperty({ description: 'Business partner; must be a VENDOR' })
  @IsString()
  @IsNotEmpty()
  bpId!: string;

  @ApiProperty({
    description:
      "The vendor's own invoice number. Not auto-generated — it has to match the document they sent.",
  })
  @IsString()
  @IsNotEmpty()
  number!: string;

  @ApiProperty()
  @IsDateString()
  issueDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTermsId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [APBillLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => APBillLineDto)
  lines!: APBillLineDto[];
}

export class UpdateAPBillDto extends PartialType(CreateAPBillDto) {}

// ─── Actions ──────────────────────────────────────────────────────────────────

export class RecordPaymentDto {
  @ApiProperty({ description: 'Must not exceed the open balance' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: 'wire' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: 'Cheque number, wire reference, gateway id' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({
    description: 'Cash or bank account the money moved through; falls back to determination',
  })
  @IsOptional()
  @IsString()
  accountId?: string;
}

export class VoidDocumentDto {
  @ApiPropertyOptional({ description: 'Recorded on the reversing journal entry' })
  @IsOptional()
  @IsString()
  reason?: string;
}
