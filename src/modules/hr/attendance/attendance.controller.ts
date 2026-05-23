import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import {
  AssignShiftDto,
  CheckInDto,
  CheckOutDto,
  CreateShiftDto,
  EditAttendanceDto,
  UpdateShiftDto,
} from './dto/attendance.dto';
import { AttendanceService } from './attendance.service';
import { ShiftsService } from './shifts.service';

@Controller('hr')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly shifts: ShiftsService,
    private readonly tenant: TenantContextService,
  ) {}

  // ── Shifts ───────────────────────────────────────────────────────────────

  @RequirePermission('hr.view')
  @Get('shifts')
  listShifts() {
    return this.shifts.list(this.tenant.requireCompanyId());
  }

  @RequirePermission('hr.shift.manage')
  @Post('shifts')
  createShift(@Body() dto: CreateShiftDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.shifts.create(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.shift.manage')
  @Patch('shifts/:id')
  updateShift(
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shifts.update(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.shift.manage')
  @Post('employees/:employeeId/shifts')
  assignShift(
    @Param('employeeId') employeeId: string,
    @Body() dto: AssignShiftDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.shifts.assign(this.tenant.requireCompanyId(), employeeId, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.view')
  @Get('employees/:employeeId/shifts')
  employeeShifts(@Param('employeeId') employeeId: string) {
    return this.shifts.assignmentsForEmployee(this.tenant.requireCompanyId(), employeeId);
  }

  // ── Attendance ────────────────────────────────────────────────────────────

  @RequirePermission('hr.view')
  @Get('attendance/employees/:employeeId')
  forEmployee(
    @Param('employeeId') employeeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.attendance.listForEmployee(this.tenant.requireCompanyId(), employeeId, { from, to });
  }

  @RequirePermission('hr.attendance.view_all')
  @Get('attendance/daily')
  daily(@Query('date') date?: string) {
    return this.attendance.listForCompany(this.tenant.requireCompanyId(), { date });
  }

  @Post('attendance/employees/:employeeId/check-in')
  checkIn(
    @Param('employeeId') employeeId: string,
    @Body() dto: CheckInDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.attendance.checkIn(this.tenant.requireCompanyId(), employeeId, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post('attendance/employees/:employeeId/check-out')
  checkOut(
    @Param('employeeId') employeeId: string,
    @Body() dto: CheckOutDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.attendance.checkOut(this.tenant.requireCompanyId(), employeeId, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @RequirePermission('hr.attendance.edit')
  @Patch('attendance/:id')
  edit(
    @Param('id') id: string,
    @Body() dto: EditAttendanceDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.attendance.editEntry(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }
}
