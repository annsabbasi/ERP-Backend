import { Injectable } from '@nestjs/common';
import { MAX_PLATFORM_OWNERS, uuidv7, type StaffMember, type StaffRoleKey } from '@erp/contracts';
import { ProblemException } from '../../common/problem';
import { StaffAccountsService } from '../auth/staff-accounts.service';
import { normalizeEmail } from '../auth/sign-in.service';
import { PlatformAuditService, type Tx } from './platform-audit.service';
import { PlatformDatabase } from './platform-database.service';
import { StaffAccessService, type StaffContext } from './staff-access.service';

// Staff accounts (Part 03 §3.2, §3.19): the Platform Owner invites staff, changes their roles and
// deactivates them. Two Owners at most, never none. Invited staff get a one-time setup link and
// enrol MFA at their first sign-in (D5); deactivation ends their sessions at once.

@Injectable()
export class StaffService {
  constructor(
    private readonly platform: PlatformDatabase,
    private readonly audit: PlatformAuditService,
    private readonly access: StaffAccessService,
    private readonly accounts: StaffAccountsService,
  ) {}

  async list(): Promise<StaffMember[]> {
    const rows = await this.platform.db.staffUser.findMany({
      include: { roles: { select: { roleKey: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map(view);
  }

  async invite(
    staff: StaffContext,
    input: { email: string; name: string; roles: StaffRoleKey[]; reason: string },
  ): Promise<StaffMember> {
    const email = input.email.trim();
    const id = uuidv7();
    await this.platform.db.$transaction(async (tx) => {
      if (await tx.staffUser.findUnique({ where: { emailNormalized: normalizeEmail(email) } })) {
        throw new ProblemException('conflict', 'A staff account with this e-mail already exists');
      }
      if (input.roles.includes('platform_owner')) await this.assertOwnerRoom(tx, null);
      await tx.staffUser.create({
        data: {
          id,
          email,
          emailNormalized: normalizeEmail(email),
          name: input.name,
          status: 'invited',
        },
      });
      await tx.staffRoleAssignment.createMany({
        data: [...new Set(input.roles)].map((roleKey) => ({
          staffUserId: id,
          roleKey,
          assignedBy: staff.id,
        })),
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'staff.invited',
        targetType: 'staff_user',
        targetId: id,
        after: { email, name: input.name, roles: input.roles },
        reason: input.reason,
      });
    });
    await this.accounts.sendSetupLink({ id, email, name: input.name });
    return this.get(id);
  }

  /** A new setup link for someone who has not finished setting up (older links stop working). */
  async resendSetupLink(staff: StaffContext, id: string, reason: string): Promise<void> {
    const member = await this.get(id);
    if (member.status !== 'invited')
      throw new ProblemException('conflict', 'Only invited staff need a setup link');
    await this.platform.db.$transaction((tx) =>
      this.audit.write(tx, {
        actor: staff.id,
        action: 'staff.setup_link_sent',
        targetType: 'staff_user',
        targetId: id,
        reason,
      }),
    );
    await this.accounts.sendSetupLink({ id, email: member.email, name: member.name });
  }

  async changeRoles(
    staff: StaffContext,
    id: string,
    roles: StaffRoleKey[],
    reason: string,
  ): Promise<StaffMember> {
    const wanted = [...new Set(roles)];
    await this.platform.db.$transaction(async (tx) => {
      const member = await tx.staffUser.findUnique({ where: { id }, include: { roles: true } });
      if (!member || member.status === 'removed') throw new ProblemException('not_found');
      const before = member.roles.map((r) => r.roleKey).sort();
      const wasOwner = before.includes('platform_owner');
      const isOwner = wanted.includes('platform_owner');
      if (!wasOwner && isOwner) await this.assertOwnerRoom(tx, id);
      if (wasOwner && !isOwner) await this.assertAnotherOwner(tx, id);
      await tx.staffRoleAssignment.deleteMany({
        where: { staffUserId: id, roleKey: { notIn: wanted } },
      });
      await tx.staffRoleAssignment.createMany({
        data: wanted
          .filter((r) => !before.includes(r))
          .map((roleKey) => ({ staffUserId: id, roleKey, assignedBy: staff.id })),
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'staff.roles_changed',
        targetType: 'staff_user',
        targetId: id,
        before: { roles: before },
        after: { roles: [...wanted].sort() },
        reason,
      });
    });
    await this.access.forget(id);
    return this.get(id);
  }

  async deactivate(staff: StaffContext, id: string, reason: string): Promise<StaffMember> {
    if (id === staff.id) throw new ProblemException('conflict', 'You cannot deactivate yourself');
    await this.platform.db.$transaction(async (tx) => {
      const member = await tx.staffUser.findUnique({ where: { id }, include: { roles: true } });
      if (!member) throw new ProblemException('not_found');
      if (member.status === 'suspended' || member.status === 'removed') {
        throw new ProblemException('conflict', 'This account is already deactivated');
      }
      if (member.roles.some((r) => r.roleKey === 'platform_owner'))
        await this.assertAnotherOwner(tx, id);
      await tx.staffUser.update({
        where: { id },
        data: { status: 'suspended', version: { increment: 1 } },
      });
      await this.audit.write(tx, {
        actor: staff.id,
        action: 'staff.deactivated',
        targetType: 'staff_user',
        targetId: id,
        before: { status: member.status },
        after: { status: 'suspended' },
        reason,
      });
    });
    await this.access.forget(id);
    await this.accounts.endSessions(id, 'staff_deactivated');
    return this.get(id);
  }

  private async get(id: string): Promise<StaffMember> {
    const row = await this.platform.db.staffUser.findUnique({
      where: { id },
      include: { roles: { select: { roleKey: true } } },
    });
    if (!row) throw new ProblemException('not_found');
    return view(row);
  }

  /** Two Platform Owners at most (§3.2), counting invited ones. */
  private async assertOwnerRoom(tx: Tx, exceptId: string | null): Promise<void> {
    const owners = await tx.staffRoleAssignment.count({
      where: {
        roleKey: 'platform_owner',
        staffUserId: exceptId ? { not: exceptId } : undefined,
        staffUser: { status: { in: ['invited', 'active'] } },
      },
    });
    if (owners >= MAX_PLATFORM_OWNERS) {
      throw new ProblemException(
        'conflict',
        `There are already ${MAX_PLATFORM_OWNERS} Platform Owners`,
      );
    }
  }

  /** At least one active Platform Owner remains. */
  private async assertAnotherOwner(tx: Tx, leavingId: string): Promise<void> {
    const others = await tx.staffRoleAssignment.count({
      where: {
        roleKey: 'platform_owner',
        staffUserId: { not: leavingId },
        staffUser: { status: 'active' },
      },
    });
    if (others === 0)
      throw new ProblemException('conflict', 'At least one active Platform Owner must remain');
  }
}

function view(row: {
  id: string;
  email: string;
  name: string;
  status: string;
  lastSignInAt: Date | null;
  createdAt: Date;
  roles: { roleKey: string }[];
}): StaffMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status as StaffMember['status'],
    roles: row.roles.map((r) => r.roleKey as StaffRoleKey).sort(),
    last_sign_in_at: row.lastSignInAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
