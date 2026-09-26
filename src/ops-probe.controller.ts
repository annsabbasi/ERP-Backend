import { Controller, ForbiddenException, Get, Headers, Query } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './modules/prisma/prisma.service';

/**
 * TEMPORARY — measures database round-trip time from wherever this backend is
 * deployed, so the Vercel region move can be judged on real numbers. Returns
 * timings and the host region only, never data. Gated by a secret header whose
 * SHA-256 is below (the secret itself is not in the repo). Remove after use.
 */
const PROBE_SHA256 = '8ec7295d671b0b5e5aa69d81659524255b14819846d8b2e0f3650e1664d07550';

@Controller('ops')
export class OpsProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('db-rtt')
  async dbRtt(@Headers('x-ops-probe') token?: string, @Query('sleepMs') sleepMs?: string) {
    const given = Buffer.from(createHash('sha256').update(token ?? '').digest('hex'));
    if (!timingSafeEqual(given, Buffer.from(PROBE_SHA256))) throw new ForbiddenException();
    await this.prisma.$queryRawUnsafe('SELECT 1');
    const t: number[] = [];
    for (let i = 0; i < 20; i++) {
      const s = process.hrtime.bigint();
      await this.prisma.$queryRawUnsafe('SELECT 1');
      t.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    t.sort((a, b) => a - b);
    const r = (n: number) => Math.round(n * 10) / 10;
    return { region: process.env.VERCEL_REGION ?? null, heldMs: hold, samples: 20, minMs: r(t[0]), medianMs: r(t[10]), p90Ms: r(t[18]), maxMs: r(t[19]) };
  }
}
