import { IsString, IsNumber, Min, IsEnum, IsOptional } from 'class-validator';
import { InventoryTransactionType } from '@prisma/client';

export class CreateInventoryTransactionDto {
  @IsString()
  productId: string;

  @IsEnum(InventoryTransactionType)
  type: InventoryTransactionType;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  unitCost?: number; // Required for RECEIPT

  @IsOptional()
  @IsString()
  sourceDocType?: string;

  @IsOptional()
  @IsString()
  sourceDocId?: string;
}
