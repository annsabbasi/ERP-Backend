import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ProblemException } from '../../common/problem';
import { RedisService } from '../redis/redis.service';

// Redis-backed rate limits (§5.3.7, §5.3.8, §11.9): fixed windows per key, shared by every
// API instance. Responses carry RateLimit-Limit, RateLimit-Remaining and, when refused,
// Retry-After.

export type Limit = { name: string; max: number; windowSeconds: number };

export const LIMITS = {
  loginPerIp: { name: 'login-ip', max: 30, windowSeconds: 600 },
  mfaPerIp: { name: 'mfa-ip', max: 30, windowSeconds: 600 },
  refreshPerIp: { name: 'refresh-ip', max: 120, windowSeconds: 600 },
  forgotPerIp: { name: 'forgot-ip', max: 10, windowSeconds: 3600 },
  forgotPerEmail: { name: 'forgot-email', max: 3, windowSeconds: 3600 },
  linkPerIp: { name: 'link-ip', max: 20, windowSeconds: 3600 },
  stepUpPerSession: { name: 'step-up', max: 10, windowSeconds: 600 },
} satisfies Record<string, Limit>;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Counts one use; false when the limit is already used up. */
  async take(
    limit: Limit,
    subject: string,
  ): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
    const key = this.redis.key('rl', limit.name, subject);
    const [[, count], [, ttl]] = (await this.redis.client.multi().incr(key).ttl(key).exec()) as [
      [null, number],
      [null, number],
    ];
    if (ttl < 0) await this.redis.client.expire(key, limit.windowSeconds);
    const retryAfter = ttl > 0 ? ttl : limit.windowSeconds;
    return { ok: count <= limit.max, remaining: Math.max(0, limit.max - count), retryAfter };
  }

  /** Throws 429 rate_limited when the limit is used up; sets the headers either way. */
  async enforce(limit: Limit, subject: string, response?: Response): Promise<void> {
    const result = await this.take(limit, subject);
    response?.setHeader('RateLimit-Limit', String(limit.max));
    response?.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.ok) {
      response?.setHeader('Retry-After', String(result.retryAfter));
      throw new ProblemException('rate_limited', `Try again in ${result.retryAfter} seconds`);
    }
  }
}
