import { z } from 'zod';

// API conventions (Part 11 §11.9), shared by the API and its clients.

/** Stable error codes (§11.9). Clients branch on `code`, never on the message. */
export const PROBLEM_CODES = [
  'feature_not_entitled',
  'permission_denied',
  'not_found',
  'validation_failed',
  'conflict',
  'precondition_required',
  'precondition_failed',
  'limit_reached',
  'period_closed',
  'tenant_read_only',
  'approval_required',
  'rate_limited',
  'unauthenticated',
  'invalid_credentials',
  'mfa_invalid',
  'step_up_required',
  'link_invalid',
  'internal_error',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const FieldErrorSchema = z.object({
  /** Path of the field, for example "lines.2.amount". */
  field: z.string(),
  message: z.string(),
  /** Stable code of the broken rule when there is one, for example "length". */
  code: z.string().optional(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

/** RFC 9457 problem details, served as application/problem+json. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.enum(PROBLEM_CODES),
  /** Quote this to support (Part 10 §10.15). */
  correlation_id: z.string().optional(),
  errors: z.array(FieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Cursor pagination query: ?limit=50&cursor=… (§11.9). */
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** A page of results: { data, next_cursor } (§11.9). */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    next_cursor: z.string().nullable(),
  });
}
export type Page<T> = { data: T[]; next_cursor: string | null };

/** GET /api/v1/flags: release flags as the client sees them (Part 03 §3.15). */
export const FeatureFlagsResponseSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
});
export type FeatureFlagsResponse = z.infer<typeof FeatureFlagsResponseSchema>;
