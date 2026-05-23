import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';

interface AuditMeta {
  actorId: string | null;
  ip?: string;
}

/**
 * Employment contracts per employee.
 *
 * Invariant: at most one `isActive: true` contract per employee at a time.
 * Creating a new active contract auto-deactivates the prior one with an
 * audit row, preserving the full history for compliance.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string, employeeId: string) {
    return this.prisma.employmentContract.findMany({
      where: { employeeId, employee: { companyId } },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      include: { position: { select: { id: true, title: true } } },
    });
  }

  async findOne(companyId: string, employeeId: string, id: string) {
    const c = await this.prisma.employmentContract.findFirst({
      where: { id, employeeId, employee: { companyId } },
      include: { position: { select: { id: true, title: true } } },
    });
    if (!c) throw new NotFoundException(`Contract ${id} not found`);
    return c;
  }

  async create(companyId: string, employeeId: string, dto: CreateContractDto, meta: AuditMeta) {
    await this.assertEmployee(companyId, employeeId);
    if (dto.positionId) await this.assertPosition(companyId, dto.positionId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isActive !== false) {
        await tx.employmentContract.updateMany({
          where: { employeeId, isActive: true },
          data: { isActive: false },
        });
      }
      const contract = await tx.employmentContract.create({
        data: {
          employeeId,
          positionId: dto.positionId ?? null,
          type: dto.type,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          salaryAmountMinor: dto.salaryAmountMinor,
          salaryCurrency: dto.salaryCurrency ?? 'USD',
          salaryFrequency: dto.salaryFrequency,
          workHoursPerWeek: dto.workHoursPerWeek,
          notes: dto.notes,
          isActive: dto.isActive ?? true,
        },
      });
      return contract;
    }).then(async (c) => {
      await this.audit.record({
        companyId,
        actorId: meta.actorId,
        action: 'hr.contract.created',
        refType: 'employment_contract',
        refId: c.id,
        after: { employeeId, type: c.type, startDate: c.startDate, salaryAmountMinor: c.salaryAmountMinor } as any,
        ip: meta.ip,
        module: 'hr-payroll',
      });
      return c;
    });
  }

  async update(companyId: string, employeeId: string, id: string, dto: UpdateContractDto, meta: AuditMeta) {
    const before = await this.findOne(companyId, employeeId, id);
    if (dto.positionId) await this.assertPosition(companyId, dto.positionId);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isActive === true && !before.isActive) {
        await tx.employmentContract.updateMany({
          where: { employeeId, isActive: true, id: { not: id } },
          data: { isActive: false },
        });
      }
      return tx.employmentContract.update({
        where: { id },
        data: {
          type: dto.type ?? undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate === undefined ? undefined : (dto.endDate ? new Date(dto.endDate) : null),
          positionId: dto.positionId ?? undefined,
          salaryAmountMinor: dto.salaryAmountMinor ?? undefined,
          salaryCurrency: dto.salaryCurrency ?? undefined,
          salaryFrequency: dto.salaryFrequency ?? undefined,
          workHoursPerWeek: dto.workHoursPerWeek ?? undefined,
          notes: dto.notes ?? undefined,
          isActive: dto.isActive ?? undefined,
        },
      });
    });

    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.contract.updated',
      refType: 'employment_contract',
      refId: id,
      before: before as any,
      after: updated as any,
      ip: meta.ip,
      module: 'hr-payroll',
    });
    return updated;
  }

  async remove(companyId: string, employeeId: string, id: string, meta: AuditMeta) {
    const c = await this.findOne(companyId, employeeId, id);
    await this.prisma.employmentContract.delete({ where: { id } });
    await this.audit.record({
      companyId,
      actorId: meta.actorId,
      action: 'hr.contract.deleted',
      refType: 'employment_contract',
      refId: id,
      before: c as any,
      ip: meta.ip,
      module: 'hr-payroll',
    });
    return { message: `Contract ${id} deleted` };
  }

  private async assertEmployee(companyId: string, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`);
  }
  private async assertPosition(companyId: string, positionId: string) {
    const pos = await this.prisma.position.findFirst({ where: { id: positionId, companyId } });
    if (!pos) throw new BadRequestException(`Position ${positionId} not found`);
  }
}
