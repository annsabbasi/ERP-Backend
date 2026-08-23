import { ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * The request's `Idempotency-Key` header, if it sent one.
 *
 * Handed to services that write money so the key can be stored on the row
 * itself. The unique index on that column is what makes the write happen once;
 * the interceptor's replay record is a convenience layered on top and cannot
 * provide the guarantee on its own, because it commits in a separate
 * transaction.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const header = ctx.switchToHttp().getRequest().headers?.['idempotency-key'];
    return typeof header === 'string' && header.length > 0 ? header : undefined;
  },
);
