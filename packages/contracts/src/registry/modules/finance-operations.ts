import { actions, defineModule, feature } from '../define';

// Part 06 §6.3–6.10. Every feature key is registered now (gap G3). Permissions are listed
// only where the specification already names them (Part 11 §11.7.2, the sensitive groups of
// Part 04 §4.9.4, and what the restaurant role templates of Part 08 §8.2.18 grant); each
// module's own stage adds the rest.

export const finance = defineModule({
  key: 'finance',
  name: 'Finance & Accounting',
  category: 'business',
  group: 'Finance',
  features: {
    core: feature({
      name: 'General Ledger',
      release: 'R1',
      alwaysOn: true,
      resources: {
        journal_entries: actions([
          'view',
          'create',
          'update',
          'submit',
          'approve',
          'post',
          'reverse',
          'export',
        ]),
        periods: actions(['view', 'configure'], { special: ['close', 'lock'] }),
      },
    }),
    receivables: feature({ name: 'Receivables', release: 'R1' }),
    payables: feature({
      name: 'Payables',
      release: 'R1',
      resources: {
        payments: actions(['view', 'create', 'approve', 'export'], { special: ['release'] }),
      },
    }),
    banking: feature({
      name: 'Banking',
      release: 'R1',
      // Sensitive: bank account numbers and IBANs (Part 04 §4.9.4).
      resources: { bank_details: actions(['view']) },
    }),
    cheques: feature({ name: 'Cheques & PDC', release: 'R1', requires: ['finance.banking'] }),
    cash: feature({ name: 'Cash & Petty Cash', release: 'R1' }),
    tax: feature({ name: 'Taxes', release: 'R1' }),
    multicurrency: feature({ name: 'Multi-currency', release: 'R2' }),
    dimensions: feature({ name: 'Dimensions', release: 'R1' }),
    budgets: feature({ name: 'Budgets', release: 'R1' }),
    assets: feature({ name: 'Fixed Assets', release: 'R2' }),
    close: feature({ name: 'Period Close', release: 'R1' }),
    consolidation: feature({
      name: 'Consolidation',
      release: 'later',
      requires: ['addon.multi_entity'],
    }),
    intercompany: feature({
      name: 'Intercompany',
      release: 'later',
      requires: ['addon.multi_entity'],
    }),
  },
});

export const sales = defineModule({
  key: 'sales',
  name: 'Sales & CRM',
  category: 'business',
  group: 'Sales',
  requires: ['finance.core'],
  features: {
    crm: feature({ name: 'CRM', release: 'R1' }),
    quotations: feature({ name: 'Quotations', release: 'R1' }),
    orders: feature({ name: 'Sales Orders', release: 'R1' }),
    deliveries: feature({
      name: 'Deliveries',
      release: 'R1',
      requires: ['sales.orders', 'inventory.stock'],
    }),
    invoicing: feature({
      name: 'Invoicing',
      release: 'R1',
      resources: {
        invoices: actions([
          'view',
          'create',
          'update',
          'post',
          'cancel',
          'print',
          'send',
          'export',
        ]),
      },
    }),
    pricing: feature({ name: 'Pricing & Promotions', release: 'R1' }),
    returns: feature({ name: 'Returns', release: 'R1', requires: ['sales.invoicing'] }),
    commissions: feature({ name: 'Commissions', release: 'R2' }),
    territories: feature({ name: 'Territories', release: 'R1' }),
    portal: feature({ name: 'Customer portal', release: 'later' }),
  },
});

export const purchasing = defineModule({
  key: 'purchasing',
  name: 'Purchasing',
  category: 'business',
  group: 'Operations',
  requires: ['finance.core'],
  features: {
    requisitions: feature({ name: 'Purchase Requisitions', release: 'R1' }),
    rfq: feature({ name: 'Quotations & Comparison', release: 'R2' }),
    orders: feature({ name: 'Purchase Orders', release: 'R1' }),
    receipts: feature({ name: 'Goods Receipts', release: 'R1', requires: ['purchasing.orders'] }),
    bills: feature({ name: 'Vendor Bills', release: 'R1' }),
    matching: feature({
      name: 'Three-way Match',
      release: 'R2',
      requires: ['purchasing.orders', 'purchasing.receipts', 'purchasing.bills'],
    }),
    landed_costs: feature({ name: 'Landed Costs', release: 'R2', requires: ['inventory.stock'] }),
    returns: feature({ name: 'Purchase Returns', release: 'R1' }),
    suppliers: feature({ name: 'Supplier Performance', release: 'later' }),
  },
});

