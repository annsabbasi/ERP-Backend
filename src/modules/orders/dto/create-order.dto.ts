import { IsArray, IsUUID, IsNumber, IsOptional, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsUUID()
  productId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateOrderDto {
  /**
   * The customer the order is for.
   *
   * Optional so a quotation can be started before the customer is chosen, but
   * an order that never gets one cannot be invoiced: A/R invoices link back to
   * the order, and the chain customer -> order -> invoice -> payment has to
   * start somewhere.
   */
  @IsOptional()
  @IsUUID()
  bpId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
