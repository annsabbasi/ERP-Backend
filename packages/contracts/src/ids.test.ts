import { describe, expect, it } from 'vitest';
import {
  generateTenantCode,
  randomTenantCode,
  slugProblem,
  SlugSchema,
  TENANT_CODE_PATTERN,
  UUID_V7_PATTERN,
  uuidv7,
} from './ids';

describe('uuidv7', () => {
  it('has version 7 and the RFC 9562 variant', () => {
    for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(UUID_V7_PATTERN);
  });

  it('starts with the time in milliseconds', () => {
    const now = Date.UTC(2026, 9, 25, 12, 0, 0);
    const id = uuidv7(now);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('sorts by creation time', () => {
    const ids = [1, 2, 3, 4].map((ms) => uuidv7(1_800_000_000_000 + ms));
    expect([...ids].sort()).toEqual(ids);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });
});

describe('tenant code', () => {
  it('is T- plus 6 Crockford Base32 characters without I, L, O and U', () => {
    for (let i = 0; i < 1000; i++) {
      const code = randomTenantCode();
      expect(code).toMatch(TENANT_CODE_PATTERN);
      expect(code.slice(2)).not.toMatch(/[ILOU]/);
    }
  });

  it('retries until a free code is found', async () => {
    const taken: string[] = [];
    let calls = 0;
    const code = await generateTenantCode(async (candidate) => {
      calls++;
      if (calls < 3) {
        taken.push(candidate);
        return true;
      }
      return false;
    });
    expect(calls).toBe(3);
    expect(taken).not.toContain(code);
  });

  it('gives up after the given number of attempts', async () => {
    await expect(generateTenantCode(async () => true, 5)).rejects.toThrow(
      'No free tenant code after 5 attempts',
    );
  });
});

describe('slug', () => {
  it.each(['al-naik', 'abc', 'school-2026', 'a'.repeat(40)])('accepts %s', (slug) => {
    expect(slugProblem(slug)).toBeUndefined();
    expect(SlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(['ab', 'a'.repeat(41), 'Al-Naik', '-alnaik', 'alnaik-', 'al_naik', 'al naik', 'ålnaik'])(
    'rejects the format of %j',
    (slug) => {
      expect(slugProblem(slug)).toBe('format');
    },
  );

  it.each(['www', 'api', 'console', 'admin', 'app', 'mail', 'status', 'help'])(
    'reserves %s',
    (slug) => {
      expect(slugProblem(slug)).toBe('reserved');
      expect(SlugSchema.safeParse(slug).success).toBe(false);
    },
  );
});
