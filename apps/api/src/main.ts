import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { loadLocalEnv } from './load-env';

async function bootstrap() {
  loadLocalEnv();
  const app = configureApp(await NestFactory.create(AppModule));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
