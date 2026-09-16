import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

// Sub-areas (Section 6.3)
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { ShiftsService } from './attendance/shifts.service';
import { ContractsController } from './contracts/contracts.controller';
import { ContractsService } from './contracts/contracts.service';
import { LeavesController } from './leaves/leaves.controller';
import { LeavesService } from './leaves/leaves.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { PositionsController } from './positions/positions.controller';
import { PositionsService } from './positions/positions.service';
import {
  EmployeeCategoriesController,
  GradesController,
  LoanTypesController,
  PayPeriodsController,
  TaxFormulasController,
} from './payroll-masters/payroll-masters.controllers';
import {
  EmployeeCategoriesService,
  GradesService,
  LoanTypesService,
  PayPeriodsService,
  TaxFormulasService,
} from './payroll-masters/payroll-masters.services';
import {
  AttendanceSheetsController,
  PayrollRunsController,
  PayrollAdjustmentsController,
  EmployeeLoansController,
} from './transactions/transactions.controllers';
import {
  AttendanceSheetsService,
  PayrollRunsService,
  PayrollAdjustmentsService,
  EmployeeLoansService,
} from './transactions/transactions.services';

@Module({
  controllers: [
    HrController,
    PositionsController,
    ContractsController,
    LeavesController,
    AttendanceController,
    OnboardingController,
    EmployeeCategoriesController,
    GradesController,
    LoanTypesController,
    PayPeriodsController,
    TaxFormulasController,
    AttendanceSheetsController,
    PayrollRunsController,
    PayrollAdjustmentsController,
    EmployeeLoansController,
  ],
  providers: [
    HrService,
    PositionsService,
    ContractsService,
    LeavesService,
    AttendanceService,
    ShiftsService,
    OnboardingService,
    EmployeeCategoriesService,
    GradesService,
    LoanTypesService,
    PayPeriodsService,
    TaxFormulasService,
    AttendanceSheetsService,
    PayrollRunsService,
    PayrollAdjustmentsService,
    EmployeeLoansService,
  ],
  exports: [
    HrService,
    PositionsService,
    ContractsService,
    LeavesService,
    AttendanceService,
    ShiftsService,
    OnboardingService,
    EmployeeCategoriesService,
    GradesService,
    LoanTypesService,
    PayPeriodsService,
    TaxFormulasService,
    AttendanceSheetsService,
    PayrollRunsService,
    PayrollAdjustmentsService,
    EmployeeLoansService,
  ],
})
export class HrModule {}
