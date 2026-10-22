import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadLocalEnv } from './load-env';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  loadLocalEnv();
  // Standalone application: no HTTP server, only queue processors (§10.3).
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

void bootstrap();
