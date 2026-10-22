import type { INestApplication } from '@nestjs/common';

/** Every route lives under this prefix (§11.9). */
export const API_PREFIX = 'api/v1';

const DEFAULT_CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174';

/** Shared by main.ts and the e2e tests, so both serve the same routes. */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix(API_PREFIX);
  const origins = (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins });
  app.enableShutdownHooks();
  return app;
}
