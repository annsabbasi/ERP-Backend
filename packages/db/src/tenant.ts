import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from './generated/prisma/client';

// Tenant isolation in the application layer (Part 10 §10.5.3, first of two layers; RLS in
// the database is the second). Every query and insert on a tenant-owned model gets the
// current tenant's id, and there is no tenant-owned access at all without a tenant context.

/** Models whose table carries tenant_id under RLS: every app.* table plus identity.invitations. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Membership',
  'Role',
  'RoleGrant',
  'MembershipRole',
  'MembershipException',
  'LegalEntity',
  'Branch',
  'Department',
  'Team',
  'TeamMember',
  'Position',
  'Setting',
  'AuditLog',
  'OutboxEvent',
  'ProcessedEvent',
  'TenantModuleState',
  'Invitation',
]);

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(`No tenant context for ${model}.${operation}: tenant-owned data needs one (fail closed)`);
    this.name = 'TenantContextMissingError';
  }
}

export class TenantMismatchError extends Error {
  constructor(model: string) {
    super(`${model}: tenant_id in the data does not match the current tenant`);
    this.name = 'TenantMismatchError';
  }
}

type TenantStore = { tenantId: string };
const storage = new AsyncLocalStorage<TenantStore>();

/** The tenant of the current unit of work, if any. */
export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

type Args = Record<string, unknown>;

function withTenantData(model: string, data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => withTenantData(model, row, tenantId));
  const row = (data ?? {}) as Args;
  if (row.tenantId !== undefined && row.tenantId !== tenantId) throw new TenantMismatchError(model);
  return { ...row, tenantId };
}

function scoped(where: unknown, tenantId: string): Args {
  return where ? { AND: [where, { tenantId }] } : { tenantId };
}

/** The operation's arguments with the tenant filled in. Exported for the unit tests. */
export function scopeArgs(model: string, operation: string, args: Args, tenantId: string): Args {
  switch (operation) {
    case 'create':
      return { ...args, data: withTenantData(model, args.data, tenantId) };
    case 'createMany':
    case 'createManyAndReturn':
      return { ...args, data: withTenantData(model, args.data, tenantId) };
    case 'upsert':
      return {
        ...args,
        where: { ...(args.where as Args), tenantId },
        create: withTenantData(model, args.create, tenantId),
      };
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'update':
    case 'delete':
      // Unique filters accept extra conditions, so a record of another tenant is "not found".
      return { ...args, where: { ...(args.where as Args), tenantId } };
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findMany':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'updateMany':
    case 'updateManyAndReturn':
    case 'deleteMany':
      return { ...args, where: scoped(args.where, tenantId) };
    default:
      throw new Error(`Tenant scoping does not know Prisma operation "${operation}" on ${model}`);
  }
}

/** Adds the tenant to every tenant-owned query and insert; refuses them with no tenant. */
export const tenantScope = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const tenantId = currentTenantId();
        if (!tenantId) throw new TenantContextMissingError(model, operation);
        return query(scopeArgs(model, operation, (args ?? {}) as Args, tenantId) as typeof args);
      },
    },
  },
});

export type TenantClient = ReturnType<typeof extendForTenants>;

export function extendForTenants(client: PrismaClient) {
  return client.$extends(tenantScope);
}

export type TenantTransaction = Parameters<Parameters<TenantClient['$transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` for one tenant in one transaction whose first statement is
 * set_config('app.tenant_id', …, true), so RLS sees the tenant and the setting ends with the
 * transaction (safe with a transaction-mode pooler, §10.5.3).
 */
export async function withTenant<T>(
  client: TenantClient,
  tenantId: string,
  work: (tx: TenantTransaction) => Promise<T>,
  options: { timeout?: number } = {},
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('withTenant needs a tenant id (uuid)');
  return storage.run({ tenantId }, () =>
    client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return work(tx);
      },
      { timeout: options.timeout ?? 15_000 },
    ),
  );
}
