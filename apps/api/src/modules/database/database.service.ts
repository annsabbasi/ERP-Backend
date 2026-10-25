import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  extendForTenants,
  TenantContextMissingError,
  type PrismaClient,
  type TenantClient,
  type TenantTransaction,
} from '@erp/db';
import { ClsService } from 'nestjs-cls';
import { CTX } from '../../common/request-context';

/**
 * The API's database access, as app_user (DATABASE_URL): RLS applies to every app.* query.
 * Connections open on first use, so /health and the OpenAPI build need no database.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private base?: PrismaClient;
  private scoped?: TenantClient;

  constructor(private readonly cls: ClsService) {}

  /** Client for global data (catalogue, flags). Tenant-owned models refuse to work here. */
  get client(): TenantClient {
    if (!this.scoped) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set');
      this.base = createPrismaClient(url);
      this.scoped = extendForTenants(this.base);
    }
    return this.scoped;
  }

  /**
   * The current request's tenant transaction (opened by TenantTransactionInterceptor), the
   * only way to reach tenant-owned data. Throws when the request has no tenant.
   */
  get tx(): TenantTransaction {
    const tx = this.cls.get<TenantTransaction | undefined>(CTX.tx);
    if (!tx) throw new TenantContextMissingError('request', 'tx');
    return tx;
  }

  async onModuleDestroy(): Promise<void> {
    await this.base?.$disconnect();
  }
}
