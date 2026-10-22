import { resolve } from 'node:path';

/**
 * Local development reads the workspace .env. Hosted services set real
 * environment variables, and existing variables are never overwritten.
 */
export function loadLocalEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  try {
    process.loadEnvFile(resolve(__dirname, '../../../.env'));
  } catch {
    // no .env file: use the environment as it is
  }
}
