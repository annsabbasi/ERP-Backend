import {
  createPrismaClient,
  extendForTenants,
  type PrismaClient,
  type TenantClient,
} from '@erp/db';

// The worker's two database connections (Part 10 §10.5.3).

/** app_ops (OPS_DATABASE_URL): BYPASSRLS, granted only what the cross-tenant jobs use (the outbox). */
export const OPS_DB = Symbol('OPS_DB');

/** app_user (DATABASE_URL): event handlers work inside one tenant, under RLS. */
export const APP_DB = Symbol('APP_DB');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const databaseProviders = [
  {
    provide: OPS_DB,
    useFactory: (): PrismaClient => createPrismaClient(required('OPS_DATABASE_URL'), { max: 2 }),
  },
  {
    provide: APP_DB,
    useFactory: (): TenantClient =>
      extendForTenants(createPrismaClient(required('DATABASE_URL'), { max: 5 })),
  },
];
