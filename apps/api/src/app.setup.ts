import { RequestMethod, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { ProblemFilter } from './common/problem.filter';
import { appContextMiddleware } from './common/request-context';
import { PLATFORM_PREFIX } from './modules/auth/staff-auth.controller';

/** Every route lives under this prefix (§11.9). */
export const API_PREFIX = 'api/v1';

const DEFAULT_CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174';

/** Shared by main.ts, the OpenAPI build and the e2e tests, so all serve the same routes. */
export function configureApp<T extends INestApplication>(app: T): T {
  // Company routes under /api/v1; Platform Console routes name /api/platform/v1 themselves.
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [{ path: `${PLATFORM_PREFIX}/{*path}`, method: RequestMethod.ALL }],
  });
  app.use(appContextMiddleware());
  app.use(cookieParser());
  // Behind a proxy, TRUST_PROXY (hops) makes req.ip the client's address for rate limits.
  const trust = process.env.TRUST_PROXY;
  if (trust) (app as unknown as NestExpressApplication).set('trust proxy', Number(trust));
  const origins = (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    // The web app's refresh cookie: only these origins may send it.
    credentials: true,
    // An explicit list: browsers may not send X-ERP-Client, which marks the desktop main
    // process (QA finding F5).
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'If-Match', 'X-Correlation-Id'],
    exposedHeaders: [
      'X-Correlation-Id',
      'ETag',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'Retry-After',
      'X-Access-Version',
    ],
  });
  // Registered on the app, not as a provider, so unknown routes get problem details too.
  app.useGlobalFilters(app.get(ProblemFilter));
  app.enableShutdownHooks();
  return app;
}
