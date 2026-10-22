import { z } from 'zod';

/** Body of GET /api/v1/health. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const CheckResult = z.enum(['ok', 'error']);

/** Body of GET /api/v1/health/ready: 200 when every dependency answers, 503 otherwise. */
export const ReadinessResponseSchema = z.object({
  status: CheckResult,
  db: CheckResult,
  redis: CheckResult,
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
