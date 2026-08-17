import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AccountSubtype, AccountType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ example: '1100', description: 'Account code, unique per company' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 32)
  // Codes appear in reports and exports; keeping them to a predictable
  // alphanumeric/dash/dot shape avoids breaking CSV and ledger layouts.
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'code may contain only letters, digits, dot, dash and underscore',
  })
  code!: string;

  @ApiProperty({ example: 'Accounts Receivable — Domestic' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  type!: AccountType;

  @ApiPropertyOptional({ enum: AccountSubtype })
  @IsOptional()
  @IsEnum(AccountSubtype)
  subtype?: AccountSubtype;

  @ApiPropertyOptional({ description: 'Parent account id for the CoA tree' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Title accounts group other accounts and cannot be posted to',
  })
  @IsOptional()
  @IsBoolean()
  isTitle?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Control accounts only accept lines that carry a business partner',
  })
  @IsOptional()
  @IsBoolean()
  isControl?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cashFlowLineItemId?: string;

  @ApiPropertyOptional({ description: 'Depth in the CoA tree; derived if omitted' })
  @IsOptional()
  @IsInt()
  @Min(1)
  level?: number;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {}
