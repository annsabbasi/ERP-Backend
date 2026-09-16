import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import * as S from './payroll-masters.services';
import * as Dto from './payroll-masters.dto';

const PERMISSION_RESOURCE = 'hr.payroll';

// ─── EMPLOYEE CATEGORY MASTER ─────────────────────────────────────────────────
@ApiTags('HR Payroll — Employee Category Master')
@RequireModule('hr-payroll')
@Controller('hr/payroll-masters/employee-categories')
export class EmployeeCategoriesController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'employee categories',
  createDto: Dto.CreateEmployeeCategoryDto,
  updateDto: Dto.UpdateEmployeeCategoryDto,
}) {
  constructor(protected readonly service: S.EmployeeCategoriesService) { super(); }
}

// ─── GRADE MASTER + GRADE PAY SCALE ────────────────────────────────────────────
@ApiTags('HR Payroll — Grade Master')
@RequireModule('hr-payroll')
@Controller('hr/payroll-masters/grades')
export class GradesController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'grades',
  createDto: Dto.CreateGradeDto,
  updateDto: Dto.UpdateGradeDto,
}) {
  constructor(protected readonly service: S.GradesService) { super(); }

  @ApiOperation({ summary: 'Get a grade pay scale (stage-wise components)' })
  @RequirePermission(`${PERMISSION_RESOURCE}.view`)
  @Get(':id/pay-scale')
  getPayScale(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.getPayScale(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Replace a grade pay scale (stage-wise components)' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Put(':id/pay-scale')
  replacePayScale(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ReplaceGradePayScaleDto,
  ) {
    return this.service.replacePayScale(user.companyId as string, id, dto);
  }
}

// ─── LOAN MASTER ───────────────────────────────────────────────────────────────
@ApiTags('HR Payroll — Loan Master')
@RequireModule('hr-payroll')
@Controller('hr/payroll-masters/loan-types')
export class LoanTypesController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'loan types',
  createDto: Dto.CreateLoanTypeDto,
  updateDto: Dto.UpdateLoanTypeDto,
}) {
  constructor(protected readonly service: S.LoanTypesService) { super(); }
}

// ─── PAY PERIOD MASTER ─────────────────────────────────────────────────────────
@ApiTags('HR Payroll — Pay Period Master')
@RequireModule('hr-payroll')
@Controller('hr/payroll-masters/pay-periods')
export class PayPeriodsController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'pay periods',
  createDto: Dto.CreatePayPeriodDto,
  updateDto: Dto.UpdatePayPeriodDto,
}) {
  constructor(protected readonly service: S.PayPeriodsService) { super(); }
}

// ─── TAX FORMULA CALCULATION ───────────────────────────────────────────────────
@ApiTags('HR Payroll — Tax Formula Calculation')
@RequireModule('hr-payroll')
@Controller('hr/payroll-masters/tax-formulas')
export class TaxFormulasController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'tax formulas',
  createDto: Dto.CreateTaxFormulaDto,
  updateDto: Dto.UpdateTaxFormulaDto,
}) {
  constructor(protected readonly service: S.TaxFormulasService) { super(); }

  @ApiOperation({ summary: 'Replace a tax formula\'s slab rows' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Put(':id/slabs')
  replaceSlabs(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ReplaceTaxSlabsDto,
  ) {
    return this.service.replaceSlabs(user.companyId as string, id, dto);
  }
}
