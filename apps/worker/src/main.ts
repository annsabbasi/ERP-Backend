import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { assertLocalOnly } from '@erp/db';
import { loadLocalEnv } from './load-env';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  loadLocalEnv();
  // Local-only mode (ADR 0007): refuse to start against a database or Redis elsewhere.
  assertLocalOnly(process.env, 'the worker');
  // Standalone application: no HTTP server, only queue processors (§10.3).
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

bootstrap().catch((error: Error) => {
  Logger.error(error.message, 'Bootstrap');
  process.exit(1);
});
