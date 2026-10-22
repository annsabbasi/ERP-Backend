// Runs before every test file. Tests use only the local Docker services and
// refuse to start against any other host, whatever the shell or .env says.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

for (const name of ['DATABASE_URL', 'REDIS_URL'] as const) {
  const host = new URL(process.env[name] as string).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run tests: ${name} points at "${host}". Tests may only use local Docker services.`,
    );
  }
}
