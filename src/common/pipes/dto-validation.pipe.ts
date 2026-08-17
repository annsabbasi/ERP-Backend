import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform, Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * Validates a request body against a DTO class supplied at construction time.
 *
 * The global ValidationPipe keys off the parameter's reflected metatype. Generic
 * controllers built by `TenantCrudController()` declare their body as a plain
 * object, so no metatype reaches the pipe and validation silently no-ops —
 * meaning `whitelist` / `forbidNonWhitelisted` would not apply either, and
 * arbitrary keys would reach Prisma. Passing the class explicitly restores the
 * same guarantees the hand-written controllers get.
 */
@Injectable()
export class DtoValidationPipe<T extends object> implements PipeTransform {
  constructor(
    private readonly dtoClass: Type<T>,
    private readonly options: { skipMissingProperties?: boolean } = {},
  ) {}

  async transform(value: unknown): Promise<T> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Request body must be a JSON object');
    }

    const instance = plainToInstance(this.dtoClass, value, {
      enableImplicitConversion: true,
    });

    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      skipMissingProperties: this.options.skipMissingProperties ?? false,
    });

    if (errors.length) {
      throw new BadRequestException(flatten(errors));
    }
    return instance;
  }
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      out.push(...Object.values(err.constraints).map((m) => m.replace(err.property, path)));
    }
    if (err.children?.length) out.push(...flatten(err.children, path));
  }
  return out;
}
