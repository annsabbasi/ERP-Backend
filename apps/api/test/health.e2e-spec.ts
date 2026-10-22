import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthResponseSchema } from '@erp/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 {"status":"ok"}', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(HealthResponseSchema.safeParse(response.body).success).toBe(true);
  });
});
