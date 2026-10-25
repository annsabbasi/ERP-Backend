import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FieldError, ProblemCode, ProblemDetails } from '@erp/contracts';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ZodError } from 'zod';
import { ProblemException, STATUS_OF, titleOf } from './problem';

const CODE_FOR_STATUS: Record<number, ProblemCode> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'permission_denied',
  404: 'not_found',
  409: 'conflict',
  412: 'conflict',
  422: 'validation_failed',
  429: 'rate_limited',
};

/** Prisma error codes that mean something to the caller. */
const PRISMA_CODES: Record<string, ProblemCode> = {
  P2025: 'not_found', // record not found (also: another tenant's record)
  P2002: 'conflict', // unique constraint
  P2034: 'conflict', // transaction conflict
};

export function fieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

/**
 * Every error leaves the API as application/problem+json (RFC 9457, Part 11 §11.9), with a
 * stable `code` and the correlation id to quote to support. Unexpected errors are logged
 * and answered as internal_error, without their message.
 */
@Catch()
@Injectable()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const problem = this.toProblem(exception, request);
    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed (${problem.correlation_id})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDetails {
    const base = (code: ProblemCode, status: number, detail?: string, errors?: FieldError[]) => ({
      type: `https://docs.erpsystem.app/problems/${code.replace(/_/g, '-')}`,
      title: titleOf(code),
      status,
      ...(detail ? { detail } : {}),
      instance: request.originalUrl,
      code,
      correlation_id: this.correlationId(),
      ...(errors?.length ? { errors } : {}),
    });

    if (exception instanceof ProblemException) {
      const p = base(exception.code, exception.status, exception.detail, exception.options.errors);
      return exception.options.title ? { ...p, title: exception.options.title } : p;
    }
    if (exception instanceof ZodError) {
      return base('validation_failed', 400, undefined, fieldErrors(exception));
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        CODE_FOR_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'validation_failed');
      const detail =
        status === 404 ? `No route or record at ${request.method} ${request.path}` : undefined;
      return base(code, status, detail);
    }
    const prismaCode = (exception as { code?: unknown } | null)?.code;
    if (typeof prismaCode === 'string' && PRISMA_CODES[prismaCode]) {
      const code = PRISMA_CODES[prismaCode];
      return base(code, STATUS_OF[code]);
    }
    return base('internal_error', 500);
  }

  private correlationId(): string | undefined {
    try {
      return this.cls.getId();
    } catch {
      return undefined;
    }
  }
}
