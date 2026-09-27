import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * The whole of an employee's payment details. PUT replaces them: a field left
 * out is cleared, so the form and the stored row can never silently disagree.
 */
export class PutPaymentDetailsDto {
  @ApiPropertyOptional({ description: 'An OUTGOING payment method; empty = Cash' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString()
  paymentMethodId?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString()
  bankId?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120)
  accountTitle?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40)
  accountNo?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40)
  iban?: string | null;
}
