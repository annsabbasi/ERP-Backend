import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@erp/db';
import { AccountStore, type Realm } from './account-store';

/**
 * The auth module's own connection, as app_auth (AUTH_DATABASE_URL, ADR 0008): the only one
 * that reaches sign-in secrets. Provided inside the auth module and never exported.
 */
@Injectable()
export class AuthDatabase implements OnModuleDestroy {
  private client?: PrismaClient;
  private readonly stores = new Map<Realm, AccountStore>();

  get db(): PrismaClient {
    if (!this.client) {
      const url = process.env.AUTH_DATABASE_URL;
      if (!url) throw new Error('AUTH_DATABASE_URL is not set');
      this.client = createPrismaClient(url, { max: 5 });
    }
    return this.client;
  }

  store(realm: Realm): AccountStore {
    let store = this.stores.get(realm);
    if (!store) {
      store = new AccountStore(this.db, realm);
      this.stores.set(realm, store);
    }
    return store;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
