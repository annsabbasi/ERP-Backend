import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryTransactionDto } from './dto/inventory-transaction.dto';
import { InventoryTransactionType, Prisma } from '@prisma/client';

const D = (v: unknown) => new Prisma.Decimal((v as number | string) ?? 0);

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStock(companyId: string, productId: string) {
    return this.prisma.inventoryItem.upsert({
      where: { productId },
      create: { companyId, productId, quantity: 0, averageCost: 0 },
      update: {}
    });
  }

  // Legacy Controller Stubs (Pending UI Integration)
  async findAll() { return []; }
  async findLowStock() { return []; }
  async findOne(id: number) { return null; }
  async create(dto: any) { throw new BadRequestException('Use recordTransaction'); }
  async update(id: number, dto: any) { throw new BadRequestException('Not supported'); }
  async remove(id: number) { throw new BadRequestException('Not supported'); }

  async recordTransaction(
    companyId: string,
    dto: CreateInventoryTransactionDto,
    txClient?: Prisma.TransactionClient
  ) {
    const exec = async (tx: Prisma.TransactionClient) => {
      // Prevent duplicates if source is provided
      if (dto.sourceDocType && dto.sourceDocId) {
        const existing = await tx.inventoryTransaction.findFirst({
          where: {
            companyId,
            sourceDocType: dto.sourceDocType,
            sourceDocId: dto.sourceDocId,
            type: dto.type
          }
        });
        if (existing) {
          throw new ConflictException(`Inventory transaction for ${dto.sourceDocType} ${dto.sourceDocId} already exists.`);
        }
      }

      // We must lock the inventory item to prevent concurrent moving average corruption
      // Since prisma doesn't have a direct raw SELECT FOR UPDATE for nested relations easily,
      // we do a direct query or rely on unique constraints, but in PostgreSQL Prisma handles
      // sequential execution well if we rely on it inside the same tx. We can do a dummy update to lock.
      let item = await tx.inventoryItem.upsert({
        where: { productId: dto.productId },
        create: { companyId, productId: dto.productId, quantity: 0, averageCost: 0 },
        update: { lastUpdated: new Date() } // Locks the row for this transaction
      });

      let newQuantity = item.quantity;
      let newAverageCost = item.averageCost;
      let transactionUnitCost = D(0);

      const qty = dto.quantity;
      if (qty <= 0) throw new BadRequestException('Quantity must be greater than zero');

      if (dto.type === 'RECEIPT' || dto.type === 'ADJUSTMENT_IN') {
        if (dto.unitCost === undefined) {
          throw new BadRequestException(`unitCost is required for ${dto.type}`);
        }
        transactionUnitCost = D(dto.unitCost);
        const currentTotalValue = D(item.quantity).mul(item.averageCost);
        const incomingValue = D(qty).mul(transactionUnitCost);
        
        newQuantity = item.quantity + qty;
        newAverageCost = currentTotalValue.add(incomingValue).div(newQuantity);
      } 
      else if (dto.type === 'ISSUE' || dto.type === 'ADJUSTMENT_OUT') {
        if (item.quantity < qty) {
          throw new BadRequestException(`Insufficient stock. Available: ${item.quantity}, Requested: ${qty}`);
        }
        // Issues always use the current moving average cost
        transactionUnitCost = item.averageCost;
        newQuantity = item.quantity - qty;
        // averageCost remains the same
      }

      const totalCost = transactionUnitCost.mul(qty);

      // Create ledger entry
      const transaction = await tx.inventoryTransaction.create({
        data: {
          companyId,
          productId: dto.productId,
          type: dto.type,
          quantity: qty,
          unitCost: transactionUnitCost,
          totalCost: totalCost,
          sourceDocType: dto.sourceDocType,
          sourceDocId: dto.sourceDocId
        }
      });

      // Update master stock
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantity: newQuantity,
          averageCost: newAverageCost
        }
      });

      return transaction;
    };

    if (txClient) {
      return exec(txClient);
    } else {
      return this.prisma.$transaction(exec, {
        maxWait: 10000,
        timeout: 30000
      });
    }
  }
}
