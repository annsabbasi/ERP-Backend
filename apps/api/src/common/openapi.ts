import type { INestApplication } from '@nestjs/common';
import { ApiResponse, DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ProblemDetailsSchema } from '@erp/contracts';
import { z } from 'zod';

// OpenAPI from the running routes and the contracts' Zod schemas (Part 11 §11.9). The build
// writes apps/api/openapi.json; CI fails when it differs from the committed file.

type JsonSchema = Record<string, unknown>;

export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as JsonSchema;
  delete json.$schema;
  return json;
}

/** Documents a response with a contracts schema. */
export function ApiZodResponse(status: number, schema: z.ZodType, description = '') {
  return ApiResponse({ status, description, schema: jsonSchemaOf(schema) as never });
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ERP System API')
    .setDescription(
      'Company API under /api/v1 (Part 11 §11.10). Errors are RFC 9457 problem details ' +
        '(application/problem+json) with a stable code.',
    )
    .setVersion('1')
    // 3.1: the contracts' Zod schemas are JSON Schema 2020-12.
    .setOpenAPIVersion('3.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ProblemDetails: jsonSchemaOf(ProblemDetailsSchema) as never,
    },
  };
  return document;
}
