import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { assertLocalOnly } from '@erp/db';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { loadLocalEnv } from './load-env';

async function bootstrap() {
  loadLocalEnv();
  // Local-only mode (ADR 0007): refuse to start against a database or Redis elsewhere.
  assertLocalOnly(process.env, 'the API');
  const app = configureApp(await NestFactory.create(AppModule));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

bootstrap().catch((error: Error) => {
  Logger.error(error.message, 'Bootstrap');
  process.exit(1);
});
