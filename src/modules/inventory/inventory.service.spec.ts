import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryTransactionDto } from './dto/inventory-transaction.dto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('InventoryService - Core Engine', () => {
  jest.setTimeout(30000);
  let service: InventoryService;
  let prisma: PrismaService;
  const companyA = 'comp-a';
  const companyB = 'comp-b';
  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, PrismaService],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);

    // Setup seed data
    await prisma.company.createMany({
      data: [{ id: companyA, name: 'A', slug: 'a' }, { id: companyB, name: 'B', slug: 'b' }],
      skipDuplicates: true,
    });
    const p1 = await prisma.product.create({ data: { companyId: companyA, name: 'Prod A', price: 100 } });
    const p2 = await prisma.product.create({ data: { companyId: companyB, name: 'Prod B', price: 200 } });
    productAId = p1.id;
    productBId = p2.id;
  });

  afterAll(async () => {
    await prisma.inventoryTransaction.deleteMany({});
    await prisma.inventoryItem.deleteMany({});
    await prisma.product.deleteMany({ where: { id: { in: [productAId, productBId] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.inventoryTransaction.deleteMany({});
    await prisma.inventoryItem.deleteMany({});
  });

  it('1. & 10. Stock Receipt: Correctly updates quantity and moving average cost', async () => {
    await service.recordTransaction(companyA, {
      productId: productAId, type: 'RECEIPT', quantity: 5, unitCost: 10
    });
    
    let item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(5);
    expect(Number(item.averageCost)).toBe(10);

    await service.recordTransaction(companyA, {
      productId: productAId, type: 'RECEIPT', quantity: 5, unitCost: 20
    });

    item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(10);
    // (5 * 10 + 5 * 20) / 10 = 15
    expect(Number(item.averageCost)).toBe(15);
  });

  it('3. Stock Issue: Reduces stock and uses correct moving average', async () => {
    await service.recordTransaction(companyA, {
      productId: productAId, type: 'RECEIPT', quantity: 10, unitCost: 15
    });

    const issueTx = await service.recordTransaction(companyA, {
      productId: productAId, type: 'ISSUE', quantity: 2
    });

    const item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(8);
    expect(Number(item.averageCost)).toBe(15);
    expect(Number(issueTx.unitCost)).toBe(15);
    expect(Number(issueTx.totalCost)).toBe(30);
  });

  it('5. Stock Adjustment Increase & Decrease', async () => {
    await service.recordTransaction(companyA, {
      productId: productAId, type: 'ADJUSTMENT_IN', quantity: 3, unitCost: 5
    });
    let item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(3);

    await service.recordTransaction(companyA, {
      productId: productAId, type: 'ADJUSTMENT_OUT', quantity: 2
    });
    item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(1);
  });

  it('8. Company Isolation', async () => {
    await service.recordTransaction(companyA, {
      productId: productAId, type: 'RECEIPT', quantity: 10, unitCost: 10
    });
    const itemB = await service.getStock(companyB, productBId);
    expect(itemB.quantity).toBe(0); // B is isolated from A
  });

  it('9. Prevents negative stock (Insufficient stock)', async () => {
    await service.recordTransaction(companyA, {
      productId: productAId, type: 'RECEIPT', quantity: 5, unitCost: 10
    });

    await expect(
      service.recordTransaction(companyA, {
        productId: productAId, type: 'ISSUE', quantity: 10
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('12. Duplicate requests cannot duplicate stock movement', async () => {
    const txDto: CreateInventoryTransactionDto = {
      productId: productAId, type: 'RECEIPT', quantity: 5, unitCost: 10,
      sourceDocType: 'TEST_DOC', sourceDocId: 'DOC-123'
    };

    // First succeeds
    await service.recordTransaction(companyA, txDto);
    
    // Second fails
    await expect(
      service.recordTransaction(companyA, txDto)
    ).rejects.toThrow(ConflictException);

    const item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(5); // Not 10
  });

  it('11. Concurrent transactions do not corrupt stock balance', async () => {
    // We fire 10 receipts of 1 unit simultaneously
    const promises = Array.from({ length: 10 }).map((_, i) => 
      service.recordTransaction(companyA, {
        productId: productAId, type: 'RECEIPT', quantity: 1, unitCost: 10,
        sourceDocType: 'CONCURRENT', sourceDocId: `C-${i}`
      })
    );

    await Promise.all(promises);

    const item = await service.getStock(companyA, productAId);
    expect(item.quantity).toBe(10);
  });
});
