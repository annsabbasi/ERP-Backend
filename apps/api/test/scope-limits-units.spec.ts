import type { ClsService } from 'nestjs-cls';
import type { MemberAccess } from '../src/modules/access/compute-access';
import { effectiveLimit } from '../src/modules/access/limits.service';
import { ScopeService } from '../src/modules/access/scope.service';

// Gate 3's Prisma conditions and the limit in force, without a database.

function scopeFor(permissions: MemberAccess['permissions']): ScopeService {
  const access = { membershipId: 'me', permissions } as unknown as MemberAccess;
  return new ScopeService({ get: () => access } as unknown as ClsService);
}

describe('ScopeService.where (§11.8)', () => {
  const fields = {
    createdBy: 'createdBy',
    branch: 'branchId',
    department: 'departmentId',
    assigned: { section_ids: 'sectionId', station_ids: 'stationId' },
  };

  it('puts no condition on company scope', () => {
    const scope = scopeFor({ 'x.y.view': [{ scope: 'company', values: {}, thresholds: {} }] });
    expect(scope.where('x.y.view', fields)).toBeUndefined();
  });

  it('ORs the conditions of every grant', () => {
    const scope = scopeFor({
      'x.y.view': [
        { scope: 'own', values: {}, thresholds: {} },
        { scope: 'branch', values: { branch_ids: ['b1'] }, thresholds: {} },
        { scope: 'assigned', values: { section_ids: ['s1'], station_ids: ['k1'] }, thresholds: {} },
        { scope: 'team', values: { member_ids: ['me', 'm2'] }, thresholds: {} },
      ],
    });
    expect(scope.where('x.y.view', fields)).toEqual({
      OR: [
        { createdBy: 'me' },
        { branchId: { in: ['b1'] } },
        { sectionId: { in: ['s1'] } },
        { stationId: { in: ['k1'] } },
        { createdBy: { in: ['me', 'm2'] } },
      ],
    });
  });

  it('reaches nothing when the resource lacks the scope’s field, or with no grant (fail closed)', () => {
    const scope = scopeFor({
      'x.y.view': [{ scope: 'legal_entity', values: { legal_entity_ids: ['e1'] }, thresholds: {} }],
    });
    expect(scope.where('x.y.view', fields)).toEqual({ OR: [] });
    expect(scope.where('x.z.view', fields)).toEqual({ OR: [] });
  });
});

describe('effectiveLimit (§2.11.1)', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const row = (source: string, value: number, validTo: Date | null = null) => ({
    source,
    value: BigInt(value),
    valid_to: validTo,
  });

  it('is unlimited when nothing is set', () => {
    expect(effectiveLimit([], now)).toBeNull();
  });

  it('takes the larger of plan and template, plus every add-on', () => {
    expect(effectiveLimit([row('plan', 20), row('template', 15), row('addon', 5)], now)).toBe(25);
    expect(effectiveLimit([row('addon', 3)], now)).toBe(3);
  });

  it('lets a manual override replace the rest until it ends', () => {
    const rows = [row('plan', 20), row('addon', 5), row('manual', 40, new Date('2026-11-01'))];
    expect(effectiveLimit(rows, now)).toBe(40);
    expect(effectiveLimit(rows, new Date('2026-11-02'))).toBe(25);
  });
});
