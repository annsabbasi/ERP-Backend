import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { TerminateEmployeeDto } from './dto/terminate-employee.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

/**
 * Workforce master. Adds richer hierarchy, position FK, branch scoping, and
 * status transitions on top of the original skeletal scaffold.
 *
 * Backwards-compatible: legacy `position` string + `salary` decimal remain
 * writable through the existing CRUD surface. New code should attach
 * EmploymentContracts via /hr/employees/:id/contracts and reference
 * `positionId` instead.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async findAll(
    companyId: string,
    opts: {
      branchId?: string;
      departmentId?: string;
      managerId?: string;
      employeeCategoryId?: string;
      status?: EmployeeStatus;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
      ...(opts.managerId ? { managerId: opts.managerId } : {}),
      ...(opts.employeeCategoryId ? { employeeCategoryId: opts.employeeCategoryId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.q
        ? {
            OR: [
              { name: { contains: opts.q, mode: 'insensitive' } },
              { email: { contains: opts.q, mode: 'insensitive' } },
              { employeeNumber: { contains: opts.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

    const [total, items] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          department: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          positionRef: { select: { id: true, title: true } },
          manager: { select: { id: true, name: true } },
          employeeCategory: { select: { id: true, code: true, name: true } },
          grade: { select: { id: true, code: true, description: true } },
          currentShift: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async findOne(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        positionRef: { select: { id: true, title: true } },
        manager: { select: { id: true, name: true } },
        reports: { select: { id: true, name: true, status: true } },
        contracts: { where: { isActive: true }, orderBy: { startDate: 'desc' }, take: 1 },
        employeeCategory: { select: { id: true, code: true, name: true } },
        grade: { select: { id: true, code: true, description: true } },
        currentShift: { select: { id: true, code: true, name: true } },
      },
    });
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);
    return employee;
  }

  directReports(companyId: string, managerId: string) {
    return this.prisma.employee.findMany({
      where: { companyId, managerId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        department: { select: { id: true, name: true } },
        positionRef: { select: { id: true, title: true } },
      },
    });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateEmployeeDto, meta: AuditMeta) {
    await this.validateFKs(companyId, dto);
    if (dto.userId) await this.assertUserUnique(companyId, dto.userId);

    const employee = await this.prisma.employee.create({
      data: {
        companyId,
        userId: dto.userId ?? null,
        employeeNumber: dto.employeeNumber,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        departmentId: dto.departmentId ?? null,
        branchId: dto.branchId ?? null,
        positionId: dto.positionId ?? null,
        managerId: dto.managerId ?? null,
        position: dto.position,
        salary: dto.salary as any,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        status: dto.status ?? EmployeeStatus.ACTIVE,
        customFields: dto.customFields === undefined ? undefined : (dto.customFields as Prisma.InputJsonValue),
        fatherName: dto.fatherName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        originalDateOfBirth: dto.originalDateOfBirth ? new Date(dto.originalDateOfBirth) : undefined,
        nationality: dto.nationality,
        mobilePhone2: dto.mobilePhone2,
        dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
        insurancePolicyNo: dto.insurancePolicyNo,
        pfNo: dto.pfNo,
        esiNo: dto.esiNo,
        otherInfo: dto.otherInfo,
        fuelLiters: dto.fuelLiters as any,
        address1: dto.address1,
        address2: dto.address2,
        address3: dto.address3,
        city: dto.city,
        pinCode: dto.pinCode,
        state: dto.state,
        sectionType: dto.sectionType,
        locationProjectSite: dto.locationProjectSite,
        employeeCategoryId: dto.employeeCategoryId ?? null,
        gradeId: dto.gradeId ?? null,
        currentShiftId: dto.currentShiftId ?? null,
      },
      include: {
        department: true, positionRef: true, branch: true,
        employeeCategory: true, grade: true, currentShift: true,
      },
    });

    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.employee.created',
      refType: 'employee',
      refId: employee.id,
      after: {
        name: employee.name,
        email: employee.email,
        departmentId: employee.departmentId,
        positionId: employee.positionId,
        hireDate: employee.hireDate,
      } as any,
      ip: meta.ip,
      module: 'hr',
    });
    return employee;
  }

  async update(companyId: string, id: string, dto: UpdateEmployeeDto, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    await this.validateFKs(companyId, dto);
    if (dto.managerId === id) throw new BadRequestException('An employee cannot be their own manager');

    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        email: dto.email ?? undefined,
        phone: dto.phone ?? undefined,
        employeeNumber: dto.employeeNumber ?? undefined,
        departmentId: dto.departmentId === undefined ? undefined : dto.departmentId,
        branchId: dto.branchId === undefined ? undefined : dto.branchId,
        positionId: dto.positionId === undefined ? undefined : dto.positionId,
        managerId: dto.managerId === undefined ? undefined : dto.managerId,
        position: dto.position ?? undefined,
        salary: (dto.salary as any) ?? undefined,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        status: dto.status ?? undefined,
        customFields: dto.customFields === undefined ? undefined : (dto.customFields as Prisma.InputJsonValue),
        fatherName: dto.fatherName ?? undefined,
        gender: dto.gender ?? undefined,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        originalDateOfBirth: dto.originalDateOfBirth ? new Date(dto.originalDateOfBirth) : undefined,
        nationality: dto.nationality ?? undefined,
        mobilePhone2: dto.mobilePhone2 ?? undefined,
        dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
        insurancePolicyNo: dto.insurancePolicyNo ?? undefined,
        pfNo: dto.pfNo ?? undefined,
        esiNo: dto.esiNo ?? undefined,
        otherInfo: dto.otherInfo ?? undefined,
        fuelLiters: (dto.fuelLiters as any) ?? undefined,
        address1: dto.address1 ?? undefined,
        address2: dto.address2 ?? undefined,
        address3: dto.address3 ?? undefined,
        city: dto.city ?? undefined,
        pinCode: dto.pinCode ?? undefined,
        state: dto.state ?? undefined,
        sectionType: dto.sectionType ?? undefined,
        locationProjectSite: dto.locationProjectSite ?? undefined,
        employeeCategoryId: dto.employeeCategoryId === undefined ? undefined : dto.employeeCategoryId,
        gradeId: dto.gradeId === undefined ? undefined : dto.gradeId,
        currentShiftId: dto.currentShiftId === undefined ? undefined : dto.currentShiftId,
      },
      include: {
        department: true, positionRef: true, branch: true,
        employeeCategory: true, grade: true, currentShift: true,
      },
    });

    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.employee.updated',
      refType: 'employee',
      refId: id,
      before: pickAudit(before),
      after: pickAudit(updated),
      ip: meta.ip,
      module: 'hr',
    });
    return updated;
  }

  async terminate(companyId: string, id: string, dto: TerminateEmployeeDto, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    if (before.status === EmployeeStatus.TERMINATED) return before;

    const date = dto.terminationDate ? new Date(dto.terminationDate) : new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.employee.update({
        where: { id },
        data: { status: EmployeeStatus.TERMINATED, terminationDate: date, isActive: false },
      });
      // Close any active contracts at the same date.
      await tx.employmentContract.updateMany({
        where: { employeeId: id, isActive: true },
        data: { isActive: false, endDate: date },
      });
      return u;
    });

    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.employee.terminated',
      refType: 'employee',
      refId: id,
      before: { status: before.status, terminationDate: before.terminationDate } as any,
      after: { status: updated.status, terminationDate: updated.terminationDate, reason: dto.reason } as any,
      ip: meta.ip,
      module: 'hr',
    });
    return updated;
  }

  async reactivate(companyId: string, id: string, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    const updated = await this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.ACTIVE, terminationDate: null, isActive: true },
    });
    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.employee.reactivated',
      refType: 'employee',
      refId: id,
      before: { status: before.status } as any,
      after: { status: updated.status } as any,
      ip: meta.ip,
      module: 'hr',
    });
    return updated;
  }

  async remove(companyId: string, id: string, meta: AuditMeta) {
    const before = await this.findOne(companyId, id);
    // Soft-delete to preserve historical data (contracts, attendance, audit).
    await this.prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, status: EmployeeStatus.TERMINATED },
    });
    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.employee.deleted',
      refType: 'employee',
      refId: id,
      before: pickAudit(before),
      ip: meta.ip,
      module: 'hr',
    });
    return { message: `Employee ${id} archived` };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async validateFKs(companyId: string, dto: Partial<CreateEmployeeDto>) {
    if (dto.departmentId) {
      const d = await this.prisma.department.findFirst({ where: { id: dto.departmentId, companyId } });
      if (!d) throw new BadRequestException(`Department ${dto.departmentId} not found`);
    }
    if (dto.branchId) {
      const b = await this.prisma.branch.findFirst({ where: { id: dto.branchId, companyId } });
      if (!b) throw new BadRequestException(`Branch ${dto.branchId} not found`);
    }
    if (dto.positionId) {
      const p = await this.prisma.position.findFirst({ where: { id: dto.positionId, companyId } });
      if (!p) throw new BadRequestException(`Position ${dto.positionId} not found`);
    }
    if (dto.managerId) {
      const m = await this.prisma.employee.findFirst({ where: { id: dto.managerId, companyId } });
      if (!m) throw new BadRequestException(`Manager (employee) ${dto.managerId} not found`);
    }
    if (dto.employeeCategoryId) {
      const c = await this.prisma.employeeCategory.findFirst({ where: { id: dto.employeeCategoryId, companyId } });
      if (!c) throw new BadRequestException(`Employee category ${dto.employeeCategoryId} not found`);
    }
    if (dto.gradeId) {
      const g = await this.prisma.grade.findFirst({ where: { id: dto.gradeId, companyId } });
      if (!g) throw new BadRequestException(`Grade ${dto.gradeId} not found`);
    }
    if (dto.currentShiftId) {
      const s = await this.prisma.shift.findFirst({ where: { id: dto.currentShiftId, companyId } });
      if (!s) throw new BadRequestException(`Shift ${dto.currentShiftId} not found`);
    }
  }

  private async assertUserUnique(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new BadRequestException(`User ${userId} not in this company`);
    const existing = await this.prisma.employee.findFirst({ where: { userId } });
    if (existing) throw new BadRequestException(`User ${userId} already linked to employee ${existing.id}`);
  }
}

function pickAudit(e: any) {
  return {
    name: e.name,
    email: e.email,
    departmentId: e.departmentId,
    branchId: e.branchId,
    positionId: e.positionId,
    managerId: e.managerId,
    status: e.status,
    salary: e.salary,
  };
}
