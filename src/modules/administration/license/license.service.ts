import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddOnType, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface LicenseComponentInput {
  code: string;
  name: string;
  totalCount: number;
}

/** A component with its live seat usage, as the Allocation tab shows it. */
export interface SeatCount {
  id: string;
  licenseId: string;
  code: string;
  name: string;
  totalCount: number;
  createdAt: Date;
  updatedAt: Date;
  used: number;
  available: number;
}

export interface LicenseAssignmentRow {
  id: string;
  companyId: string;
  licenseId: string;
  componentId: string;
  userId: string;
  assignedAt: Date;
  user: { id: string; name: string; email: string };
  component: { id: string; code: string; name: string };
}

export interface ImportLicenseInput {
  licenseKey: string;
  licenseServer?: string;
  port?: number;
  hardwareKey?: string;
  installationNumber?: string;
  systemNumber?: string;
  validFrom?: string;
  validTo?: string;
  importedFileName?: string;
  components?: LicenseComponentInput[];
}

/**
 * License Administration and the Add-On Identifier Generator.
 *
 * Seat counts are never stored. "Used" is counted from `license_assignments`
 * and "Available" is derived from it — a stored counter and the assignment rows
 * drift the first time an assignment is removed by a cascade, and then the
 * window shows seats that are free while the database says otherwise.
 */
