import { uuidv7 } from '@erp/contracts';
import type { Request, Response } from 'express';
import type { ClsModuleOptions, ClsService } from 'nestjs-cls';

// Request context (nestjs-cls, Part 10 §10.5.3): the correlation id of every request, and
// from Stage 3 the tenant and membership taken from the access token. Never from a header.

export const CORRELATION_HEADER = 'x-correlation-id';

/** Keys stored in the request context. */
export const CTX = {
  tenantId: 'tenantId',
  membershipId: 'membershipId',
  tx: 'tx',
} as const;

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** A caller's correlation id is reused when it is well formed; otherwise a new one is made. */
export function correlationIdFor(request: Request): string {
  const given = request.headers[CORRELATION_HEADER];
  return typeof given === 'string' && SAFE_ID.test(given) ? given : uuidv7();
}

export const clsOptions: ClsModuleOptions = {
  global: true,
  middleware: {
    mount: true,
    generateId: true,
    idGenerator: (request: Request) => correlationIdFor(request),
    setup: (cls: ClsService, _request: Request, response: Response) => {
      response.setHeader('X-Correlation-Id', cls.getId());
    },
  },
};
