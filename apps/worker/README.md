# @erp/worker

Background job runner: a NestJS standalone application (no HTTP server) that processes BullMQ queues
on Redis (`REDIS_URL`). One queue for now: `system`. Logs `worker ready` once connected.
