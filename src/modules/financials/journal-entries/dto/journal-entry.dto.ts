import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class JournalLineDto {
  @ApiProperty({ description: 'G/L account to post against' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Business partner, for subledger/control postings' })
  @IsOptional()
  @IsString()
  bpId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Fans the amount across cost centers by ratio' })
  @IsOptional()
  @IsString()
  distributionRuleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCodeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  taxAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref3?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  ordering?: number;
}

export class CreateJournalEntryDto {
  @ApiProperty({ example: '2026-03-13', description: 'Posting date; selects the period' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ description: 'Document date, if different from the posting date' })
  @IsOptional()
  @IsDateString()
  docDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Numbering series; the default for journal_entry is used if omitted' })
  @IsOptional()
  @IsString()
  seriesId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Free-text external reference' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactionCodeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Posting template this entry was built from' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  indicator?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref3?: string;

  @ApiPropertyOptional({ default: false, description: 'Adjustment transaction (period 13)' })
  @IsOptional()
  @IsBoolean()
  isAdjustment?: boolean;

  @ApiPropertyOptional({ description: 'Schedules an automatic reversal on this date' })
  @IsOptional()
  @IsDateString()
  autoReverseDate?: string;

  @ApiProperty({ type: [JournalLineDto], description: 'At least two lines; debits must equal credits' })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];

  @ApiPropertyOptional({
    default: false,
    description: 'Post immediately instead of saving as a draft',
  })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}

export class ReverseJournalEntryDto {
  @ApiPropertyOptional({ description: 'Posting date of the reversing entry. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
