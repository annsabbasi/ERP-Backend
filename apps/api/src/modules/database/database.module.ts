import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseService } from './database.service';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

@Global()
@Module({
  providers: [
    DatabaseService,
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
