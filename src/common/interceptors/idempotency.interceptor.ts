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
import { Reflector } from '@nestjs/core';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { Observable, catchError, concatMap, from, throwError } from 'rxjs';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { KEY_BOUND_WRITE } from '../decorators/key-bound-write.decorator';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers?.['idempotency-key'];
    const companyId = req.user?.companyId;
    const userId = req.user?.sub;

    if (
      !key ||
      typeof key !== 'string' ||
      !companyId ||
      !userId ||
      !IdempotencyInterceptor.GUARDED_METHODS.has(req.method)
    ) {
      return next.handle();
    }

    const endpoint = `${req.method} ${req.route?.path ?? req.url}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ body: req.body ?? null, params: req.params ?? null }))
      .digest('hex');
    const scope = { companyId, userId, key, endpoint };

    // X1. Reclaiming a dead claim means running the write a second time, which
    // is only safe where the database itself refuses the duplicate. Routes say
    // so with @KeyBoundWrite(); everything else is never re-run.
    const reclaimable =
      this.reflector.getAllAndOverride<boolean>(KEY_BOUND_WRITE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    return from(this.claim(scope, requestHash, reclaimable)).pipe(
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
    scope: { companyId: string; userId: string; key: string; endpoint: string },
    requestHash: string,
    reclaimable: boolean,
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
      companyId_userId_key_endpoint: {
        companyId: scope.companyId,
        userId: scope.userId,
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

    // The claim is dead, but re-running is only safe where the database will
    // refuse a duplicate write on its own. On every other route the honest
    // answer is that we cannot tell whether the original write landed, so the
    // caller is asked for a new key rather than being handed a second invoice,
    // a second document number and a second journal entry.
    if (!reclaimable) {
      throw new ConflictException(
        `A request with idempotency key "${scope.key}" did not complete, and this operation ` +
          `cannot be safely repeated under the same key - it may already have taken effect. ` +
          `Check whether it did, then retry with a new key if not.`,
      );
    }

    // X2. Read, judge, then write with nothing in between is the same shape as
    // the bug fixed in allocate(): two retries arriving after the window would
    // both read a stale row, both judge it reclaimable, and both proceed.
    // Putting the staleness test in the WHERE makes exactly one of them win,
    // and the loser sees zero rows updated.
    const staleBefore = new Date(Date.now() - IdempotencyInterceptor.STALE_AFTER_MS);
    const { count } = await this.prisma.idempotencyKey.updateMany({
      where: {
        companyId: scope.companyId,
        userId: scope.userId,
        key: scope.key,
        endpoint: scope.endpoint,
        status: IdempotencyStatus.IN_PROGRESS,
        createdAt: { lt: staleBefore },
      },
      data: { createdAt: new Date(), expiresAt },
    });
    if (count === 0) {
      throw new ConflictException(
        `A request with idempotency key "${scope.key}" is already being retried. ` +
          `Retry once that attempt has finished.`,
      );
    }

    this.log.warn(
      `Reclaiming idempotency key "${scope.key}" on ${scope.endpoint}: the request that ` +
        `claimed it ${Math.round(age / 1000)}s ago never finished.`,
    );
    return { kind: 'proceed' };
  }

  private async record(
    scope: { companyId: string; userId: string; key: string; endpoint: string },
    statusCode: number,
    body: unknown,
  ) {
    try {
      await this.prisma.idempotencyKey.update({
        where: {
          companyId_userId_key_endpoint: {
            companyId: scope.companyId,
            userId: scope.userId,
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
