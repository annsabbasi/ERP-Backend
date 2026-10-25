import type { INestApplication } from '@nestjs/common';
import { createTenantWithData, prepareTestDatabase, type TenantFixture } from '@erp/db/testing';
import { ProblemDetailsSchema, uuidv7 } from '@erp/contracts';
import pg from 'pg';
import request from 'supertest';
import { FeatureFlagsService } from '../src/modules/flags/feature-flags.service';
import { createTestApp } from './support/test-app';

// Stage 1 API conventions and tenant isolation at the HTTP level (Part 10 §10.5.5,
// Part 11 §11.9), against a database built from the migrations, connected as app_user.

let app: INestApplication;
let owner: pg.Client;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_api');
  process.env.DATABASE_URL = db.appUrl;
  owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
  for (const name of ['second', 'third']) {
    await owner.query(
      `INSERT INTO app.branches (id, tenant_id, legal_entity_id, name, code, type) VALUES ($1, $2, $3, $4, $5, 'outlet')`,
      [uuidv7(), a.tenantId, a.legalEntityId, `alpha ${name}`, name.toUpperCase()],
    );
  }
  app = await createTestApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

const server = () => app.getHttpServer();

describe('problem details (RFC 9457)', () => {
  it('answers an unknown route with a not_found problem and a correlation id', async () => {
    const response = await request(server()).get('/api/v1/no-such-route').expect(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(ProblemDetailsSchema.parse(response.body)).toMatchObject({
      status: 404,
      code: 'not_found',
      instance: '/api/v1/no-such-route',
    });
    expect(response.body.correlation_id).toBe(response.headers['x-correlation-id']);
  });

  it('keeps a well-formed correlation id sent by the caller', async () => {
    const response = await request(server())
      .get('/api/v1/no-such-route')
      .set('X-Correlation-Id', 'client-req-0001');
    expect(response.headers['x-correlation-id']).toBe('client-req-0001');
    expect(response.body.correlation_id).toBe('client-req-0001');
  });

  it('answers a validation failure with one error per field', async () => {
    const response = await request(server())
      .get('/api/v1/test/branches?limit=0')
      .set('X-Test-Tenant', a.tenantId)
      .expect(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
    expect(response.body.errors).toEqual([expect.objectContaining({ field: 'limit' })]);
  });

  it('never shows the message of an unexpected error', async () => {
    const response = await request(server()).get('/api/v1/test/misc/boom').expect(500);
    expect(response.body.code).toBe('internal_error');
    expect(JSON.stringify(response.body)).not.toContain('secret internal detail');
  });
});

describe('tenant isolation over HTTP', () => {
  it('lists only the caller’s tenant', async () => {
    const response = await request(server())
      .get('/api/v1/test/branches')
      .set('X-Test-Tenant', a.tenantId)
      .expect(200);
    expect(response.body.data.length).toBe(3);
    expect(new Set(response.body.data.map((x: { tenantId: string }) => x.tenantId))).toEqual(
      new Set([a.tenantId]),
    );
  });

  it('answers 404 for another tenant’s record, by read and by write', async () => {
    await request(server())
      .get(`/api/v1/test/branches/${b.branchId}`)
      .set('X-Test-Tenant', a.tenantId)
      .expect(404);
    await request(server())
      .patch(`/api/v1/test/branches/${b.branchId}`)
      .set('X-Test-Tenant', a.tenantId)
      .set('If-Match', '*')
      .send({ name: 'taken over' })
      .expect(404);
    const { rows } = await owner.query('SELECT name FROM app.branches WHERE id = $1', [b.branchId]);
    expect(rows[0].name).not.toBe('taken over');
  });

  it('refuses tenant data to a request with no tenant (fail closed)', async () => {
    const response = await request(server()).get('/api/v1/test/branches').expect(500);
    expect(response.body.code).toBe('internal_error');
  });
});

describe('cursor pagination', () => {
  it('pages through with next_cursor and stops at the end', async () => {
    const first = await request(server())
      .get('/api/v1/test/branches?limit=2')
      .set('X-Test-Tenant', a.tenantId)
      .expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.next_cursor).toEqual(expect.any(String));
    const second = await request(server())
      .get(`/api/v1/test/branches?limit=2&cursor=${first.body.next_cursor}`)
      .set('X-Test-Tenant', a.tenantId)
      .expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
  });

  it('refuses a cursor it did not make', async () => {
    const response = await request(server())
      .get('/api/v1/test/branches?cursor=not-a-cursor')
      .set('X-Test-Tenant', a.tenantId)
      .expect(400);
    expect(response.body.errors).toEqual([expect.objectContaining({ field: 'cursor' })]);
  });
});

describe('ETag and If-Match', () => {
  it('sends an ETag and refuses an update based on an old version', async () => {
    const read = await request(server())
      .get(`/api/v1/test/branches/${a.branchId}`)
      .set('X-Test-Tenant', a.tenantId)
      .expect(200);
    const etag = String(read.headers.etag);
    expect(etag).toBe('W/"1"');
    await request(server())
      .patch(`/api/v1/test/branches/${a.branchId}`)
      .set('X-Test-Tenant', a.tenantId)
      .send({ name: 'Gulberg' })
      .expect(428);
    const updated = await request(server())
      .patch(`/api/v1/test/branches/${a.branchId}`)
      .set('X-Test-Tenant', a.tenantId)
      .set('If-Match', etag)
      .send({ name: 'Gulberg' })
      .expect(200);
    expect(updated.headers.etag).toBe('W/"2"');
    const stale = await request(server())
      .patch(`/api/v1/test/branches/${a.branchId}`)
      .set('X-Test-Tenant', a.tenantId)
      .set('If-Match', etag)
      .send({ name: 'DHA' })
      .expect(412);
    expect(stale.body.code).toBe('conflict');
  });
});

describe('feature flags (Part 03 §3.15)', () => {
  afterEach(() => {
    delete process.env.FEATURE_FLAGS;
    app.get(FeatureFlagsService).reset();
  });

  it('hides an endpoint while its flag is off', async () => {
    const response = await request(server()).get('/api/v1/test/misc/hidden').expect(404);
    expect(response.body.code).toBe('not_found');
  });

  it('shows it when the flag is on in the database', async () => {
    await owner.query(
      `INSERT INTO platform.feature_flags (key, description, enabled) VALUES ('test.hidden', 'test', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`,
    );
    await request(server()).get('/api/v1/test/misc/hidden').expect(200);
    const flags = await request(server()).get('/api/v1/flags').expect(200);
    expect(flags.body.flags['test.hidden']).toBe(true);
    await owner.query(
      `UPDATE platform.feature_flags SET enabled = false WHERE key = 'test.hidden'`,
    );
  });

  it('lets FEATURE_FLAGS override the database', async () => {
    process.env.FEATURE_FLAGS = 'test.hidden=on,console.v2=off';
    await request(server()).get('/api/v1/test/misc/hidden').expect(200);
    const flags = await request(server()).get('/api/v1/flags').expect(200);
    expect(flags.body.flags).toMatchObject({ 'test.hidden': true, 'console.v2': false });
  });
});
