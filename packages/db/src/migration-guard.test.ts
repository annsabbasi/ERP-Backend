import { describe, expect, it } from 'vitest';
import { assertLocalForDestructive, destructiveCommand } from './migration-guard';

const LOCAL = 'postgresql://erp:erp@localhost:5433/erp';
const HOSTED = 'postgresql://user:pass@db.example.com:5432/postgres';

describe('destructiveCommand', () => {
  it.each([
    [['migrate', 'dev'], 'migrate dev'],
    [['migrate', 'reset', '--force'], 'migrate reset'],
    [['--schema', 'x', 'db', 'push'], 'db push'],
  ])('finds %j', (argv, expected) => {
    expect(destructiveCommand(argv)).toBe(expected);
  });

  it.each([[['migrate', 'deploy']], [['validate']], [['generate']]])('ignores %j', (argv) => {
    expect(destructiveCommand(argv)).toBeUndefined();
  });
});

describe('assertLocalForDestructive', () => {
  it('allows a destructive command on localhost', () => {
    expect(() => assertLocalForDestructive(['migrate', 'dev'], LOCAL)).not.toThrow();
  });

  it('refuses a destructive command on any other host', () => {
    expect(() => assertLocalForDestructive(['migrate', 'reset'], HOSTED)).toThrow(
      'Refusing "prisma migrate reset": the database host is "db.example.com"',
    );
  });

  it('allows migrate deploy on any host', () => {
    expect(() => assertLocalForDestructive(['migrate', 'deploy'], HOSTED)).not.toThrow();
  });
});
