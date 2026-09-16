import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCrudOptions, TenantCrudService } from '../../../common/crud/tenant-crud.service';
import { ReplaceGradePayScaleDto, ReplaceTaxSlabsDto } from './payroll-masters.dto';

// ─── EMPLOYEE CATEGORY MASTER ─────────────────────────────────────────────────
@Injectable()
export class EmployeeCategoriesService extends TenantCrudService {
  protected readonly modelName = 'employeeCategory';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Employee category',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: { _count: { select: { employees: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

// ─── GRADE MASTER + PAY SCALE ──────────────────────────────────────────────────
@Injectable()
export class GradesService extends TenantCrudService {
  protected readonly modelName = 'grade';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Grade',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'description'],
    filterableFields: ['isActive'],
    uniqueBy: ['code'],
    include: { _count: { select: { employees: true, payScale: true } } },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  async getPayScale(companyId: string, gradeId: string) {
    await this.findOne(companyId, gradeId);
    return this.prisma.gradePayScaleStage.findMany({
      where: { gradeId },
      orderBy: { stage: 'asc' },
    });
  }

  async replacePayScale(companyId: string, gradeId: string, dto: ReplaceGradePayScaleDto) {
    await this.findOne(companyId, gradeId);
    await this.prisma.$transaction([
      this.prisma.gradePayScaleStage.deleteMany({ where: { gradeId } }),
      this.prisma.gradePayScaleStage.createMany({
        data: dto.rows.map((row) => ({
          gradeId,
          stage: row.stage,
          basicPay: row.basicPay as any,
          hra: row.hra as any,
          utilityAllowance: row.utilityAllowance as any,
          medicalAllowance: row.medicalAllowance as any,
          conveyanceAllowance: row.conveyanceAllowance as any,
          adhoc2017: row.adhoc2017 as any,
          adhoc2018: row.adhoc2018 as any,
        })),
      }),
    ]);
    return this.getPayScale(companyId, gradeId);
  }
}

// ─── LOAN MASTER ───────────────────────────────────────────────────────────────
@Injectable()
export class LoanTypesService extends TenantCrudService {
  protected readonly modelName = 'loanType';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Loan type',
    orderBy: { code: 'asc' },
    searchFields: ['code', 'description'],
    filterableFields: ['isActive', 'loanType'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }
}

// ─── PAY PERIOD MASTER ─────────────────────────────────────────────────────────
@Injectable()
export class PayPeriodsService extends TenantCrudService {
  protected readonly modelName = 'payPeriod';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Pay period',
    orderBy: { fromDate: 'desc' },
    searchFields: ['code', 'name'],
    filterableFields: ['isActive', 'status'],
    uniqueBy: ['code'],
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.fromDate) out.fromDate = new Date(out.fromDate as string);
    if (out.toDate) out.toDate = new Date(out.toDate as string);
    if (out.fromDate instanceof Date && out.toDate instanceof Date && out.toDate < out.fromDate) {
      throw new BadRequestException('Pay period "To Date" must be on or after "From Date".');
    }
    return out;
  }
}

// ─── TAX FORMULA CALCULATION ───────────────────────────────────────────────────
@Injectable()
export class TaxFormulasService extends TenantCrudService {
  protected readonly modelName = 'taxFormula';
  protected readonly options: TenantCrudOptions = {
    entityName: 'Tax formula',
    orderBy: { code: 'asc' },
    searchFields: ['code'],
    filterableFields: ['isActive', 'employeeCategoryId', 'periodYear'],
    uniqueBy: ['code'],
    include: {
      employeeCategory: { select: { id: true, code: true, name: true } },
      slabs: { orderBy: { ordering: 'asc' } },
    },
  };
  constructor(prisma: PrismaService) { super(prisma); }

  protected beforeWrite(dto: Record<string, unknown>): Record<string, unknown> {
    const out = super.beforeWrite(dto);
    if (out.fromDate) out.fromDate = new Date(out.fromDate as string);
    if (out.toDate) out.toDate = new Date(out.toDate as string);
    if (out.documentDate) out.documentDate = new Date(out.documentDate as string);
    return out;
  }

  async replaceSlabs(companyId: string, taxFormulaId: string, dto: ReplaceTaxSlabsDto) {
    const formula = await this.prisma.taxFormula.findFirst({ where: { id: taxFormulaId, companyId } });
    if (!formula) throw new NotFoundException(`Tax formula ${taxFormulaId} not found`);
    await this.prisma.$transaction([
      this.prisma.taxSlab.deleteMany({ where: { taxFormulaId } }),
      this.prisma.taxSlab.createMany({
        data: dto.rows.map((row, i) => ({
          taxFormulaId,
          ordering: i,
          lowerAmount: row.lowerAmount as any,
          higherAmount: row.higherAmount as any,
          percentage: row.percentage as any,
        })),
      }),
    ]);
    return this.prisma.taxSlab.findMany({ where: { taxFormulaId }, orderBy: { ordering: 'asc' } });
  }
}
