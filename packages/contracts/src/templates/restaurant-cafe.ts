import { COMPANY_ROLES } from './company-roles';
import { buildTemplate, role } from './define';

// Restaurant & Café 1.0 (Part 02 §2.10.1, Part 08 §8.2). Role templates follow the matrix of
// Part 08 §8.2.18 (V view · C create · U update · A approve · S special; B branch, A assigned,
// O own), limited to what this template entitles (delivery and reservations are Release 2).

const MENU_VIEW: [string, string[], 'branch'][] = [
  ['restaurant.menu_categories', ['view'], 'branch'],
  ['restaurant.menu_items', ['view'], 'branch'],
  ['restaurant.modifier_groups', ['view'], 'branch'],
  ['restaurant.combos', ['view'], 'branch'],
];

const OUTLET_MANAGER = role(
  'outlet_manager',
  'Outlet Manager',
  'آؤٹ لیٹ مینیجر',
  'Runs one outlet: floor, menu availability, orders, voids, bills, discounts up to 30%, shifts.',
  [
    ['restaurant.floors', ['view', 'create', 'update'], 'branch'],
    ['restaurant.sections', ['view', 'create', 'update', 'assign'], 'branch'],
    [
      'restaurant.tables',
      ['view', 'create', 'update', 'seat', 'transfer', 'merge', 'mark_clean'],
      'branch',
    ],
    ['restaurant.menu_categories', ['view', 'update'], 'branch'],
    ['restaurant.menu_items', ['view', 'update', 'mark_unavailable'], 'branch'],
    ['restaurant.modifier_groups', ['view', 'update'], 'branch'],
    ['restaurant.combos', ['view', 'update'], 'branch'],
    [
      'restaurant.orders',
      ['view', 'create', 'update', 'send_to_kitchen', 'transfer', 'complimentary'],
      'branch',
    ],
    ['restaurant.voids', ['view', 'approve'], 'branch'],
    ['restaurant.kds_tickets', ['view'], 'branch'],
    ['restaurant.stations', ['view'], 'branch'],
    [
      'restaurant.bills',
      [
        'view',
        'create',
        'update',
        'split',
        'merge',
        'discount',
        'reprint',
        'refund',
        'request',
        'complimentary',
      ],
      'branch',
    ],
    ['restaurant.payments', ['view', 'create'], 'branch'],
    ['restaurant.discounts', ['view', 'create', 'approve'], 'branch', { max_discount_pct: 30 }],
    ['pos.shifts', ['view', 'reopen'], 'branch'],
    ['restaurant.recipes', ['view'], 'branch'],
    ['inventory.stock', ['view'], 'branch'],
    ['restaurant.reports', ['view'], 'branch'],
    ['restaurant.settings', ['view'], 'branch'],
  ],
);

const CASHIER = role(
  'cashier',
  'Cashier',
  'کیشیئر',
  'Takes orders and payments at the POS; discounts up to 10%; opens and closes their own shift.',
  [
    ['restaurant.tables', ['view'], 'branch'],
    ...MENU_VIEW,
    ['restaurant.orders', ['view', 'create', 'update', 'send_to_kitchen'], 'branch'],
    ['restaurant.voids', ['request'], 'branch'],
    ['restaurant.bills', ['view', 'create', 'update', 'split', 'merge', 'reprint'], 'branch'],
    ['restaurant.payments', ['view', 'create'], 'branch'],
    ['restaurant.discounts', ['create'], 'branch', { max_discount_pct: 10 }],
    ['pos.shifts', ['view', 'open', 'close', 'cash_movement'], 'own'],
    ['restaurant.reports', ['view'], 'own'],
  ],
);

const WAITER = role(
  'waiter',
  'Waiter',
  'ویٹر',
  'Their own sections’ tables: takes orders, sends them to the kitchen, asks for the bill.',
  [
    ['restaurant.sections', ['view'], 'assigned'],
    ['restaurant.tables', ['view', 'update', 'seat', 'transfer'], 'assigned'],
    ['restaurant.menu_items', ['view'], 'branch'],
    ['restaurant.menu_categories', ['view'], 'branch'],
    ['restaurant.modifier_groups', ['view'], 'branch'],
    ['restaurant.orders', ['view', 'create', 'update', 'send_to_kitchen'], 'assigned'],
    ['restaurant.voids', ['request'], 'assigned'],
    ['restaurant.bills', ['request'], 'assigned'],
  ],
);

const HOST = role('host', 'Host', 'ہوسٹ', 'Seats guests and keeps the floor moving.', [
  ['restaurant.tables', ['view', 'update', 'seat'], 'branch'],
  ['restaurant.sections', ['view'], 'branch'],
  ...MENU_VIEW,
  ['restaurant.orders', ['view'], 'branch'],
]);

