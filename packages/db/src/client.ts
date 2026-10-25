import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { LOCAL_HOSTS, hostOf } from './local-only';

export type { Prisma } from './generated/prisma/client';
export { PrismaClient };

/**
 * A Prisma client over node-postgres (Prisma 7 driver adapter). In hosted environments the
 * application URL goes through the connection pooler in transaction mode; RLS context is set
 * per transaction, so pooling is safe (Part 10 §10.5.3).
 */
export function createPrismaClient(url: string, options: { max?: number } = {}): PrismaClient {
  const connection = new URL(url);
  // `schema` is a Prisma URL parameter, not a Postgres one; every model names its schema.
  connection.searchParams.delete('schema');
  const local = LOCAL_HOSTS.has(hostOf(url) ?? '');
  const adapter = new PrismaPg({
    connectionString: connection.toString(),
    max: options.max ?? 10,
    // Hosted databases use TLS with full certificate checks; DATABASE_CA_CERT adds the
    // provider's CA when Node does not know it (PEM, line breaks may be written as \n).
    ssl: local ? false : { ca: process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n') || undefined },
  });
  return new PrismaClient({ adapter });
}
