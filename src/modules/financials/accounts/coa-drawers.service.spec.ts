import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CoaDrawersService } from './coa-drawers.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CoaDrawersService — Per-Company Drawer Configuration', () => {
  let service: CoaDrawersService;
  let prisma: {
    companySetting: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      companySetting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoaDrawersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CoaDrawersService>(CoaDrawersService);
  });

  describe('get', () => {
    it('returns default 5 drawers with 2-digit codes when company has no custom settings', async () => {
      prisma.companySetting.findUnique.mockResolvedValue(null);

      const drawers = await service.get('comp-1');
      expect(drawers).toHaveLength(5);
      expect(drawers.map((d) => d.type)).toEqual(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
      expect(drawers.find((d) => d.type === 'EQUITY')?.code).toBe('30');
      expect(drawers.find((d) => d.type === 'INCOME')?.label).toBe('Turnover');
      expect(drawers.every((d) => d.visible)).toBe(true);
    });

    it('merges stored custom labels, codes, and visibility over defaults', async () => {
      prisma.companySetting.findUnique.mockResolvedValue({
        value: [
          { type: 'INCOME', code: '40', label: 'Revenue', visible: true, order: 0 },
          { type: 'EXPENSE', code: '50', label: 'Operating Costs', visible: false, order: 1 },
        ],
      });

      const drawers = await service.get('comp-1');
      expect(drawers).toHaveLength(5);
      expect(drawers.find((d) => d.type === 'INCOME')?.label).toBe('Revenue');
      expect(drawers.find((d) => d.type === 'INCOME')?.code).toBe('40');
      expect(drawers.find((d) => d.type === 'EXPENSE')?.label).toBe('Operating Costs');
      expect(drawers.find((d) => d.type === 'EXPENSE')?.visible).toBe(false);
      // Assets was not in saved, so it gets default label and default code 10
      expect(drawers.find((d) => d.type === 'ASSET')?.label).toBe('Assets');
      expect(drawers.find((d) => d.type === 'ASSET')?.code).toBe('10');
    });
  });

  describe('set', () => {
    it('persists customized drawers successfully on initial save', async () => {
      prisma.companySetting.findUnique.mockResolvedValue(null);
      prisma.companySetting.upsert.mockResolvedValue({});

      const input = [
        { type: 'ASSET' as const, code: '10', label: 'Company Assets', visible: true, order: 0 },
        { type: 'LIABILITY' as const, code: '20', label: 'Company Liabilities', visible: true, order: 1 },
        { type: 'EQUITY' as const, code: '30', label: 'Capital', visible: true, order: 2 },
        { type: 'INCOME' as const, code: '40', label: 'Revenue', visible: true, order: 3 },
        { type: 'EXPENSE' as const, code: '50', label: 'Operating Expenses', visible: false, order: 4 },
      ];

      const result = await service.set('comp-1', input, 'user-1');
      expect(result).toHaveLength(5);
      expect(prisma.companySetting.upsert).toHaveBeenCalledTimes(1);
    });

    it('rejects changing drawer code once it has been saved (immutability)', async () => {
      prisma.companySetting.findUnique.mockResolvedValue({
        value: [
          { type: 'EQUITY', code: '30', label: 'Equity', visible: true, order: 2 },
        ],
      });

      const input = [
        { type: 'EQUITY' as const, code: '35', label: 'Equity Changed', visible: true, order: 2 },
      ];

      await expect(service.set('comp-1', input)).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid or non-2-digit drawer codes', async () => {
      prisma.companySetting.findUnique.mockResolvedValue(null);

      const input = [
        { type: 'ASSET' as const, code: '100', label: 'Assets', visible: true, order: 0 },
      ];

      await expect(service.set('comp-1', input)).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate drawer codes', async () => {
      prisma.companySetting.findUnique.mockResolvedValue(null);

      const input = [
        { type: 'ASSET' as const, code: '10', label: 'Assets', visible: true, order: 0 },
        { type: 'LIABILITY' as const, code: '10', label: 'Liabilities', visible: true, order: 1 },
      ];

      await expect(service.set('comp-1', input)).rejects.toThrow(BadRequestException);
    });

    it('rejects if all drawers are marked invisible', async () => {
      prisma.companySetting.findUnique.mockResolvedValue(null);

      const input = [
        { type: 'ASSET' as const, code: '10', label: 'Assets', visible: false, order: 0 },
        { type: 'LIABILITY' as const, code: '20', label: 'Liabilities', visible: false, order: 1 },
        { type: 'EQUITY' as const, code: '30', label: 'Equity', visible: false, order: 2 },
        { type: 'INCOME' as const, code: '40', label: 'Turnover', visible: false, order: 3 },
        { type: 'EXPENSE' as const, code: '50', label: 'Cost of Sales', visible: false, order: 4 },
      ];

      await expect(service.set('comp-1', input)).rejects.toThrow(BadRequestException);
    });
  });
});
