import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      success: true,
      message: 'ERP Backend API is running',
      version: '1.0.0',
      status: 'healthy',
      environment: process.env.NODE_ENV || 'development',
      // Module roots, not an exhaustive route list. `/docs` serves the full
      // OpenAPI surface (enable in production with ENABLE_SWAGGER=true).
      endpoints: {
        docs: '/docs',
        auth: '/api/v1/auth',
        users: '/api/v1/users',
        employees: '/api/v1/employees',
        departments: '/api/v1/departments',
        products: '/api/v1/products',
        inventory: '/api/v1/inventory',
        orders: '/api/v1/orders',
        invoices: '/api/v1/invoices',
        administration: '/api/v1/administration',
        financials: '/api/v1/financials',
        crm: '/api/v1/crm',
        documents: '/api/v1/documents',
        notifications: '/api/v1/notifications',
      },
    };
  }
}
