import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from '@erp/contracts';
import type { Response } from 'express';
import { ReadinessService } from './readiness.service';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /** Liveness: the process is up. Needs no database or Redis. */
  @Get()
  check(): HealthResponse {
    return HealthResponseSchema.parse({ status: 'ok' });
  }

  /** Readiness: the database and Redis both answer. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const [db, redis] = await Promise.all([
      this.readiness.checkDatabase(),
      this.readiness.checkRedis(),
    ]);
    const status = db === 'ok' && redis === 'ok' ? 'ok' : 'error';
    if (status !== 'ok') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return ReadinessResponseSchema.parse({ status, db, redis });
  }
}
