import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { TenantCrudController } from '../../../common/crud/tenant-crud.controller';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import * as S from './transactions.services';
import * as Dto from './transactions.dto';

const PERMISSION_RESOURCE = 'hr.payroll';

// ─── MONTHLY ATTENDANCE SHEET ───────────────────────────────────────────────────
@ApiTags('HR Payroll — Monthly Attendance Sheet')
@RequireModule('hr-payroll')
@Controller('hr/transactions/attendance-sheets')
export class AttendanceSheetsController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'monthly attendance sheets',
  createDto: Dto.CreateAttendanceSheetDto,
  updateDto: Dto.UpdateAttendanceSheetDto,
}) {
  constructor(protected readonly service: S.AttendanceSheetsService) { super(); }

  @ApiOperation({ summary: 'Get a sheet\'s employee lines' })
  @RequirePermission(`${PERMISSION_RESOURCE}.view`)
  @Get(':id/lines')
  getLines(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.getLines(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Replace a sheet\'s employee lines (manual save)' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Put(':id/lines')
  replaceLines(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ReplaceAttendanceSheetLinesDto,
  ) {
    return this.service.replaceLines(user.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Auto-populate a sheet\'s lines from live attendance data' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Post(':id/generate')
  generate(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.generateLines(user.companyId as string, id);
  }
}

// ─── PAYROLL PROCESS ────────────────────────────────────────────────────────────
@ApiTags('HR Payroll — Payroll Process')
@RequireModule('hr-payroll')
@Controller('hr/transactions/payroll-runs')
export class PayrollRunsController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'payroll runs',
  createDto: Dto.CreatePayrollRunDto,
  updateDto: Dto.UpdatePayrollRunDto,
}) {
  constructor(protected readonly service: S.PayrollRunsService) { super(); }

  @ApiOperation({ summary: 'Get a payroll run\'s employee lines' })
  @RequirePermission(`${PERMISSION_RESOURCE}.view`)
  @Get(':id/lines')
  getLines(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.getLines(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Replace a payroll run\'s employee lines (manual save)' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Put(':id/lines')
  replaceLines(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ReplacePayrollRunLinesDto,
  ) {
    return this.service.replaceLines(user.companyId as string, id, dto);
  }

  @ApiOperation({ summary: 'Auto-populate a payroll run\'s lines from Grade pay scale + attendance' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Post(':id/generate')
  generate(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.generateLines(user.companyId as string, id);
  }
}

// ─── PAYROLL MONTHLY ADJUSTMENTS ────────────────────────────────────────────────
@ApiTags('HR Payroll — Payroll Monthly Adjustments')
@RequireModule('hr-payroll')
@Controller('hr/transactions/payroll-adjustments')
export class PayrollAdjustmentsController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'payroll adjustments',
  createDto: Dto.CreatePayrollAdjustmentDto,
  updateDto: Dto.UpdatePayrollAdjustmentDto,
}) {
  constructor(protected readonly service: S.PayrollAdjustmentsService) { super(); }

  @ApiOperation({ summary: 'Get an adjustment doc\'s employee lines' })
  @RequirePermission(`${PERMISSION_RESOURCE}.view`)
  @Get(':id/lines')
  getLines(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.getLines(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Replace an adjustment doc\'s employee lines' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Put(':id/lines')
  replaceLines(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ReplacePayrollAdjustmentLinesDto,
  ) {
    return this.service.replaceLines(user.companyId as string, id, dto);
  }
}

// ─── LOAN APPLICATION ────────────────────────────────────────────────────────────
@ApiTags('HR Payroll — Loan Application')
@RequireModule('hr-payroll')
@Controller('hr/transactions/loan-applications')
export class EmployeeLoansController extends TenantCrudController({
  permissionResource: PERMISSION_RESOURCE,
  label: 'loan applications',
  createDto: Dto.CreateEmployeeLoanDto,
  updateDto: Dto.UpdateEmployeeLoanDto,
}) {
  constructor(protected readonly service: S.EmployeeLoansService) { super(); }

  @ApiOperation({ summary: 'Get a loan\'s installment schedule' })
  @RequirePermission(`${PERMISSION_RESOURCE}.view`)
  @Get(':id/installments')
  getInstallments(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.service.getInstallments(user.companyId as string, id);
  }

  @ApiOperation({ summary: 'Replace a loan\'s installment schedule (manual override)' })
  @RequirePermission(`${PERMISSION_RESOURCE}.update`)
  @Put(':id/installments')
  replaceInstallments(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: Dto.ReplaceLoanInstallmentsDto,
  ) {
    return this.service.replaceInstallments(user.companyId as string, id, dto);
  }
}
