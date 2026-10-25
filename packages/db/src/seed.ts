// Seed for the local stack, run by `pnpm local:up` after `migrate deploy`. Each stage adds
// what its screens need (catalogue sync in Stage 1, the Platform Owner in Stage 2).
import { assertLocalOnly } from './local-only';

// Run from packages/db, like prisma.config.ts: the workspace .env holds the local URLs.
try {
  process.loadEnvFile('../../.env');
} catch {
  // no .env file: use the environment as it is
}

try {
  assertLocalOnly(process.env, 'the seed');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

console.log('seed: nothing to add yet');
