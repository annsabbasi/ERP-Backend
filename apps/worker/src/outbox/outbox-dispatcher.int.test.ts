import { uuidv7 } from '@erp/contracts';
import {
  addOutboxEvent,
  createPrismaClient,
  extendForTenants,
  hostOf,
  LOCAL_HOSTS,
  runOnce,
  withTenant,
  type PrismaClient,
  type TenantClient,
} from '@erp/db';
import { createTenantWithData, prepareTestDatabase, type TenantFixture } from '@erp/db/testing';
import { Queue } from 'bullmq';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisConnection } from '../redis-connection';
import { OutboxDispatcher } from './outbox-dispatcher';

// The outbox path (Part 10 §10.9.1): written in the change's transaction as app_user,
// dispatched across tenants as app_ops, consumed at most once per consumer.

let owner: pg.Client;
let ops: PrismaClient;
let app: TenantClient;
let queue: Queue;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  const db = await prepareTestDatabase('erp_test_worker');
  owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();
  a = await createTenantWithData(owner, 'alpha');
  b = await createTenantWithData(owner, 'bravo');
  // The fixtures leave one waiting event per tenant; start from an empty outbox.
  await owner.query('UPDATE app.outbox SET dispatched_at = now()');
  ops = createPrismaClient(db.opsUrl, { max: 2 });
  app = extendForTenants(createPrismaClient(db.appUrl, { max: 2 }));
  // A queue of its own, so a running local worker never picks these jobs up.
  const redis = process.env.TEST_REDIS_URL ?? 'redis://localhost:6381';
  if (!LOCAL_HOSTS.has(hostOf(redis) ?? '')) throw new Error('TEST_REDIS_URL must be local');
  queue = new Queue('events', {
    connection: redisConnection(redis),
    prefix: `erp-test-${uuidv7()}`,
  });
}, 120_000);

afterAll(async () => {
  await queue?.obliterate({ force: true });
  await queue?.close();
  await ops?.$disconnect();
  await app?.$disconnect();
  await owner?.end();
});

describe('outbox', () => {
  it('stores an event in the same transaction as the change, or not at all', async () => {
    await expect(
      withTenant(app, a.tenantId, async (tx) => {
        await addOutboxEvent(tx, { type: 'core.branch.renamed', aggregateId: a.branchId });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM app.outbox WHERE type = 'core.branch.renamed'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('refuses an event name that is not module.entity.verb', async () => {
    await expect(
      withTenant(app, a.tenantId, (tx) => addOutboxEvent(tx, { type: 'renamed' })),
    ).rejects.toThrow('module.entity.verb');
  });

  it('publishes waiting events of every tenant once, with the event id as job id', async () => {
    await withTenant(app, a.tenantId, (tx) =>
      addOutboxEvent(tx, {
        type: 'core.member.invited',
        aggregateId: a.membershipId,
        payload: { n: 1 },
      }),
    );
    await withTenant(app, b.tenantId, (tx) =>
      addOutboxEvent(tx, {
        type: 'core.member.invited',
        aggregateId: b.membershipId,
        payload: { n: 2 },
      }),
    );
    const dispatcher = new OutboxDispatcher(ops, queue);
    expect(await dispatcher.dispatchBatch()).toBe(2);
    expect(await dispatcher.dispatchBatch()).toBe(0);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.data.tenantId))).toEqual(new Set([a.tenantId, b.tenantId]));
    for (const job of jobs) expect(job.id).toBe(job.data.eventId);
    const { rows } = await owner.query(
      'SELECT count(*)::int AS n FROM app.outbox WHERE dispatched_at IS NULL',
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('processed_events (idempotent consumers)', () => {
  it('runs a consumer once per event, however often the event arrives', async () => {
    const eventId = uuidv7();
    let runs = 0;
    const handle = () =>
      withTenant(app, a.tenantId, (tx) =>
        runOnce(tx, 'test.counter', eventId, async () => {
          runs++;
        }),
      );
    expect(await handle()).toEqual({ ran: true, result: undefined });
    expect(await handle()).toEqual({ ran: false });
    expect(runs).toBe(1);
  });

  it('lets a failed attempt run again', async () => {
    const eventId = uuidv7();
    await expect(
      withTenant(app, a.tenantId, (tx) =>
        runOnce(tx, 'test.flaky', eventId, async () => {
          throw new Error('handler failed');
        }),
      ),
    ).rejects.toThrow('handler failed');
    const retry = await withTenant(app, a.tenantId, (tx) =>
      runOnce(tx, 'test.flaky', eventId, async () => 'ok'),
    );
    expect(retry).toEqual({ ran: true, result: 'ok' });
  });

  it('keeps each consumer’s record separate', async () => {
    const eventId = uuidv7();
    const first = await withTenant(app, a.tenantId, (tx) =>
      runOnce(tx, 'test.one', eventId, async () => 1),
    );
    const second = await withTenant(app, a.tenantId, (tx) =>
      runOnce(tx, 'test.two', eventId, async () => 2),
    );
    expect([first.ran, second.ran]).toEqual([true, true]);
  });
});
