import type { FieldError, ProblemCode } from '@erp/contracts';

/** Titles per code, shown when the thrower gives none (RFC 9457 `title`). */
const TITLES: Record<ProblemCode, string> = {
  feature_not_entitled: 'This feature is not part of your plan',
  permission_denied: 'You do not have permission to do this',
  not_found: 'Not found',
  validation_failed: 'Some fields are not valid',
  conflict: 'The record changed or already exists',
  limit_reached: 'A limit has been reached',
  period_closed: 'The period is closed',
  tenant_read_only: 'Your company account is read-only',
  approval_required: 'This needs approval first',
  rate_limited: 'Too many requests',
  unauthenticated: 'Sign-in required',
  internal_error: 'Something went wrong on our side',
};

/** HTTP status per code (Part 11 §11.9). */
export const STATUS_OF: Record<ProblemCode, number> = {
  feature_not_entitled: 403,
  permission_denied: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  limit_reached: 409,
  period_closed: 409,
  tenant_read_only: 403,
  approval_required: 409,
  rate_limited: 429,
  unauthenticated: 401,
  internal_error: 500,
};

export function titleOf(code: ProblemCode): string {
  return TITLES[code];
}

/** Throw this from anywhere in the API; the problem filter turns it into RFC 9457 JSON. */
export class ProblemException extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly options: { status?: number; errors?: FieldError[]; title?: string } = {},
  ) {
    super(detail ?? TITLES[code]);
    this.name = 'ProblemException';
  }

  get status(): number {
    return this.options.status ?? STATUS_OF[this.code];
  }
}
