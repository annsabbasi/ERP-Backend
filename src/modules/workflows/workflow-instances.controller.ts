import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma, WorkflowStatus } from '@prisma/client';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelWorkflowDto,
  DecideApprovalDto,
  StartWorkflowDto,
} from './dto/workflow-instance.dto';
import { WorkflowEngineService } from './workflow-engine.service';

@Controller('workflows')
export class WorkflowInstancesController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  @RequirePermission('workflow.instance.start')
  @Post('start')
  start(@Body() dto: StartWorkflowDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.engine.start({
      companyId: this.tenant.requireCompanyId(),
      definitionKey: dto.definitionKey,
      version: dto.version,
      initiatorId: user?.sub ?? null,
      refType: dto.refType,
      refId: dto.refId,
      context: dto.context,
      ip: req.ip,
    });
  }

  @RequirePermission('workflow.instance.view')
  @Get('instances')
  async list(
    @Query('status') status?: string,
    @Query('refType') refType?: string,
    @Query('refId') refId?: string,
    @Query('initiatorId') initiatorId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const companyId = this.tenant.requireCompanyId();
    const where: Prisma.WorkflowInstanceWhereInput = {
      companyId,
      ...(status ? { status: status.toUpperCase() as WorkflowStatus } : {}),
      ...(refType ? { refType } : {}),
      ...(refId ? { refId } : {}),
      ...(initiatorId ? { initiatorId } : {}),
    };
    const pageN = Math.max(1, page ? parseInt(page, 10) : 1);
    const sizeN = Math.min(100, Math.max(1, pageSize ? parseInt(pageSize, 10) : 25));
    const [total, items] = await this.prisma.$transaction([
      this.prisma.workflowInstance.count({ where }),
      this.prisma.workflowInstance.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (pageN - 1) * sizeN,
        take: sizeN,
        include: { definition: { select: { key: true, version: true, name: true } } },
      }),
    ]);
    return { total, page: pageN, pageSize: sizeN, items };
  }

  @RequirePermission('workflow.instance.view')
  @Get('instances/:id')
  async findOne(@Param('id') id: string) {
    const companyId = this.tenant.requireCompanyId();
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id, companyId },
      include: {
        definition: { select: { key: true, version: true, name: true } },
        history: { orderBy: { occurredAt: 'asc' } },
        approvals: true,
      },
    });
    if (!inst) throw new NotFoundException(`Instance ${id} not found`);
    return inst;
  }

  @RequirePermission('workflow.instance.cancel')
  @Post('instances/:id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelWorkflowDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.engine.cancel(id, user?.sub ?? null, dto.reason, req.ip);
  }

  @RequirePermission('workflow.instance.view')
  @Post('instances/:id/resume')
  resume(@Param('id') id: string) {
    return this.engine.resumeWaiting(id);
  }

  // ── Approvals — caller's own queue ───────────────────────────────────────

  @Get('my-approvals')
  async myApprovals(@CurrentUser() user: any) {
    const userId = user?.sub;
    if (!userId) throw new BadRequestException('No authenticated user');
    const rows = await this.prisma.workflowApproval.findMany({
      where: { approverId: userId, decision: null },
      include: {
        instance: { include: { definition: { select: { name: true, key: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter((r) => r.instance.status === WorkflowStatus.AWAITING_APPROVAL);
  }

  @Post('approvals/:approvalId/decide')
  async decide(
    @Param('approvalId') approvalId: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const userId = user?.sub;
    if (!userId) throw new BadRequestException('No authenticated user');
    const approval = await this.prisma.workflowApproval.findUnique({ where: { id: approvalId } });
    if (!approval) throw new NotFoundException(`Approval ${approvalId} not found`);
    if (approval.approverId !== userId) {
      throw new ForbiddenException('You are not the named approver');
    }
    return this.engine.respond({
      instanceId: approval.instanceId,
      stepKey: approval.stepKey,
      approverId: userId,
      decision: dto.decision,
      comment: dto.comment,
      ip: req.ip,
    });
  }
}
