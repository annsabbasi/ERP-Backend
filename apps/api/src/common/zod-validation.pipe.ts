import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { fieldErrors } from './problem.filter';
import { ProblemException } from './problem';

/**
 * Validates a body, query or param against a contracts schema and returns the parsed value
 * (defaults applied, coercions done). Failures answer 400 validation_failed with one entry
 * per field (Part 11 §11.9).
 *
 *   @Query(new ZodValidationPipe(PageQuerySchema)) page: PageQuery
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ProblemException('validation_failed', undefined, {
        errors: fieldErrors(result.error),
      });
    }
    return result.data;
  }
}
