import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { Observable, catchError, concatMap, from, throwError } from 'rxjs';
import { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Answers a retried write from the response the first attempt produced.
 *
 * A client that loses its connection mid-request cannot tell whether the write
 * landed, and retrying is the only sensible thing it can do. The client sends
 * an `Idempotency-Key`; the first request claims it and records what it
 * returned, and a retry carrying the same key gets that recorded response back
 * instead of running again.
 *
 * What this is NOT: the thing that stops a payment being taken twice. That is
 * the unique index on (companyId, idempotencyKey) on the payment tables, which
 * fails a duplicate insert inside the same transaction as the write. The two
 * writes here — the key record and the business write — are in different
 * transactions, so there will always be a window between them where a crash
 * loses the key record. The database closes that window; this layer only makes
 * the retry pleasant rather than surprising.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger(IdempotencyInterceptor.name);

  /** Reads cannot double-apply, so there is nothing to protect. */
  private static readonly GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  /**
   * How long a claimed-but-unfinished key blocks its retries.
   *
   * A request holding a key cannot still be running after this: the longest
   * transaction budget in the codebase is 20s (TX_OPTIONS on the posting
   * paths), and a serverless invocation is killed well before a minute. Past
   * this point the original attempt is dead, and continuing to answer its
   * retries with "still in progress" would block the key permanently — the
   * failure the first version of this had no way out of.
   */
  private static readonly STALE_AFTER_MS = 60_000;

  /** How long a completed response stays replayable. */
  private static readonly RETENTION_MS = 24 * 60 * 60 * 1000;

  /**
   * Chance per claim of also clearing expired rows.
   *
   * The backend runs serverless, so an in-process scheduler would fire only on
   * whichever instance happens to be warm, if any. Sweeping opportunistically
   * on a fraction of requests keeps the table bounded without depending on a
   * scheduler that will not reliably run.
   */
  private static readonly SWEEP_PROBABILITY = 0.02;

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

    const endpoint = `${req.method} ${req.route?.path ?? req.url}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ body: req.body ?? null, params: req.params ?? null }))
      .digest('hex');
    const scope = { companyId, key, endpoint };

    return from(this.claim(scope, requestHash)).pipe(
      concatMap((replay) => {
        if (replay.kind === 'replay') return from(Promise.resolve(replay.body));

        return next.handle().pipe(
          // concatMap, not tap: the recording is awaited, so the response is
          // not sent until the replay record exists. Under tap the write was
          // fire-and-forget, and a fast retry could arrive to find the key
          // still IN_PROGRESS for a request that had already succeeded.
          concatMap((body) =>
            from(
              this.record(scope, context.switchToHttp().getResponse()?.statusCode ?? 200, body).then(
                () => body,
              ),
            ),
          ),
          catchError((err) =>
            // The key is NOT released. Releasing assumes the failure means
            // nothing was written, and a handler that throws after its
            // transaction committed breaks that assumption — the retry would
            // then write a second time, which is the exact duplicate this
            // exists to prevent. Recording the failure instead means the retry
            // is answered with the same error, and a client that wants to try
            // a corrected request uses a new key.
            from(
              this.record(
                scope,
                err instanceof HttpException ? err.getStatus() : 500,
                this.errorBody(err),
              ),
            ).pipe(concatMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  /**
   * Claims the key, or resolves to the stored response when this is a retry.
   */
  private async claim(
    scope: { companyId: string; key: string; endpoint: string },
    requestHash: string,
  ): Promise<{ kind: 'proceed' } | { kind: 'replay'; body: unknown }> {
    const expiresAt = new Date(Date.now() + IdempotencyInterceptor.RETENTION_MS);

    if (Math.random() < IdempotencyInterceptor.SWEEP_PROBABILITY) void this.sweep();

    try {
      await this.prisma.idempotencyKey.create({ data: { ...scope, requestHash, expiresAt } });
      return { kind: 'proceed' };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    }

    const where = {
      companyId_key_endpoint: {
        companyId: scope.companyId,
        key: scope.key,
        endpoint: scope.endpoint,
      },
    };
    const existing = await this.prisma.idempotencyKey.findUnique({ where });
    // Swept between the failed insert and this read; treat as a fresh request.
    if (!existing) return { kind: 'proceed' };

    if (existing.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        `Idempotency key "${scope.key}" was already used on this endpoint with a different ` +
          `request body. Use a new key for a new operation.`,
      );
    }

    if (existing.status === IdempotencyStatus.COMPLETED) {
      // A recorded failure is replayed as that failure, so a retry sees what
      // the first attempt saw rather than silently succeeding.
      if ((existing.statusCode ?? 200) >= 400) {
        throw new HttpException(
          (existing.response ?? { message: 'The original request failed.' }) as object,
          existing.statusCode ?? 500,
        );
      }
      return { kind: 'replay', body: existing.response };
    }

    const age = Date.now() - existing.createdAt.getTime();
    if (age < IdempotencyInterceptor.STALE_AFTER_MS) {
      throw new ConflictException(
        `A request with idempotency key "${scope.key}" is still in progress. ` +
          `Retry once it has finished.`,
      );
    }

    // The original attempt is dead. Take the claim over and run again. This is
    // safe for payments because the unique index on the payment row refuses a
    // duplicate under the same key regardless of what this record says.
    this.log.warn(
      `Reclaiming idempotency key "${scope.key}" on ${scope.endpoint} — the request that ` +
        `claimed it ${Math.round(age / 1000)}s ago never finished.`,
    );
    await this.prisma.idempotencyKey.update({
      where,
      data: { createdAt: new Date(), status: IdempotencyStatus.IN_PROGRESS, expiresAt },
    });
    return { kind: 'proceed' };
  }

  private async record(
    scope: { companyId: string; key: string; endpoint: string },
    statusCode: number,
    body: unknown,
  ) {
    try {
      await this.prisma.idempotencyKey.update({
        where: {
          companyId_key_endpoint: {
            companyId: scope.companyId,
            key: scope.key,
            endpoint: scope.endpoint,
          },
        },
        data: {
          status: IdempotencyStatus.COMPLETED,
          statusCode,
          response: (body ?? null) as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
    } catch (e) {
      // The request itself is already decided; failing to record its response
      // must not change that outcome. The row stays IN_PROGRESS and becomes
      // reclaimable after the staleness window, so this degrades to "the retry
      // runs again" rather than "the key is stuck forever".
      this.log.error(
        `Could not record the result for idempotency key "${scope.key}" on ${scope.endpoint}: ` +
          `${(e as Error).message}`,
      );
    }
  }

  /** Serialises a thrown error into something replayable. */
  private errorBody(err: unknown) {
    if (err instanceof HttpException) {
      const res = err.getResponse();
      return typeof res === 'string' ? { message: res } : res;
    }
    return { message: 'Internal server error' };
  }

  private async sweep() {
    try {
      const { count } = await this.prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count) this.log.log(`Swept ${count} expired idempotency key(s).`);
    } catch {
      // Housekeeping. A failed sweep costs nothing but a later retry.
    }
  }
}
