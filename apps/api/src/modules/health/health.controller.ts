import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from '@erp/contracts';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiZodResponse } from '../../common/openapi';
import { Public } from '../auth/auth.guard';
import { ReadinessService } from './readiness.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /** Liveness: the process is up. Needs no database or Redis. */
  @Get()
  @ApiZodResponse(200, HealthResponseSchema, 'The process is up')
  check(): HealthResponse {
    return HealthResponseSchema.parse({ status: 'ok' });
  }

  /** Readiness: the database and Redis both answer. */
  @Get('ready')
  @ApiZodResponse(200, ReadinessResponseSchema, 'Database and Redis answer')
  @ApiZodResponse(503, ReadinessResponseSchema, 'Database or Redis does not answer')
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
