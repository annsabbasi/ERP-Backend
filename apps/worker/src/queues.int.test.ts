import { uuidv7 } from '@erp/contracts';
import { hostOf, LOCAL_HOSTS } from '@erp/db';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerSchedules, SCHEDULES } from './queues';
import { redisConnection } from './redis-connection';

let queue: Queue;

beforeAll(() => {
  const redis = process.env.TEST_REDIS_URL ?? 'redis://localhost:6381';
  if (!LOCAL_HOSTS.has(hostOf(redis) ?? '')) throw new Error('TEST_REDIS_URL must be local');
  // A key prefix of its own, so a running local worker never sees these schedules.
  queue = new Queue('system', {
    connection: redisConnection(redis),
    prefix: `erp-test-${uuidv7()}`,
  });
});

afterAll(async () => {
  await queue?.obliterate({ force: true });
  await queue?.close();
});

describe('system schedules', () => {
  it('registers one scheduler per schedule, however many workers start', async () => {
    await registerSchedules(queue);
    await registerSchedules(queue);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(
      Object.values(SCHEDULES)
        .map((s) => s.id)
        .sort(),
    );
    const outbox = await queue.getJobScheduler(SCHEDULES.outboxDispatch.id);
    expect(outbox).toMatchObject({ name: 'outbox.dispatch', every: 2_000 });
  });

  it('trims finished runs, so Redis does not grow with every tick', async () => {
    for (const schedule of Object.values(SCHEDULES)) {
      const scheduler = await queue.getJobScheduler(schedule.id);
      expect(scheduler?.template?.opts).toMatchObject({
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1_000 },
      });
    }
  });
});
