import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { withTenant } from '@erp/db';
import { ClsService } from 'nestjs-cls';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { CTX } from '../../common/request-context';
import { DatabaseService } from './database.service';

/**
 * Runs each request that has a tenant in one database transaction whose first statement is
 * set_config('app.tenant_id', …, true) (Part 10 §10.5.3). Handlers reach tenant data only
 * through DatabaseService.tx, so everything a request reads or writes is in that tenant and
 * commits or rolls back together. Requests without a tenant (sign-in, health, the console's
 * control-plane routes) pass through untouched.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly cls: ClsService,
    private readonly db: DatabaseService,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenantId = this.cls.get<string | undefined>(CTX.tenantId);
    if (!tenantId) return next.handle();
    return from(
      withTenant(this.db.client, tenantId, async (tx) => {
        this.cls.set(CTX.tx, tx);
        try {
          return await lastValueFrom(next.handle(), { defaultValue: undefined });
        } finally {
          this.cls.set(CTX.tx, undefined);
        }
      }),
    );
  }
}