const CHEF = role(
  'chef',
  'Chef / Kitchen Manager',
  'شیف / کچن مینیجر',
  'All stations’ tickets, items sold out (86), recipes and wastage for the outlet.',
  [
    ['restaurant.menu_items', ['view', 'mark_unavailable'], 'branch'],
    ['restaurant.menu_categories', ['view'], 'branch'],
    ['restaurant.orders', ['view'], 'branch'],
    ['restaurant.voids', ['view'], 'branch'],
    ['restaurant.kds_tickets', ['view', 'start', 'bump', 'recall'], 'branch'],
    ['restaurant.stations', ['view'], 'branch'],
    ['restaurant.recipes', ['view', 'create', 'update'], 'branch'],
    ['restaurant.wastage', ['view', 'create'], 'branch'],
  ],
);

const KITCHEN_STAFF = role(
  'kitchen_staff',
  'Kitchen Staff',
  'کچن اسٹاف',
  'Their station’s ticket board: start and bump; marks items sold out.',
  [
    ['restaurant.menu_items', ['view', 'mark_unavailable'], 'branch'],
    ['restaurant.kds_tickets', ['view', 'start', 'bump'], 'assigned'],
    ['restaurant.recipes', ['view'], 'branch'],
  ],
);

const STORE_KEEPER = role(
  'store_keeper',
  'Store Keeper',
  'اسٹور کیپر',
  'Receives and issues stock for the outlet’s kitchen store.',
  [
    ...MENU_VIEW,
    ['restaurant.recipes', ['view'], 'branch'],
    ['inventory.items', ['view', 'create', 'update'], 'branch'],
    ['inventory.stock', ['view', 'receive', 'issue'], 'branch'],
  ],
);

const DELIVERY_DISPATCHER = role(
  'delivery_dispatcher',
  'Delivery Dispatcher',
  'ڈیلیوری ڈسپیچر',
  'Phone and takeaway orders for delivery; the Delivery feature (Release 2) adds riders and zones.',
  [
    ...MENU_VIEW,
    ['restaurant.orders', ['view', 'create', 'update'], 'branch'],
    ['restaurant.voids', ['request'], 'branch'],
    ['restaurant.bills', ['view', 'create'], 'branch'],
  ],
);

export const RESTAURANT_CAFE = buildTemplate({
  key: 'restaurant_cafe',
  version: '1.0.0',
  name: { en: 'Restaurant & Café', ur: 'ریسٹورنٹ اور کیفے' },
  industry: 'restaurant',
  description:
    'Floor and tables, menu, waiter app, kitchen display, cashier and takeaway, recipes and stock, with people and payroll.',
  entitlements: [
    'pos.core',
    'restaurant.floor',
    'restaurant.menu',
    'restaurant.waiter_app',
    'restaurant.kds',
    'restaurant.cashier',
    'restaurant.takeaway',
    'inventory.stock',
    'restaurant.recipes',
    'hr.core',
    'attendance.shifts',
    'attendance.capture',
    'attendance.sheet',
    'payroll.structures',
    'payroll.periods',
    'payroll.runs',
    'payroll.payslips',
  ],
  limits: {
    'branches.max': 1,
    'pos.terminals.max': 2,
    'kds.screens.max': 2,
    'restaurant.waiter_devices.max': 5,
    'users.max': 15,
  },
  terminology: {
    branch: { en: 'Outlet', ur: 'آؤٹ لیٹ' },
    customer: { en: 'Guest', ur: 'مہمان' },
    sales_invoice: { en: 'Bill', ur: 'بل' },
    item: { en: 'Menu item', ur: 'مینو آئٹم' },
    employee: { en: 'Staff', ur: 'عملہ' },
    appointment: { en: 'Reservation', ur: 'ریزرویشن' },
  },
  roles: [
    ...COMPANY_ROLES,
    OUTLET_MANAGER,
    CASHIER,
    WAITER,
    HOST,
    CHEF,
    KITCHEN_STAFF,
    STORE_KEEPER,
    DELIVERY_DISPATCHER,
  ],
  settings: {
    'core.locale': 'en',
    'core.fiscal_year_start_month': 7,
    'restaurant.service_modes': ['dine_in', 'takeaway'],
    'restaurant.service_charge_pct': 0,
    'restaurant.tips_enabled': true,
    'restaurant.kitchen_routing': 'by_category',
    'restaurant.kds_target_minutes': { green: 8, amber: 15 },
  },
  wizard: [
    'welcome',
    'company_profile',
    'localization',
    'organization',
    'floors_tables',
    'menu',
    'kitchen_stations',
    'devices_printers',
    'taxes_fiscal',
    'payment_methods',
    'service_charge_tips',
    'team',
    'review',
  ],
});
