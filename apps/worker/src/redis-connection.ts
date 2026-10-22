import type { ConnectionOptions } from 'bullmq';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/** BullMQ connection options from REDIS_URL (redis:// or rediss://). */
export function redisConnection(
  url = process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Railway's private network is IPv6
    family: 0,
  };
}

/** Host and port only, safe to log. */
export function redisTarget(url = process.env.REDIS_URL ?? DEFAULT_REDIS_URL): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || 6379}`;
}
