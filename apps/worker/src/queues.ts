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
