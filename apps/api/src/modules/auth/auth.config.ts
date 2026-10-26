import { isLocalOnly } from '@erp/db';

// Settings of the auth module, read once from the environment. Secrets (signing keys, the
// encryption key) are never logged; `pnpm local:up` writes local ones into .env.

export type AuthConfig = {
  /** Private signing keys as a JWK set; the first signs, all verify (rotation). */
  jwks: { keys: Record<string, unknown>[] } | null;
  /** 32 bytes: encrypts TOTP secrets and keys the recovery-code hashes. */
  encryptionKey: Buffer | null;
  /** Base URL of the API, used as the token issuer. */
  apiUrl: string;
  webUrl: string;
  consoleUrl: string;
  /** Browser origins allowed to use the refresh cookie (the CORS list). */
  origins: string[];
  /** D3: unset until the domain is chosen, so the cookie stays on the API host. */
  cookieDomain: string | undefined;
  accessTokenSeconds: number;
  sessionDays: number;
  staffIdleMinutes: number;
  /** Base of the progressive delay after failed sign-ins; 0 turns it off (tests). */
  failureDelayMs: number;
  /** Redis key prefix, so tests run beside a local API without touching its keys. */
  redisPrefix: string;
};

const DEFAULT_ORIGINS = 'http://localhost:5173,http://localhost:5174';

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const jwks = env.AUTH_JWKS ? (JSON.parse(env.AUTH_JWKS) as AuthConfig['jwks']) : null;
  const key = env.AUTH_ENCRYPTION_KEY ? Buffer.from(env.AUTH_ENCRYPTION_KEY, 'base64url') : null;
  if (key && key.length !== 32) throw new Error('AUTH_ENCRYPTION_KEY must be 32 bytes (base64url)');
  if (!isLocalOnly(env) && (!jwks || !key)) {
    throw new Error('AUTH_JWKS and AUTH_ENCRYPTION_KEY must be set outside local-only mode');
  }
  return {
    jwks,
    encryptionKey: key,
    apiUrl: (env.API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    webUrl: (env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    consoleUrl: (env.CONSOLE_URL ?? 'http://localhost:5174').replace(/\/$/, ''),
    origins: (env.CORS_ORIGINS ?? DEFAULT_ORIGINS)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    cookieDomain: env.AUTH_COOKIE_DOMAIN || undefined,
    accessTokenSeconds: 600,
    sessionDays: 30,
    staffIdleMinutes: 30,
    failureDelayMs: Number(env.AUTH_FAILURE_DELAY_MS ?? 500),
    redisPrefix: env.REDIS_KEY_PREFIX ?? 'erp:',
  };
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
