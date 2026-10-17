import { Test, TestingModule } from '@nestjs/testing';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { AccountType } from '@prisma/client';

describe('AccountsService — Hierarchical Coding & Immutability', () => {
  let service: AccountsService;
  let prisma: {
    account: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      account: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  describe('create', () => {
    it('rejects adding a child when parent is at level 7 (14 digits)', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 'parent-l7',
        code: '10010203040506',
        level: 7,
      });

      await expect(
        service.create('comp-1', {
          code: '1001020304050601',
          name: 'Level 8 Attempt',
          type: AccountType.ASSET,
          parentId: 'parent-l7',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects child code that does not prefix parent code', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 'parent-l2',
        code: '3010',
        level: 2,
      });

      await expect(
        service.create('comp-1', {
          code: '201001',
          name: 'Wrong Prefix',
          type: AccountType.ASSET,
          parentId: 'parent-l2',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('strictly requires account code and rejects creation if omitted', async () => {
      await expect(
        service.create('comp-1', {
          name: 'Accounts Receivable',
          type: AccountType.ASSET,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('saves the exact user-defined code without modifying or replacing it', async () => {
      prisma.account.findFirst.mockImplementation(({ where }) => {
        if (where.id === 'parent-l1') {
          return Promise.resolve({
            id: 'parent-l1',
            code: '30',
            level: 1,
            parentId: null,
          });
        }
        if (where.code === '3010') {
          return Promise.resolve(null); // Uniqueness check: no collision
        }
        return Promise.resolve(null);
      });

      prisma.account.create.mockImplementation(({ data }) => Promise.resolve({ id: 'acc-new', ...data }));

      // User explicitly chooses 3010 (Bank under 30 Equity)
      const result = await service.create('comp-1', {
        code: '3010',
        name: 'Bank',
        type: AccountType.EQUITY,
        parentId: 'parent-l1',
      });

      expect(result).toMatchObject({
        code: '3010',
        level: 2,
      });
    });

    it('suggests next available code for pre-submission preview via getNextChildCode', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 'parent-l2',
        code: '3010',
        level: 2,
        name: 'Bank',
      });

      prisma.account.findMany.mockResolvedValue([
        { code: '301001' },
        { code: '301002' },
      ]);

      const suggestion = await service.getNextChildCode('comp-1', 'parent-l2');
      expect(suggestion).toEqual({
        code: '301003',
        level: 3,
        parentCode: '3010',
        parentName: 'Bank',
      });
    });

    it('allows Company A and Company B to independently use the exact same code with different semantics', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      prisma.account.create.mockImplementation(({ data }) => Promise.resolve({ id: 'acc-a1', ...data }));

      const resA = await service.create('comp-A', {
        code: '10',
        name: 'Assets for Company A',
        type: AccountType.ASSET,
      });

      expect(resA).toMatchObject({
        companyId: 'comp-A',
        code: '10',
        type: AccountType.ASSET,
      });

      prisma.account.findFirst.mockResolvedValue(null);
      prisma.account.create.mockImplementation(({ data }) => Promise.resolve({ id: 'acc-b1', ...data }));

      const resB = await service.create('comp-B', {
        code: '10',
        name: 'Liabilities for Company B',
        type: AccountType.LIABILITY,
      });

      expect(resB).toMatchObject({
        companyId: 'comp-B',
        code: '10',
        type: AccountType.LIABILITY,
      });
    });
  });

  describe('update (immutability)', () => {
    it('rejects any attempt to modify account code', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 'acc-1',
        code: '301001',
        name: 'Meezan Bank',
        _count: { lines: 0, children: 0 },
      });

      await expect(
        service.update('comp-1', 'acc-1', {
          code: '301099',
          name: 'Updated Name',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects re-parenting account', async () => {
      prisma.account.findFirst.mockResolvedValue({
        id: 'acc-1',
        code: '301001',
        parentId: 'parent-1',
        _count: { lines: 0, children: 0 },
      });

      await expect(
        service.update('comp-1', 'acc-1', {
          parentId: 'parent-2',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
