import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceEntry,
  AttendanceSource,
  AttendanceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  CheckInDto,
  CheckOutDto,
  EditAttendanceDto,
} from './dto/attendance.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
  userAgent?: string;
}

/**
 * Daily attendance tracking. One row per (employee, date). Clock-in either
 * opens a new row or marks an existing one resumed; clock-out stamps the
 * checkOut time and computes `workedMinutes`.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Self-service (clock-in / clock-out) ──────────────────────────────────

  async checkIn(companyId: string, employeeId: string, dto: CheckInDto, meta: AuditMeta): Promise<AttendanceEntry> {
    await this.assertEmployee(companyId, employeeId);

    const today = startOfUtcDay(new Date());
    const existing = await this.prisma.attendanceEntry.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (existing && existing.status === AttendanceStatus.CHECKED_IN && !existing.checkOut) {
      throw new BadRequestException('Already checked in today');
    }

    const entry = existing
      ? await this.prisma.attendanceEntry.update({
          where: { id: existing.id },
          data: {
            checkIn: existing.checkIn ?? new Date(),
            status: AttendanceStatus.CHECKED_IN,
            checkOut: null,
            workedMinutes: null,
            source: dto.source ?? existing.source,
            shiftId: dto.shiftId ?? existing.shiftId,
            notes: dto.notes ?? existing.notes,
            ip: meta.ip ?? existing.ip,
          },
        })
      : await this.prisma.attendanceEntry.create({
          data: {
            companyId,
            employeeId,
            date: today,
            checkIn: new Date(),
            source: dto.source ?? AttendanceSource.WEB,
            status: AttendanceStatus.CHECKED_IN,
            shiftId: dto.shiftId ?? null,
            notes: dto.notes,
            ip: meta.ip,
          },
        });

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.attendance.check_in',
      refType: 'attendance_entry', refId: entry.id,
      after: { checkIn: entry.checkIn, source: entry.source } as any,
      ip: meta.ip, userAgent: meta.userAgent, module: 'hr-attendance',
      alsoActivityLog: false,
    });
    return entry;
  }

  async checkOut(companyId: string, employeeId: string, dto: CheckOutDto, meta: AuditMeta): Promise<AttendanceEntry> {
    await this.assertEmployee(companyId, employeeId);
    const today = startOfUtcDay(new Date());
    const existing = await this.prisma.attendanceEntry.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (!existing || !existing.checkIn || existing.status === AttendanceStatus.CHECKED_OUT) {
      throw new BadRequestException('Not checked in — call /check-in first');
    }

    const now = new Date();
    const minutes = Math.max(0, Math.round((now.getTime() - existing.checkIn.getTime()) / 60_000));
    const entry = await this.prisma.attendanceEntry.update({
      where: { id: existing.id },
      data: {
        checkOut: now,
        status: AttendanceStatus.CHECKED_OUT,
        workedMinutes: minutes,
        notes: dto.notes ?? existing.notes,
      },
    });

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.attendance.check_out',
      refType: 'attendance_entry', refId: entry.id,
      after: { checkOut: entry.checkOut, workedMinutes: minutes } as any,
      ip: meta.ip, userAgent: meta.userAgent, module: 'hr-attendance',
      alsoActivityLog: false,
    });
    return entry;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async listForEmployee(
    companyId: string,
    employeeId: string,
    opts: { from?: string; to?: string } = {},
  ) {
    await this.assertEmployee(companyId, employeeId);
    const where: Prisma.AttendanceEntryWhereInput = { employeeId, companyId };
    if (opts.from || opts.to) {
      where.date = {
        ...(opts.from ? { gte: startOfUtcDay(new Date(opts.from)) } : {}),
        ...(opts.to ? { lte: startOfUtcDay(new Date(opts.to)) } : {}),
      };
    }
    return this.prisma.attendanceEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 366,
    });
  }

  async listForCompany(companyId: string, opts: { date?: string }) {
    const date = opts.date ? startOfUtcDay(new Date(opts.date)) : startOfUtcDay(new Date());
    return this.prisma.attendanceEntry.findMany({
      where: { companyId, date },
      include: {
        employee: { select: { id: true, name: true, departmentId: true, branchId: true } },
      },
      orderBy: { checkIn: 'asc' },
    });
  }

  // ── HR-edit ──────────────────────────────────────────────────────────────

  async editEntry(
    companyId: string,
    id: string,
    dto: EditAttendanceDto,
    meta: AuditMeta,
  ) {
    const before = await this.prisma.attendanceEntry.findFirst({ where: { id, companyId } });
    if (!before) throw new NotFoundException(`Attendance entry ${id} not found`);

    const checkIn = dto.checkIn ? new Date(dto.checkIn) : before.checkIn;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : before.checkOut;
    const minutes = checkIn && checkOut
      ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000))
      : before.workedMinutes;

    const updated = await this.prisma.attendanceEntry.update({
      where: { id },
      data: {
        checkIn,
        checkOut,
        workedMinutes: minutes,
        notes: dto.notes ?? before.notes,
        status: checkOut ? AttendanceStatus.CHECKED_OUT : before.status,
        source: AttendanceSource.MANUAL,
      },
    });

    await this.audit.record({
      companyId, actorId: meta.actorId,
      action: 'hr.attendance.edited',
      refType: 'attendance_entry', refId: id,
      before: { checkIn: before.checkIn, checkOut: before.checkOut, workedMinutes: before.workedMinutes } as any,
      after: { checkIn: updated.checkIn, checkOut: updated.checkOut, workedMinutes: updated.workedMinutes } as any,
      ip: meta.ip, module: 'hr-attendance',
    });
    return updated;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async assertEmployee(companyId: string, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`);
    if (emp.deletedAt) throw new ForbiddenException('Employee is archived');
  }
}

function startOfUtcDay(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return x;
}
