import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { LeaveRequestStatus } from '@prisma/client';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import {
  AdjustBalanceDto,
  CreateLeaveTypeDto,
  DecideLeaveRequestDto,
  ReplaceLeaveDateRangesDto,
  SubmitLeaveRequestDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { LeavesService } from './leaves.service';

@Controller('hr/leaves')
export class LeavesController {
  constructor(
    private readonly leaves: LeavesService,
    private readonly tenant: TenantContextService,
  ) {}

  // ── Types ────────────────────────────────────────────────────────────────

  @RequirePermission('hr.view')
  @Get('types')
  listTypes() {
    return this.leaves.listTypes(this.tenant.requireCompanyId());
  }

  @RequirePermission('hr.leave_type.manage')
  @Post('types')
  createType(@Body() dto: CreateLeaveTypeDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.leaves.createType(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.leave_type.manage')
  @Patch('types/:id')
  updateType(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveTypeDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.leaves.updateType(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.leave_type.manage')
  @Delete('types/:id')
  removeType(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.leaves.removeType(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.leave_type.manage')
  @Put('types/:id/date-ranges')
  replaceDateRanges(
    @Param('id') id: string,
    @Body() dto: ReplaceLeaveDateRangesDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.leaves.replaceDateRanges(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  @RequirePermission('hr.leave.manage_all')
  @Get('balances')
  listBalances(@Query('employeeId') employeeId?: string, @Query('periodKey') periodKey?: string) {
    return this.leaves.listBalances(this.tenant.requireCompanyId(), { employeeId, periodKey });
  }

  @RequirePermission('hr.leave.manage_all')
  @Post('balances/adjust')
  adjustBalance(@Body() dto: AdjustBalanceDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.leaves.adjustBalance(this.tenant.requireCompanyId(), dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  // ── Requests ─────────────────────────────────────────────────────────────

  @RequirePermission('hr.leave.manage_all')
  @Get('requests')
  listAllRequests(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.leaves.listRequests(this.tenant.requireCompanyId(), {
      employeeId,
      status: status ? (status.toUpperCase() as LeaveRequestStatus) : undefined,
    });
  }

  /**
   * Employee-friendly submission endpoint. The controller takes the
   * employeeId in the URL so HR can also submit on behalf of an employee
   * (they need `hr.leave.manage_all`).
   */
  @RequirePermission('hr.view')
  @Post('requests/employees/:employeeId')
  submit(
    @Param('employeeId') employeeId: string,
    @Body() dto: SubmitLeaveRequestDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.leaves.submit(this.tenant.requireCompanyId(), employeeId, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.leave.manage_all')
  @Post('requests/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.leaves.approve(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @RequirePermission('hr.leave.manage_all')
  @Post('requests/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.leaves.reject(this.tenant.requireCompanyId(), id, dto, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.leaves.cancel(this.tenant.requireCompanyId(), id, {
      actorId: user?.sub ?? null, ip: req.ip,
    });
  }
}
