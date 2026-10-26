import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * The API's Redis connection (rate limits, MFA challenges), opened on first use so /health and
 * the OpenAPI build need no Redis. Keys carry REDIS_KEY_PREFIX, so tests never touch the keys
 * of a local API running beside them.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private redis?: Redis;
  readonly prefix = process.env.REDIS_KEY_PREFIX ?? 'erp:';

  get client(): Redis {
    if (!this.redis) {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error('REDIS_URL is not set');
      // Railway's private network is IPv6 (family 0 = either).
      this.redis = new Redis(url, { family: 0, maxRetriesPerRequest: 2, lazyConnect: false });
    }
    return this.redis;
  }

  key(...parts: string[]): string {
    return `${this.prefix}${parts.join(':')}`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
