import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { Observable, from, switchMap, tap } from 'rxjs';
import { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Makes a retried write safe to send twice.
 *
 * A client that loses its connection mid-request cannot tell whether the write
 * landed. Retrying is the only sensible thing it can do, and without this that
 * retry posts the payment a second time. So: the client sends an
 * `Idempotency-Key` header, the first request claims that key, and a retry
 * carrying the same key is answered from the stored response rather than run
 * again.
 *
 * Opt-in per request, not blanket-applied. A caller that sends no key gets the
 * old behaviour, which keeps this out of the way of reads and of writes where
 * a duplicate is harmless. The routes that most want it are the ones that move
 * money — posting an invoice, recording a payment, reversing an entry.
 *
 * The claim is a unique insert on (companyId, key, endpoint), so two requests
 * racing with the same key resolve at the database rather than in application
 * logic: exactly one insert wins and the loser is told the operation is already
 * running.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  /** Reads cannot double-apply, so there is nothing to protect. */
  private static readonly GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers?.['idempotency-key'];
    const companyId = req.user?.companyId;

    if (
      !key ||
      typeof key !== 'string' ||
      !companyId ||
      !IdempotencyInterceptor.GUARDED_METHODS.has(req.method)
    ) {
      return next.handle();
    }

    // Route path, not the resolved URL: two different ids under the same route
    // are different operations, but the body hash already separates those, and
    // the route is what makes "same key, different endpoint" detectable.
    const endpoint = `${req.method} ${req.route?.path ?? req.url}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ body: req.body ?? null, params: req.params ?? null }))
      .digest('hex');

    return from(this.claim(companyId, key, endpoint, requestHash)).pipe(
      switchMap((replay) => {
        if (replay) return from(Promise.resolve(replay));

        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.complete(companyId, key, endpoint, context, body);
            },
            // A failed request releases its key. The caller is expected to fix
            // the request and try again, and holding the key would answer that
            // corrected retry with the original failure.
            error: () => {
              void this.release(companyId, key, endpoint);
            },
          }),
        );
      }),
    );
  }

  /**
   * Claims the key, or returns the stored response when this is a retry.
   * Returns null when the caller should go ahead and run the request.
   */
  private async claim(
    companyId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<unknown | null> {
    try {
      await this.prisma.idempotencyKey.create({
        data: { companyId, key, endpoint, requestHash },
      });
      return null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    }

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { companyId_key_endpoint: { companyId, key, endpoint } },
    });
    // Lost the race and the winner has since released the key — treat it as a
    // fresh request rather than failing the caller.
    if (!existing) return null;

    if (existing.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        `Idempotency key "${key}" was already used on this endpoint with a different request body. ` +
          `Use a new key for a new operation.`,
      );
    }
    if (existing.status === IdempotencyStatus.IN_PROGRESS) {
      throw new ConflictException(
        `A request with idempotency key "${key}" is still in progress. Retry once it has finished.`,
      );
    }
    return existing.response;
  }

  private async complete(
    companyId: string,
    key: string,
    endpoint: string,
    context: ExecutionContext,
    body: unknown,
  ) {
    try {
      await this.prisma.idempotencyKey.update({
        where: { companyId_key_endpoint: { companyId, key, endpoint } },
        data: {
          status: IdempotencyStatus.COMPLETED,
          statusCode: context.switchToHttp().getResponse()?.statusCode ?? 200,
          response: (body ?? null) as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
    } catch {
      // The request itself succeeded; failing to record the response only costs
      // this key its replay protection, and must not turn a good write into an
      // error the caller will retry.
    }
  }

  private async release(companyId: string, key: string, endpoint: string) {
    try {
      await this.prisma.idempotencyKey.delete({
        where: { companyId_key_endpoint: { companyId, key, endpoint } },
      });
    } catch {
      // Already gone, or the row was never claimed by this request.
    }
  }
}
