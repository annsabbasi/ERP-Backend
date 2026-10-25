import type { Queue } from 'bullmq';

/** Scheduled system work: outbox dispatch, expiries, reminders, scheduled changes. */
export const SYSTEM_QUEUE = 'system';

/** Domain events published from the outbox (Part 10 §10.9.1); one job per event. */
export const EVENTS_QUEUE = 'events';

/** Repeatable jobs on the system queue (BullMQ job schedulers). */
export const SCHEDULES = {
  outboxDispatch: { id: 'outbox-dispatch', name: 'outbox.dispatch', every: 2_000 },
  // Expiries, reminders and scheduled entitlement changes plug in here from Stage 5 on.
  maintenanceTick: { id: 'maintenance-tick', name: 'maintenance.tick', every: 60_000 },
} as const;

/**
 * Registers the schedules on the system queue. Upserting by id means every worker can call
 * this on start and there is still one scheduler per schedule. Finished runs are trimmed:
 * the outbox schedule alone runs 43,200 times a day.
 */
export async function registerSchedules(system: Queue): Promise<void> {
  for (const schedule of Object.values(SCHEDULES)) {
    await system.upsertJobScheduler(
      schedule.id,
      { every: schedule.every },
      {
        name: schedule.name,
        opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 1_000 } },
      },
    );
  }
}
