import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertLocalOnly, isLocalOnly, nonLocalUrls } from './local-only';

const LOCAL = {
  LOCAL_ONLY: '1',
  DATABASE_URL: 'postgresql://erp:erp@localhost:5433/erp?schema=platform',
  DIRECT_URL: 'postgresql://erp:erp@127.0.0.1:5433/erp?schema=platform',
  REDIS_URL: 'redis://[::1]:6381',
};
const LIVE_DB =
  'postgresql://user:secret-password@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';

describe('isLocalOnly', () => {
  it.each([undefined, '', '1', 'true', 'false', 'off', 'no', ' 1 '])('is on for %j', (value) => {
    expect(isLocalOnly({ LOCAL_ONLY: value })).toBe(true);
  });

  it.each(['0', ' 0 '])('is off only for LOCAL_ONLY=%j', (value) => {
    expect(isLocalOnly({ LOCAL_ONLY: value })).toBe(false);
  });

  it('is off with NODE_ENV=production, whatever LOCAL_ONLY says', () => {
    expect(isLocalOnly({ NODE_ENV: 'production', LOCAL_ONLY: '1' })).toBe(false);
    expect(isLocalOnly({ NODE_ENV: 'development' })).toBe(true);
  });
});

describe('nonLocalUrls', () => {
  it('accepts localhost, 127.0.0.1 and ::1', () => {
    expect(nonLocalUrls(LOCAL)).toEqual([]);
  });

  it('ignores settings that are not set', () => {
    expect(nonLocalUrls({ LOCAL_ONLY: '1', DATABASE_URL: '' })).toEqual([]);
  });

  it('lists every setting that points elsewhere, with its host only', () => {
    expect(
      nonLocalUrls({ ...LOCAL, DATABASE_URL: LIVE_DB, REDIS_URL: 'redis://10.0.0.5:6379' }),
    ).toEqual([
      { name: 'DATABASE_URL', host: 'aws-1-ap-southeast-1.pooler.supabase.com' },
      { name: 'REDIS_URL', host: '10.0.0.5' },
    ]);
  });

  it('treats a value that is not a URL as not local', () => {
    expect(nonLocalUrls({ DIRECT_URL: 'not a url' })).toEqual([
      { name: 'DIRECT_URL', host: 'not a valid URL' },
    ]);
  });
});

describe('assertLocalOnly', () => {
  it('passes when every URL is local', () => {
    expect(() => assertLocalOnly(LOCAL, 'the api')).not.toThrow();
  });

  it.each([
    'DATABASE_URL',
    'DIRECT_URL',
    'OPS_DATABASE_URL',
    'AUTH_DATABASE_URL',
    'PLATFORM_DATABASE_URL',
    'REDIS_URL',
  ])('refuses a non-local %s', (name) => {
    expect(() => assertLocalOnly({ ...LOCAL, [name]: LIVE_DB }, 'the api')).toThrow(
      `LOCAL_ONLY is on, so the api refuses to run: ${name} points at "aws-1-ap-southeast-1.pooler.supabase.com"`,
    );
  });

  it('never puts the URL or its password in the message', () => {
    expect(() => assertLocalOnly({ ...LOCAL, DATABASE_URL: LIVE_DB }, 'the api')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-password') }),
    );
  });

  it('guards even when LOCAL_ONLY is missing', () => {
    expect(() => assertLocalOnly({ DATABASE_URL: LIVE_DB }, 'the api')).toThrow('LOCAL_ONLY is on');
  });

  it('does nothing when switched off with LOCAL_ONLY=0', () => {
    expect(() =>
      assertLocalOnly({ LOCAL_ONLY: '0', DATABASE_URL: LIVE_DB }, 'the api'),
    ).not.toThrow();
  });
});

// prisma.config.ts runs the guard before every Prisma command. These run the real CLI.
describe('prisma.config.ts in local-only mode', () => {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

  function prisma(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [prismaCli, ...args], {
      cwd: packageDir,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
  }

  it('lets a command run when every URL is local', () => {
    const result = prisma(['validate'], LOCAL);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['validate', 'migrate deploy'])(
    'refuses "prisma %s" when DATABASE_URL is not local, before connecting',
    (command) => {
      const env = { ...LOCAL, DATABASE_URL: LIVE_DB, DIRECT_URL: LIVE_DB };
      const result = prisma(command.split(' '), env);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('LOCAL_ONLY is on');
      expect(result.stdout + result.stderr).not.toContain('secret-password');
    },
  );

  it('refuses when only REDIS_URL is not local', () => {
    const result = prisma(['validate'], { ...LOCAL, REDIS_URL: 'redis://cache.example.com:6379' });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('REDIS_URL points at "cache.example.com"');
  });
});
