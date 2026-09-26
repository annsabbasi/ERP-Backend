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
/** Readable text for the CHECK constraints a user can actually run into. */
const CHECK_MESSAGES: Record<string, string> = {
  payroll_runs_regular_needs_period: 'A Regular payroll run needs a Pay Period.',
  payroll_runs_run_type_check: 'Run type must be Regular, Supplementary, Off-cycle or Bonus.',
  payroll_runs_status_check: 'That payroll run status is not allowed.',
  loan_recoveries_amount_positive: 'A loan recovery must be a positive amount.',
  loan_recoveries_source_check: 'A loan recovery must come from payroll or a payment.',
  loan_recoveries_payroll_has_run: 'A payroll recovery must name its payroll run.',
};

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
        const line = `${request.method} ${request.url} → ${mapped.status} (Prisma ${exception.code}) ${mapped.message}`;
        if ((mapped as { log?: string }).log === 'error') this.logger.error(line);
        else this.logger.warn(line);
        return { status: mapped.status, message: mapped.message, reference: undefined };
      }
    }

    // Raised by the loan_recoveries_guard trigger; the services translate it
    // with context, this catches any path that did not.
    if ((exception as Error)?.message?.includes('LOAN_OVER_RECOVERY')) {
      this.logger.warn(`${request.method} ${request.url} → 409 loan over-recovery refused by the database`);
      return {
        status: HttpStatus.CONFLICT,
        message: 'That loan or advance installment has already been recovered.',
        reference: undefined,
      };
    }

    const dbRule = this.fromDatabaseRule(exception);
    if (dbRule) {
      this.logger.warn(`${request.method} ${request.url} → ${dbRule.status} (database rule) ${dbRule.message}`);
      return { ...dbRule, reference: undefined };
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

  /**
   * A refusal raised inside Postgres — a CHECK constraint, or one of our
   * triggers — reaches Prisma as a raw error (UnknownRequestError, or P2010 on
   * a raw query) with no Prisma code the switch below knows. Left alone it was
   * an anonymous 500, which is exactly how the original Payroll Process bug
   * presented. Triggers tag their messages `ERP_RULE:`; those are written for a
   * person and become a 409. A CHECK becomes a 400 naming the rule.
   */
  private fromDatabaseRule(exception: unknown): { status: number; message: string } | null {
    const text = exception instanceof Error ? exception.message : '';
    if (!text) return null;
    const rule = /ERP_RULE:\s*(.+?)(?:\\"|"|\n|$)/.exec(text);
    if (rule) {
      const message = rule[1].replace(/^LOAN_OVER_RECOVERY\s*[—-]\s*/, 'Already recovered: ').trim();
      return { status: HttpStatus.CONFLICT, message };
    }
    // The ledger guards (erp_journal_entry_guard / _line_guard) refuse with
    // restrict_violation and a message already written for a person. Prisma
    // reports it either as `code: "23001", message: "…"` (query engine) or as
    // "Code: `23001`. Message: `…`" (raw query, P2010).
    const pg =
      /code:\s*\\?"(\w{5})\\?",\s*message:\s*\\?"(.+?)\\?",\s*severity/.exec(text) ??
      /Code:\s*`(\w{5})`\.\s*Message:\s*`(.+?)`/.exec(text);
    if (pg && pg[1] === '23001') {
      return { status: HttpStatus.CONFLICT, message: pg[2].replace(/^ERROR:\s*/, '') };
    }
    const check = /violates check constraint \\?"([A-Za-z0-9_]+)\\?"/.exec(text);
    if (check || /\b23514\b/.test(text)) {
      const name = check?.[1] ?? '';
      return { status: HttpStatus.BAD_REQUEST, message: CHECK_MESSAGES[name] ?? `This change breaks a data rule${name ? ` (${name})` : ''}.` };
    }
    return null;
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
      case 'P2021':
      case 'P2022':
        // The code expects a table/column the database does not have: a
        // migration was committed but never applied. This is exactly what made
        // Payroll Process "Add" fail with an anonymous 500 — say so plainly.
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message:
            `The database schema is behind the application (missing ${String(e.meta?.table ?? e.meta?.column ?? 'object')}). ` +
            'An administrator needs to run the pending database migrations.',
          log: 'error' as const,
        };
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
