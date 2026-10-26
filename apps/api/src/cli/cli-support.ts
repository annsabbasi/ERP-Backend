import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { assertLocalOnly, createPrismaClient, type PrismaClient } from '@erp/db';
import { loadLocalEnv } from '../load-env';

// Shared by the operator commands. They connect as the database owner (DIRECT_URL), because
// creating staff accounts is deliberately out of the API's reach (ADR 0008).

export function startCli<T extends ParseArgsOptionsConfig>(what: string, options: T) {
  loadLocalEnv();
  assertLocalOnly(process.env, what);
  const { values } = parseArgs({ options, strict: true, allowPositionals: false });
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error('DIRECT_URL (the database owner) is not set');
  return { values, db: createPrismaClient(url, { max: 2 }) };
}

export async function finish(db: PrismaClient, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
    // The mail queue's Redis connection must not keep the process alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  }
}
