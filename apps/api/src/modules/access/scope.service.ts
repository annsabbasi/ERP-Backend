import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ProblemException } from '../../common/problem';
import { CTX } from '../../common/request-context';
import type { MemberAccess } from './compute-access';

// Gate 3 (Part 02 §2.12, Part 10 §10.7.4): which records a permission reaches. A resource names
// the fields its scopes look at; lists get a Prisma `where` fragment, single records a 404 when
// they lie outside every grant, so their existence is not revealed.

/** Prisma field names a resource's scopes compare against. Leave out what it does not have. */
export type ScopeFields = {
  /** Who created the record (a membership id): own scope, and team scope unless `owner` is set. */
  createdBy?: string;
  /** The membership the record is about (my leave, my payslips): own scope. */
  membership?: string;
  /** The record's owner for team scope, when it is not `createdBy`. */
  owner?: string;
  branch?: string;
  department?: string;
  legalEntity?: string;
  /** Assignment kind → field, for example { section_ids: 'sectionId' }. */
  assigned?: Readonly<Record<string, string>>;
};

export type ScopeWhere = Record<string, unknown>;

@Injectable()
export class ScopeService {
  constructor(private readonly cls: ClsService) {}

  /**
   * The condition for records this permission reaches: undefined for company scope (tenant
   * isolation still applies), otherwise an OR of the grants' conditions. A grant whose fields
   * the resource lacks adds nothing, so it reaches nothing (fail closed).
   */
  where(permission: string, fields: ScopeFields): ScopeWhere | undefined {
    const access = this.current();
    const grants = access.permissions[permission] ?? [];
    if (grants.some((g) => g.scope === 'company')) return undefined;
    const me = access.membershipId;
    const or: ScopeWhere[] = [];
    const within = (field: string | undefined, ids: string[] | undefined) => {
      if (field) or.push({ [field]: { in: ids ?? [] } });
    };
    for (const g of grants) {
      switch (g.scope) {
        case 'own':
          if (fields.createdBy) or.push({ [fields.createdBy]: me });
          if (fields.membership) or.push({ [fields.membership]: me });
          break;
        case 'team':
          within(fields.owner ?? fields.createdBy, g.values.member_ids);
          break;
        case 'branch':
          within(fields.branch, g.values.branch_ids);
          break;
        case 'department':
          within(fields.department, g.values.department_ids);
          break;
        case 'legal_entity':
          within(fields.legalEntity, g.values.legal_entity_ids);
          break;
        case 'assigned':
          for (const [kind, field] of Object.entries(fields.assigned ?? {}))
            within(field, g.values[kind]);
          break;
      }
    }
    return { OR: or };
  }

  /** One record through `find`, or not_found when it is missing or outside every grant. */
  async one<T>(
    permission: string,
    fields: ScopeFields,
    find: (scope: ScopeWhere | undefined) => Promise<T | null>,
  ): Promise<T> {
    const record = await find(this.where(permission, fields));
    if (!record) throw new ProblemException('not_found');
    return record;
  }

  private current(): MemberAccess {
    const access = this.cls.get<MemberAccess | undefined>(CTX.access);
    if (!access) throw new Error('ScopeService used outside a company request');
    return access;
  }
}
