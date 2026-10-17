import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
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
  @ApiProperty({ example: '3010', description: 'Account code, 2-digit pure numeric format up to 7 levels (14 digits max)' })
  @IsString()
  @IsNotEmpty({ message: 'Account code is required' })
  @Matches(/^(\d{2}){1,7}$/, {
    message: 'code must follow 2-digit pure numeric format up to 7 levels (e.g. 30, 3010, 301001)',
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

export class UpdateAccountDto extends PartialType(OmitType(CreateAccountDto, ['code'] as const)) {}
