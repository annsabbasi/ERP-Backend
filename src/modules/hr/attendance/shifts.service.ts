import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AssignShiftDto,
  CreateShiftDto,
  UpdateShiftDto,
} from './dto/attendance.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string) {
    return this.prisma.shift.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async findOne(companyId: string, id: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id, companyId } });
    if (!shift) throw new NotFoundException(`Shift ${id} not found`);
    return shift;
  }

  async create(companyId: string, dto: CreateShiftDto, meta: AuditMeta) {
    const conflict = await this.prisma.shift.findFirst({ where: { companyId, code: dto.code } });
    if (conflict) throw new BadRequestException(`Shift code "${dto.code}" already exists`);
    const shift = await this.prisma.shift.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isOvernight: dto.isOvernight ?? false,
        breakMinutes: dto.breakMinutes ?? 0,
        workDays: dto.workDays,
        remarks: dto.remarks,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.shift.created', refType: 'shift', refId: shift.id,
      after: shift as any, ip: meta.ip, module: 'hr-attendance',
    });
    return shift;
  }

  async update(companyId: string, id: string, dto: UpdateShiftDto, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    const updated = await this.prisma.shift.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        startTime: dto.startTime ?? undefined,
        endTime: dto.endTime ?? undefined,
        isOvernight: dto.isOvernight ?? undefined,
        breakMinutes: dto.breakMinutes ?? undefined,
        workDays: dto.workDays ?? undefined,
        remarks: dto.remarks ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.shift.updated', refType: 'shift', refId: id,
      before: before as any, after: updated as any, ip: meta.ip, module: 'hr-attendance',
    });
    return updated;
  }

  async remove(companyId: string, id: string, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    const assignments = await this.prisma.employeeShift.count({ where: { shiftId: id } });
    if (assignments) {
      await this.prisma.shift.update({ where: { id }, data: { isActive: false } });
      return { message: `Shift ${id} deactivated (still has ${assignments} assignment(s))` };
    }
    await this.prisma.shift.delete({ where: { id } });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.shift.deleted', refType: 'shift', refId: id,
      before: before as any, ip: meta.ip, module: 'hr-attendance',
    });
    return { message: `Shift ${id} deleted` };
  }

  // ── Employee assignments ──────────────────────────────────────────────────

  async assign(companyId: string, employeeId: string, dto: AssignShiftDto, meta: AuditMeta) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`);
    await this.findOne(companyId, dto.shiftId);

    const assignment = await this.prisma.employeeShift.create({
      data: {
        employeeId,
        shiftId: dto.shiftId,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
    });
    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.shift.assigned', refType: 'employee_shift', refId: assignment.id,
      after: assignment as any, ip: meta.ip, module: 'hr-attendance',
    });
    return assignment;
  }

  async assignmentsForEmployee(companyId: string, employeeId: string) {
    return this.prisma.employeeShift.findMany({
      where: { employeeId, employee: { companyId } },
      orderBy: { effectiveFrom: 'desc' },
      include: { shift: true },
    });
  }
}
