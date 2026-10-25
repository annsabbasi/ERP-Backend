// Writes apps/api/openapi.json from the routes (Part 11 §11.9). Run by `pnpm build`; CI fails
// when the committed file differs, so every API change shows up in review of the commit.
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { buildOpenApiDocument } from './common/openapi';

async function main(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
  await app.init();
  const document = buildOpenApiDocument(app);
  writeFileSync(resolve(__dirname, '../openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
