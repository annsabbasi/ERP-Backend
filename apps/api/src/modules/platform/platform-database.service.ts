import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@erp/db';

/**
 * The Platform Console's connection, as app_platform (PLATFORM_DATABASE_URL): control-plane
 * tables only (staff, catalogue, plans, templates, country packs, approvals, audit log), no
 * tenant data, no sign-in secrets. Opened on first use.
 */
@Injectable()
export class PlatformDatabase implements OnModuleDestroy {
  private client?: PrismaClient;

  get db(): PrismaClient {
    if (!this.client) {
      const url = process.env.PLATFORM_DATABASE_URL;
      if (!url) throw new Error('PLATFORM_DATABASE_URL is not set');
      this.client = createPrismaClient(url, { max: 5 });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
