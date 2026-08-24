import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';

/** The shape every user read returns. Declared once so the platform-scoped
 * readers cannot quietly diverge from the tenant-scoped ones. */
const USER_SELECT = {
  id: true, name: true, email: true, isActive: true, createdAt: true,
  roleType: true, departmentId: true,
  department: { select: { id: true, name: true } },
  userRoles: { select: { role: { select: { id: true, name: true } } } },
  userModules: { select: { module: { select: { id: true, name: true, slug: true } } } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Users who belong to no company: the platform operators.
   *
   * `findAll` filters on a concrete companyId, and in SQL a comparison against
   * NULL never matches, so these rows were excluded from every list for every
   * company — permanently invisible, with no endpoint that could show them.
   * They need their own read path rather than a loosened tenant filter: a
   * company user must keep seeing only their own tenant.
   */
  async findPlatformUsers() {
    return this.prisma.user.findMany({
      where: { companyId: null, deletedAt: null },
      select: { ...USER_SELECT, isSuperAdmin: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every user in the installation, each carrying the company it belongs to.
   *
   * The platform layer has no cross-company read path, which is the single gap
   * behind both "the Super Admin cannot see users" and "the Super Admin cannot
   * see an approval queue spanning tenants". This is that path; the approval
   * inbox is built on the same idea.
   */
  async findAllAcrossCompanies(search?: string) {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { email: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        ...USER_SELECT,
        isSuperAdmin: true,
        companyId: true,
        company: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ companyId: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findAll(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async create(dto: CreateUserDto, companyId: string) {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email, companyId } });
    if (existing) throw new BadRequestException('Email already in use in this company');

    if (dto.moduleIds?.length) {
      await this.assertModulesEnabledForCompany(companyId, dto.moduleIds);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        companyId,
        roleType: dto.roleType,
        departmentId: dto.departmentId
      },
      select: { id: true, name: true, email: true, isActive: true, createdAt: true },
    });

    if (dto.roleIds?.length) {
      await this.prisma.userRole.createMany({
        data: dto.roleIds.map(roleId => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      });
    }

    if (dto.moduleIds?.length) {
      await this.prisma.userModule.createMany({
        data: dto.moduleIds.map(moduleId => ({ userId: user.id, moduleId })),
        skipDuplicates: true,
      });
    }

    return this.findOne(user.id, companyId);
  }

  async update(id: string, dto: UpdateUserDto, companyId: string) {
    await this.findOne(id, companyId);
    const data: any = {};
    if (dto.name) data.name = dto.name;
    if (dto.email) data.email = dto.email;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 12);
    if (typeof dto.isActive === 'boolean') data.isActive = dto.isActive;
    if (dto.roleType) data.roleType = dto.roleType;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;

    const user = await this.prisma.user.update({
      where: { id },
      data,
    });

    if (dto.roleIds) {
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      if (dto.roleIds.length) {
        await this.prisma.userRole.createMany({
          data: dto.roleIds.map(roleId => ({ userId: id, roleId })),
          skipDuplicates: true,
        });
      }
    }

    if (dto.moduleIds) {
      if (dto.moduleIds.length) {
        await this.assertModulesEnabledForCompany(companyId, dto.moduleIds);
      }
      await this.prisma.userModule.deleteMany({ where: { userId: id } });
      if (dto.moduleIds.length) {
        await this.prisma.userModule.createMany({
          data: dto.moduleIds.map(moduleId => ({ userId: id, moduleId })),
          skipDuplicates: true,
        });
      }
    }

    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    return { message: `User ${id} deleted` };
  }

  private async assertModulesEnabledForCompany(companyId: string, moduleIds: string[]) {
    const enabled = await this.prisma.companyModule.findMany({
      where: { companyId, isEnabled: true, moduleId: { in: moduleIds } },
      select: { moduleId: true },
    });
    if (enabled.length !== new Set(moduleIds).size) {
      throw new BadRequestException('One or more modules are not enabled for this company');
    }
  }
}
