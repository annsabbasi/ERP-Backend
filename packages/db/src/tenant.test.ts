import { describe, expect, it } from 'vitest';
import { scopeArgs, TenantMismatchError } from './tenant';

const T = '0192f000-0000-7000-8000-000000000001';
const OTHER = '0192f000-0000-7000-8000-000000000002';

describe('scopeArgs', () => {
  it('adds the tenant to the data of a create', () => {
    expect(scopeArgs('Team', 'create', { data: { name: 'A' } }, T)).toEqual({
      data: { name: 'A', tenantId: T },
    });
  });

  it('adds the tenant to every row of createMany', () => {
    expect(scopeArgs('Team', 'createMany', { data: [{ name: 'A' }, { name: 'B' }] }, T)).toEqual({
      data: [
        { name: 'A', tenantId: T },
        { name: 'B', tenantId: T },
      ],
    });
  });

  it('refuses data that names another tenant', () => {
    expect(() => scopeArgs('Team', 'create', { data: { tenantId: OTHER } }, T)).toThrow(
      TenantMismatchError,
    );
  });

  it('narrows a unique lookup, so another tenant’s id is not found', () => {
    expect(scopeArgs('Branch', 'findUnique', { where: { id: 'x' } }, T)).toEqual({
      where: { id: 'x', tenantId: T },
    });
    expect(scopeArgs('Branch', 'update', { where: { id: 'x' }, data: {} }, T)).toEqual({
      where: { id: 'x', tenantId: T },
      data: {},
    });
  });

  it('wraps list filters with AND', () => {
    expect(scopeArgs('Branch', 'findMany', { where: { status: 'active' } }, T)).toEqual({
      where: { AND: [{ status: 'active' }, { tenantId: T }] },
    });
    expect(scopeArgs('Branch', 'count', {}, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs('Branch', 'deleteMany', { where: undefined }, T)).toEqual({
      where: { tenantId: T },
    });
  });

  it('scopes both sides of an upsert', () => {
    expect(
      scopeArgs(
        'Setting',
        'upsert',
        { where: { id: 'x' }, create: { key: 'k' }, update: { value: 1 } },
        T,
      ),
    ).toEqual({
      where: { id: 'x', tenantId: T },
      create: { key: 'k', tenantId: T },
      update: { value: 1 },
    });
  });

  it('refuses an operation it does not know rather than let it through unscoped', () => {
    expect(() => scopeArgs('Branch', 'someNewOperation', {}, T)).toThrow('does not know');
  });
});
