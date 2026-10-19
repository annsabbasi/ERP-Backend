import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Supabase's pooler can be slow to answer a first connection (a paused project
// waking up, or a brief drop on the way to ap-southeast-1). Prisma's default
// connect timeout is 5s, and a single miss used to take the whole process down
// with P1001 before any route could be served.
const CONNECT_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Database connected on attempt ${attempt}`);
        }
        return;
      } catch (error) {
        const reachability = (error as { errorCode?: string })?.errorCode === 'P1001';
        if (!reachability || attempt === CONNECT_ATTEMPTS) {
          if (reachability) {
            this.logger.error(
              `Database unreachable after ${CONNECT_ATTEMPTS} attempts. Check that the Supabase ` +
                'project is not paused and that DATABASE_URL points at a running pooler.',
            );
          }
          throw error;
        }
        const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Database unreachable (attempt ${attempt}/${CONNECT_ATTEMPTS}), retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
