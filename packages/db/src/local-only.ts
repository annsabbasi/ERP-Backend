// Local-only mode (docs/adr/0007-local-only-until-go-live.md). Until go-live nothing may
// connect to a database or Redis that is not on this machine: the api, the worker, the seed
// and every Prisma command call assertLocalOnly before they connect.

/** Host names that count as this machine. URL parsing keeps IPv6 hosts in brackets. */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** The connection settings the guard checks. */
export const GUARDED_URLS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'OPS_DATABASE_URL',
  'AUTH_DATABASE_URL',
  'REDIS_URL',
] as const;

export type GuardedUrl = (typeof GUARDED_URLS)[number];

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The guard is on unless switched off on purpose: only LOCAL_ONLY=0 or NODE_ENV=production
 * turns it off, so a missing or misspelt line can never disable it.
 */
export function isLocalOnly(env: Env): boolean {
  if (env.NODE_ENV?.trim() === 'production') return false;
  return env.LOCAL_ONLY?.trim() !== '0';
}

/** The host of a connection URL; undefined when the value is not a URL. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Every guarded setting that is present and does not point at this machine. */
export function nonLocalUrls(env: Env): { name: GuardedUrl; host: string }[] {
  const found: { name: GuardedUrl; host: string }[] = [];
  for (const name of GUARDED_URLS) {
    const value = env[name]?.trim();
    if (!value) continue;
    const host = hostOf(value);
    if (!host || !LOCAL_HOSTS.has(host)) found.push({ name, host: host ?? 'not a valid URL' });
  }
  return found;
}

/**
 * Throws when the guard is on and a guarded URL points elsewhere. The message names
 * the setting and its host only, never the URL, so no password reaches a log.
 */
export function assertLocalOnly(env: Env, what: string): void {
  if (!isLocalOnly(env)) return;
  const found = nonLocalUrls(env);
  if (found.length === 0) return;
  const list = found.map(({ name, host }) => `${name} points at "${host}"`).join(', ');
  throw new Error(
    `LOCAL_ONLY is on, so ${what} refuses to run: ${list}. ` +
      'Only localhost, 127.0.0.1 and ::1 are allowed (docs/adr/0007-local-only-until-go-live.md).',
  );
}