export const inventory = defineModule({
  key: 'inventory',
  name: 'Inventory & Warehousing',
  category: 'business',
  group: 'Operations',
  features: {
    stock: feature({
      name: 'Stock',
      release: 'R1',
      resources: {
        items: actions(['view', 'create', 'update']),
        stock: actions(['view'], { special: ['receive', 'issue'] }),
      },
    }),
    transfers: feature({
      name: 'Transfers',
      release: 'R1',
      requires: ['inventory.stock'],
      resources: { transfers: actions(['view', 'create'], { special: ['dispatch', 'receive'] }) },
    }),
    adjustments: feature({
      name: 'Adjustments',
      release: 'R1',
      requires: ['inventory.stock'],
      resources: { adjustments: actions(['view', 'create', 'approve', 'post']) },
    }),
    counts: feature({
      name: 'Stock Counts',
      release: 'R1',
      requires: ['inventory.stock'],
      resources: { counts: actions(['view', 'create', 'post']) },
    }),
    valuation: feature({
      name: 'Valuation',
      release: 'R1',
      requires: ['inventory.stock'],
      // Sensitive: cost prices, margins and supplier prices (Part 04 §4.9.4).
      resources: { costs: actions(['view']) },
    }),
    reorder: feature({ name: 'Reorder', release: 'R1', requires: ['inventory.stock'] }),
    batches: feature({ name: 'Batches & Expiry', release: 'R2', requires: ['inventory.stock'] }),
    serials: feature({ name: 'Serial Numbers', release: 'R2', requires: ['inventory.stock'] }),
    variants: feature({ name: 'Variants', release: 'R2', requires: ['inventory.stock'] }),
    bins: feature({ name: 'Bin Locations', release: 'later', requires: ['inventory.stock'] }),
    barcodes: feature({ name: 'Barcodes & Labels', release: 'R1', requires: ['inventory.stock'] }),
    kits: feature({ name: 'Kits & Bundles', release: 'R2', requires: ['inventory.stock'] }),
  },
});

export const pos = defineModule({
  key: 'pos',
  name: 'Point of Sale',
  category: 'business',
  group: 'Sales',
  features: {
    core: feature({
      name: 'POS',
      release: 'R1',
      requires: ['finance.core'],
      limits: ['pos.terminals.max'],
      resources: {
        shifts: actions(['view'], { special: ['open', 'close', 'reopen', 'cash_movement'] }),
      },
    }),
    // Needs the country pack's fiscal adapter (§2.9.6); hidden where none exists.
    fiscalization: feature({ name: 'Fiscal Integration', release: 'R1', requires: ['pos.core'] }),
    promotions: feature({ name: 'Promotions', release: 'R2', requires: ['pos.core'] }),
    loyalty: feature({ name: 'Loyalty', release: 'R2', requires: ['pos.core'] }),
    customer_display: feature({ name: 'Customer Display', release: 'R2', requires: ['pos.core'] }),
    gift_cards: feature({ name: 'Gift Cards', release: 'later', requires: ['pos.core'] }),
  },
});

export const manufacturing = defineModule({
  key: 'manufacturing',
  name: 'Manufacturing',
  category: 'business',
  group: 'Operations',
  requires: ['inventory.stock'],
  features: {
    bom: feature({ name: 'Bills of Materials', release: 'later' }),
    routing: feature({ name: 'Work Centres & Routings', release: 'later' }),
    orders: feature({
      name: 'Production Orders',
      release: 'later',
      requires: ['manufacturing.bom'],
    }),
    mrp: feature({ name: 'Material Planning', release: 'later', requires: ['manufacturing.bom'] }),
    quality: feature({ name: 'Quality', release: 'later' }),
    subcontracting: feature({ name: 'Subcontracting', release: 'later' }),
  },
});

export const maintenance = defineModule({
  key: 'maintenance',
  name: 'Assets & Maintenance',
  category: 'business',
  group: 'Operations',
  features: {
    equipment: feature({ name: 'Equipment register', release: 'later' }),
    preventive: feature({
      name: 'Preventive maintenance',
      release: 'later',
      requires: ['maintenance.equipment'],
    }),
    work_orders: feature({
      name: 'Work orders',
      release: 'later',
      requires: ['maintenance.equipment'],
    }),
  },
});

export const analytics = defineModule({
  key: 'analytics',
  name: 'Analytics & Reports',
  category: 'business',
  group: 'Reports',
  features: {
    scheduled: feature({ name: 'Scheduled reports', release: 'R1' }),
    builder: feature({ name: 'Report builder', release: 'R2' }),
    dashboards: feature({ name: 'Dashboard builder', release: 'R2' }),
    warehouse: feature({ name: 'Data export to BI', release: 'later' }),
  },
});