@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  // ── License Administration ─────────────────────────────────────────────────

  /** Every license held by the company, newest import first. */
  async list(companyId: string) {
    return this.prisma.companyLicense.findMany({
      where: { companyId },
      orderBy: { importedAt: 'desc' },
      include: {
        components: { orderBy: { code: 'asc' } },
        _count: { select: { assignments: true } },
      },
    });
  }

  /**
   * The Allocation tab: the active license, its components with live used /
   * available counts, and every user with the seats they hold.
   */
  async allocation(companyId: string) {
    const license = await this.prisma.companyLicense.findFirst({
      where: { companyId, isActive: true },
      orderBy: { importedAt: 'desc' },
      include: { components: { orderBy: { code: 'asc' } } },
    });

    const users = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, roleType: true, isActive: true },
    });

    if (!license) {
      // No license imported yet is a normal state, not an error: the window
      // still lists the users so the operator can see who is waiting on seats.
      // The empty arrays carry their real element types so callers that reduce
      // over them (License Information) are not handed `never[]`.
      return {
        license: null,
        components: [] as SeatCount[],
        users,
        assignments: [] as LicenseAssignmentRow[],
      };
    }

    const assignments = await this.prisma.licenseAssignment.findMany({
      where: { companyId, licenseId: license.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        component: { select: { id: true, code: true, name: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });

    const usedByComponent = new Map<string, number>();
    for (const a of assignments) {
      usedByComponent.set(a.componentId, (usedByComponent.get(a.componentId) ?? 0) + 1);
    }

    const components = license.components.map((c) => {
      const used = usedByComponent.get(c.id) ?? 0;
      return { ...c, used, available: Math.max(0, c.totalCount - used) };
    });

    return { license, components, users, assignments };
  }

  /**
   * Imports a license file's contents.
   *
   * Re-importing the same key updates it in place and reconciles components
   * rather than creating a second license: a renewal is the same license with
   * new dates and counts, and two rows would make "the active license"
   * ambiguous exactly when seats are being counted against it.
   */
  async import(companyId: string, dto: ImportLicenseInput) {
    const key = dto.licenseKey?.trim();
    if (!key) throw new BadRequestException('A license key is required.');

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validFrom && validTo && validTo < validFrom) {
      throw new BadRequestException('The license end date is before its start date.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyLicense.findUnique({
        where: { companyId_licenseKey: { companyId, licenseKey: key } },
        include: { components: true },
      });

      const data = {
        licenseServer: dto.licenseServer ?? null,
        port: dto.port ?? 40000,
        hardwareKey: dto.hardwareKey ?? null,
        installationNumber: dto.installationNumber ?? null,
        systemNumber: dto.systemNumber ?? null,
        validFrom,
        validTo,
        importedFileName: dto.importedFileName ?? null,
        importedAt: new Date(),
        isActive: true,
      };

      const license = existing
        ? await tx.companyLicense.update({ where: { id: existing.id }, data })
        : await tx.companyLicense.create({ data: { companyId, licenseKey: key, ...data } });

      // Only one license can be the active one — otherwise `allocation()` picks
      // by import date and the answer changes under a re-import.
      await tx.companyLicense.updateMany({
        where: { companyId, id: { not: license.id } },
        data: { isActive: false },
      });

      for (const c of dto.components ?? []) {
        const code = c.code?.trim().toUpperCase();
        if (!code) continue;
        if (c.totalCount < 0) {
          throw new BadRequestException(`Component ${code} has a negative seat count.`);
        }

        const assigned = existing
          ? await tx.licenseAssignment.count({
              where: {
                licenseId: license.id,
                component: { code },
              },
            })
          : 0;

        // A renewal that cuts seats below what is already handed out would
        // leave users holding seats the license does not cover. Refusing is
        // the honest outcome: revoke the assignments first, then re-import.
        if (assigned > c.totalCount) {
          throw new ConflictException(
            `${code}: the imported license allows ${c.totalCount} seat(s) but ${assigned} ` +
              'are already assigned. Remove the surplus assignments and import again.',
          );
        }

        await tx.licenseComponent.upsert({
          where: { licenseId_code: { licenseId: license.id, code } },
          create: { licenseId: license.id, code, name: c.name || code, totalCount: c.totalCount },
          update: { name: c.name || code, totalCount: c.totalCount },
        });
      }

      await tx.supportUserLogEntry.create({
        data: {
          companyId,
          action: 'LICENSE_IMPORTED',
          detail: `License ${key} imported${dto.importedFileName ? ` from ${dto.importedFileName}` : ''}.`,
          metadata: { licenseId: license.id } as Prisma.InputJsonValue,
        },
      });

      return tx.companyLicense.findUniqueOrThrow({
        where: { id: license.id },
        include: { components: { orderBy: { code: 'asc' } } },
      });
    });
  }

  /** Hands a component seat to a user, refusing once the seats run out. */
  async assign(companyId: string, actorId: string, componentId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const component = await tx.licenseComponent.findFirst({
        where: { id: componentId, license: { companyId } },
        include: { license: { select: { id: true, isActive: true, validTo: true } } },
      });
      if (!component) throw new NotFoundException('License component not found.');
      if (!component.license.isActive) {
        throw new BadRequestException('That component belongs to a license that is no longer active.');
      }
      if (component.license.validTo && component.license.validTo < new Date()) {
        throw new BadRequestException('That license has expired; its seats cannot be assigned.');
      }

      const user = await tx.user.findFirst({
        where: { id: userId, companyId, deletedAt: null },
        select: { id: true, email: true },
      });
      if (!user) throw new NotFoundException('User not found in this company.');

      const already = await tx.licenseAssignment.findUnique({
        where: { componentId_userId: { componentId, userId } },
      });
      if (already) {
        throw new ConflictException(`${user.email} already holds a ${component.code} seat.`);
      }

      // Counted inside the transaction so two operators assigning the last seat
      // at once cannot both succeed.
      const used = await tx.licenseAssignment.count({ where: { componentId } });
      if (used >= component.totalCount) {
        throw new ConflictException(
          `All ${component.totalCount} ${component.code} seat(s) are in use. ` +
            'Free one or import a license with more seats.',
        );
      }

      const assignment = await tx.licenseAssignment.create({
        data: { companyId, licenseId: component.license.id, componentId, userId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          component: { select: { id: true, code: true, name: true } },
        },
      });

      await tx.supportUserLogEntry.create({
        data: {
          companyId,
          userId: actorId,
          action: 'LICENSE_SEAT_ASSIGNED',
          detail: `${component.code} assigned to ${user.email}.`,
        },
      });

      return assignment;
    });
  }

  /** Returns a seat to the pool. */
  async unassign(companyId: string, actorId: string, assignmentId: string) {
    const assignment = await this.prisma.licenseAssignment.findFirst({
      where: { id: assignmentId, companyId },
      include: {
        user: { select: { email: true } },
        component: { select: { code: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found.');

    await this.prisma.$transaction([
      this.prisma.licenseAssignment.delete({ where: { id: assignmentId } }),
      this.prisma.supportUserLogEntry.create({
        data: {
          companyId,
          userId: actorId,
          action: 'LICENSE_SEAT_RELEASED',
          detail: `${assignment.component.code} released from ${assignment.user.email}.`,
        },
      }),
    ]);

    return { id: assignmentId, message: 'Seat released' };
  }

  /** License Information: what is held, what is used, when it lapses. */
  async information(companyId: string) {
    const { license, components, assignments } = await this.allocation(companyId);
    const seats = components.reduce((n, c) => n + c.totalCount, 0);
    const used = assignments.length;

    return {
      license,
      totalSeats: seats,
      usedSeats: used,
      availableSeats: Math.max(0, seats - used),
      components,
      expiresAt: license?.validTo ?? null,
      daysRemaining: license?.validTo
        ? Math.ceil((license.validTo.getTime() - Date.now()) / 86_400_000)
        : null,
    };
  }

  // ── Add-On Identifier Generator ────────────────────────────────────────────

  /**
   * Generates a namespaced identifier for an add-on.
   *
   * The value is random rather than derived from the name: an identifier that
   * can be recomputed from public inputs is not an identifier, it is a label,
   * and two partners shipping an add-on of the same name would collide.
   */
  async generateAddOn(
    companyId: string,
    actorId: string,
    dto: { addOnName: string; addOnType?: AddOnType; partnerNamespace?: string },
  ) {
    const name = dto.addOnName?.trim();
    if (!name) throw new BadRequestException('An add-on name is required.');

    const type = dto.addOnType ?? AddOnType.DEVELOPMENT;
    const ns = (dto.partnerNamespace ?? 'ERP').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Retry rather than assume: the unique index is the real guard, and a
    // collision here is astronomically unlikely but not impossible.
    for (let attempt = 0; attempt < 5; attempt++) {
      const identifier = [
        ns.slice(0, 8) || 'ERP',
        type.slice(0, 3),
        randomBytes(8).toString('hex').toUpperCase(),
      ].join('-');

      const clash = await this.prisma.addOnIdentifier.findUnique({
        where: { companyId_identifier: { companyId, identifier } },
      });
      if (clash) continue;

      return this.prisma.addOnIdentifier.create({
        data: {
          companyId,
          addOnName: name,
          addOnType: type,
          partnerNamespace: dto.partnerNamespace ?? null,
          identifier,
          generatedById: actorId || null,
        },
        include: { generatedBy: { select: { id: true, name: true, email: true } } },
      });
    }

    throw new ConflictException('Could not generate a unique identifier. Please try again.');
  }

  listAddOns(companyId: string) {
    return this.prisma.addOnIdentifier.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: { generatedBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async removeAddOn(companyId: string, id: string) {
    const row = await this.prisma.addOnIdentifier.findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException('Add-on identifier not found.');
    await this.prisma.addOnIdentifier.delete({ where: { id } });
    return { id, message: 'Add-on identifier deleted' };
  }

  // ── Support User Log ───────────────────────────────────────────────────────

  listSupportLog(
    companyId: string,
    filters: { from?: Date; to?: Date; userId?: string; take?: number } = {},
  ) {
    return this.prisma.supportUserLogEntry.findMany({
      where: {
        companyId,
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.from || filters.to
          ? {
              occurredAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(filters.take ?? 200, 1000),
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  record(companyId: string, userId: string | null, action: string, detail?: string) {
    return this.prisma.supportUserLogEntry.create({
      data: { companyId, userId, action, detail: detail ?? null },
    });
  }
}
