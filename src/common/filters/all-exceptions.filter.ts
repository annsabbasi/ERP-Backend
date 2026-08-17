import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Catch-all exception filter.
 *
 * The previous filter was `@Catch(HttpException)`, so anything else — a Prisma
 * error, a transaction timeout, a null dereference — bypassed it and came back
 * as a bare `{"statusCode":500,"message":"Internal server error"}` with no
 * server-side context. That is undiagnosable on a serverless host, where you
 * cannot attach a debugger and the only signal is the response body.
 *
 * This filter keeps HttpException behaviour identical, translates the Prisma
 * errors that have an obvious HTTP meaning, and for genuinely unexpected
 * failures logs the full stack against a short reference that is also returned
 * to the caller — so a bug report carries something greppable.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, reference } = this.translate(exception, request);

    response.status(status).json({
      statusCode: status,
      message,
      ...(reference ? { reference } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private translate(exception: unknown, request: Request) {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      return {
        status: exception.getStatus(),
        message: typeof res === 'object' ? (res as { message?: unknown }).message : res,
        reference: undefined as string | undefined,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrisma(exception);
      if (mapped) {
        // Still worth logging: a constraint violation reaching the filter means
        // some service skipped its own validation.
        this.logger.warn(
          `${request.method} ${request.url} → ${mapped.status} (Prisma ${exception.code}) ${mapped.message}`,
        );
        return { ...mapped, reference: undefined };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.error(`${request.method} ${request.url} → Prisma validation error`, exception.message);
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'The request did not match the expected shape for this resource.',
        reference: undefined,
      };
    }

    const reference = randomUUID().slice(0, 8);
    const err = exception as Error;
    this.logger.error(
      `${request.method} ${request.url} → 500 [ref ${reference}] ${err?.message ?? String(exception)}`,
      err?.stack,
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: `Internal server error (reference ${reference})`,
      reference,
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError) {
    const target = (e.meta?.target as string[] | undefined)?.join(', ');
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: `A record with that ${target ?? 'value'} already exists.`,
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: `A referenced record does not exist (${String(e.meta?.field_name ?? 'unknown field')}).`,
        };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Record not found.' };
      case 'P2028':
        // Interactive transaction ran past its budget — usually latency, not logic.
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'The database transaction timed out. Please retry.',
        };
      case 'P1001':
      case 'P1002':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Cannot reach the database. Please retry shortly.',
        };
      default:
        return null;
    }
  }
}
