import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Common
import { TenantContextModule } from './common/context/tenant-context.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

// Audit (global so any module can inject AuditService)
import { AuditModule } from './modules/audit/audit.module';

// Workflow engine (global so any module can start workflows)
import { WorkflowsModule } from './modules/workflows/workflows.module';

// Notifications (global; depends on WorkflowsModule's action registry)
import { NotificationsModule } from './modules/notifications/notifications.module';

// Document Management
import { DocumentsModule } from './modules/documents/documents.module';

// Infrastructure
import { PrismaModule } from './modules/prisma/prisma.module';
import { SupabaseModule } from './modules/supabase/supabase.module';

// Core / Auth
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PermissionSetsModule } from './modules/permission-sets/permission-sets.module';

// Multi-tenant management
import { CompaniesModule } from './modules/companies/companies.module';
import { SystemModulesModule } from './modules/system-modules/system-modules.module';
import { RolesModule } from './modules/roles/roles.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { PlansModule } from './modules/plans/plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BillingModule } from './modules/billing/billing.module';

// Domain modules
import { EmployeesModule } from './modules/employees/employees.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { HrModule } from './modules/hr/hr.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),

    // Common (global)
    TenantContextModule,
    AuditModule,
    WorkflowsModule,
    NotificationsModule,

    // Infrastructure (global — available everywhere)
    PrismaModule,
    SupabaseModule,

    // Auth, Users & Authorization
    PermissionsModule,
    PermissionSetsModule,
    AuthModule,
    UsersModule,

    // Multi-tenant core
    PlansModule,
    SubscriptionsModule,
    TenancyModule,
    CompaniesModule,
    SystemModulesModule,
    RolesModule,
    BillingModule,
    DocumentsModule,

    // Domain
    EmployeesModule,
    DepartmentsModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
    InvoicesModule,
    HrModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global authentication & authorization. Routes opt out via @Public()
    // and gate themselves via @RequirePermission(...).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
