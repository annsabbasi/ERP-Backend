import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthedUser } from '../../../common/crud/tenant-crud.controller';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { RequireModule } from '../../../common/decorators/module-access.decorator';
import { PutPaymentDetailsDto } from './payment-details.dto';
import { PaymentDetailsService } from './payment-details.service';

/**
 * Employee payment method and bank account. Its own permissions
 * (hr.employee_bank.*), separate from editing the employee record: changing
 * where pay goes is the classic payroll fraud, so it is granted on purpose,
 * not inherited with hr.employee.update.
 */
@RequireModule('hr', 'hr-payroll', 'hr-employee-records')
@Controller('hr/employees/:employeeId/payment-details')
export class PaymentDetailsController {
  constructor(
    private readonly details: PaymentDetailsService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('hr.employee_bank.view')
  @Get()
  get(@Param('employeeId') employeeId: string) {
    return this.details.get(this.tenant.requireCompanyId(), employeeId);
  }

  @RequirePermission('hr.employee_bank.view')
  @Get('history')
  history(@Param('employeeId') employeeId: string) {
    return this.details.history(this.tenant.requireCompanyId(), employeeId);
  }

  /**
   * The choices the form offers, served here so a bank-details officer needs
   * no Financials access: active outgoing methods an employee can default to
   * (not LOAN/ADV, which settle at payment time) and active banks.
   */
  @RequirePermission('hr.employee_bank.update')
  @Get('options')
  options(@Param('employeeId') employeeId: string) {
    return this.details.options(this.tenant.requireCompanyId(), employeeId);
  }

  @RequirePermission('hr.employee_bank.update')
  @Put()
  put(
    @Param('employeeId') employeeId: string,
    @Body() dto: PutPaymentDetailsDto,
    @CurrentUser() user: AuthedUser | undefined,
    @Req() req: Request,
  ) {
    return this.details.put(this.tenant.requireCompanyId(), employeeId, dto, {
      actorId: user?.sub ?? null,
      ip: req.ip,
    });
  }
}
