import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

type Check = 'ok' | 'error';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TIMEOUT_MS = 3000;

/**
 * Database and Redis checks for /health/ready. Connections are opened on the
 * first check, so /health and the tests never need either service.
 */
@Injectable()
export class ReadinessService implements OnModuleDestroy {
  private readonly logger = new Logger(ReadinessService.name);
  private pool?: Pool;
  private redis?: Redis;

  async checkDatabase(): Promise<Check> {
    const url = process.env.DATABASE_URL;
    if (!url) return 'error';
    try {
      this.pool ??= new Pool({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: TIMEOUT_MS,
        // Hosted databases use TLS with full certificate checks. DATABASE_CA_CERT
        // (PEM; line breaks may be written as \n) adds the provider's CA when it is
        // not in Node's built-in list, as with Supabase.
        ssl: LOCAL_HOSTS.has(new URL(url).hostname)
          ? false
          : { ca: process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n') || undefined },
      });
      await this.pool.query('SELECT 1');
      return 'ok';
    } catch (error) {
      this.logger.warn(`database check failed: ${(error as Error).message}`);
      return 'error';
    }
  }

  async checkRedis(): Promise<Check> {
    const url = process.env.REDIS_URL;
    if (!url) return 'error';
    try {
      this.redis ??= new Redis(url, {
        lazyConnect: true,
        connectTimeout: TIMEOUT_MS,
        maxRetriesPerRequest: 1,
        // Railway's private network is IPv6
        family: 0,
      });
      if (this.redis.status === 'wait') await this.redis.connect();
      return (await this.redis.ping()) === 'PONG' ? 'ok' : 'error';
    } catch (error) {
      this.logger.warn(`redis check failed: ${(error as Error).message}`);
      return 'error';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.pool?.end(), this.redis?.quit()]);
  }
}
