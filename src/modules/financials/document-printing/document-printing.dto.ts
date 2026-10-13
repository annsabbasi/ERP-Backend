import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Document types the Document Printing window can print today — the ones the
 * backend has tables for. The window lists SAP's other types too, disabled,
 * until their documents exist.
 */
export const PRINTABLE_DOCUMENT_TYPES = [
  'journal_entry',
  'ar_invoice',
  'incoming_payment',
  'ap_invoice',
  'outgoing_payment',
] as const;
export type PrintableDocumentType = (typeof PRINTABLE_DOCUMENT_TYPES)[number];

export const PROPERTY_MODES = ['ignore', 'and', 'or'] as const;
export type PropertyMode = (typeof PROPERTY_MODES)[number];

export const OUTPUT_KINDS = ['print', 'email'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** The Selection Criteria window, one field per control. */
export class DocumentPrintingSearchDto {
  @ApiProperty({ enum: PRINTABLE_DOCUMENT_TYPES })
  @IsIn(PRINTABLE_DOCUMENT_TYPES)
  documentType!: PrintableDocumentType;

  @ApiPropertyOptional() @IsOptional() @IsDateString() postingDateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() postingDateTo?: string;

  @ApiPropertyOptional({
    description: 'Numbering series id (journal entries only)',
  })
  @IsOptional()
  @IsUUID()
  seriesId?: string;

  @ApiPropertyOptional({ description: 'G/L account code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  accountFrom?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  accountTo?: string;

  @ApiPropertyOptional({ description: 'Business partner card code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bpCodeFrom?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bpCodeTo?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() customerGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorGroupId?: string;

  @ApiPropertyOptional({ description: 'BP property numbers, 1–64' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(64, { each: true })
  properties?: number[];

  @ApiPropertyOptional({ enum: PROPERTY_MODES })
  @IsOptional()
  @IsIn(PROPERTY_MODES)
  propertiesMode?: PropertyMode;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() onlyNotPrinted?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() onlyNotEmailed?: boolean;

  @ApiPropertyOptional({ description: 'Numeric part of the document number' })
  @IsOptional()
  @IsInt()
  @Min(0)
  internalNumberFrom?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  internalNumberTo?: number;
}

/** Ids picked in the results list, for loading or marking. */
export class DocumentPrintingSelectionDto {
  @ApiProperty({ enum: PRINTABLE_DOCUMENT_TYPES })
  @IsIn(PRINTABLE_DOCUMENT_TYPES)
  documentType!: PrintableDocumentType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class MarkDocumentOutputDto extends DocumentPrintingSelectionDto {
  @ApiProperty({ enum: OUTPUT_KINDS })
  @IsIn(OUTPUT_KINDS)
  output!: OutputKind;
}

export class EmailDocumentItemDto {
  @ApiProperty() @IsUUID() id!: string;

  @ApiProperty({
    description: 'The rendered document, as the window printed it',
  })
  @IsString()
  @MaxLength(2_000_000)
  html!: string;
}

export class EmailDocumentsDto {
  @ApiProperty({ enum: PRINTABLE_DOCUMENT_TYPES })
  @IsIn(PRINTABLE_DOCUMENT_TYPES)
  documentType!: PrintableDocumentType;

  @ApiProperty({ type: [EmailDocumentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EmailDocumentItemDto)
  documents!: EmailDocumentItemDto[];
}
