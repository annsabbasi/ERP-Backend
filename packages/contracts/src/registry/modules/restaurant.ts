import { actions, defineModule, feature } from '../define';

// Restaurant & Café pack (Part 08 §8.2). Full permissions now: the Stage 4 role templates
// need them (§8.2.18). Resources such as orders are used by several features (waiter app,
// cashier, takeaway, delivery); each declares what it needs, and a permission is entitled
// when any feature that declares it is effective.

const shared = {
  settings: actions(['view', 'configure']),
  reports: actions(['view', 'export']),
};

export const restaurant = defineModule({
  key: 'restaurant',
  name: 'Restaurant',
  category: 'industry',
  group: 'Restaurant',
  requires: ['pos.core', 'finance.core'],
  recommends: ['inventory.stock'],
  features: {
    floor: feature({
      name: 'Floors & Tables',
      release: 'R1',
      scopes: ['assigned', 'branch', 'company'],
      resources: {
        floors: actions(['view', 'create', 'update', 'delete']),
        sections: actions(['view', 'create', 'update', 'delete', 'assign']),
        tables: actions(['view', 'create', 'update', 'delete'], {
          special: ['seat', 'transfer', 'merge', 'mark_clean'],
        }),
        settings: shared.settings,
      },
      menu: [
        {
          path: '/restaurant/floor',
          label: 'nav.restaurant.floor',
          requires: 'restaurant.tables.view',
        },
      ],
    }),
    menu: feature({
      name: 'Menu',
      release: 'R1',
      scopes: ['branch', 'company'],
      resources: {
        menu_categories: actions(['view', 'create', 'update', 'delete']),
        menu_items: actions(['view', 'create', 'update', 'delete'], {
          special: ['mark_unavailable'],
        }),
        modifier_groups: actions(['view', 'create', 'update', 'delete']),
        combos: actions(['view', 'create', 'update', 'delete']),
        settings: shared.settings,
        reports: shared.reports,
      },
      menu: [
        {
          path: '/restaurant/menu',
          label: 'nav.restaurant.menu',
          requires: 'restaurant.menu_items.view',
        },
        {
          path: '/restaurant/settings',
          label: 'nav.restaurant.settings',
          requires: 'restaurant.settings.view',
        },
      ],
    }),
    waiter_app: feature({
      name: 'Waiter App',
      release: 'R1',
      requires: ['restaurant.menu', 'restaurant.floor'],
      limits: ['restaurant.waiter_devices.max'],
      scopes: ['assigned', 'branch', 'company'],
      resources: {
        orders: actions(['view', 'create', 'update'], { special: ['send_to_kitchen', 'transfer'] }),
        voids: actions([], { special: ['request'] }),
        bills: actions([], { special: ['request'] }),
      },
      menu: [
        {
          path: '/restaurant/waiter',
          label: 'nav.restaurant.waiter',
          requires: 'restaurant.orders.create',
        },
      ],
    }),
    kds: feature({
      name: 'Kitchen Display',
      release: 'R1',
      requires: ['restaurant.menu'],
      recommends: ['restaurant.floor'],
      limits: ['kds.screens.max'],
      scopes: ['assigned', 'branch', 'company'],
      resources: {
        stations: actions(['view', 'create', 'update', 'delete']),
        kds_tickets: actions(['view'], { special: ['start', 'bump', 'recall'] }),
      },
      menu: [
        {
          path: '/restaurant/kitchen',
          label: 'nav.restaurant.kitchen',
          requires: 'restaurant.kds_tickets.view',
        },
      ],
    }),
    cashier: feature({
      name: 'Cashier & Billing',
      release: 'R1',
      scopes: ['own', 'branch', 'company'],
      resources: {
        orders: actions(['view', 'create', 'update'], {
          special: ['send_to_kitchen', 'transfer', 'complimentary'],
        }),
        bills: actions(['view', 'create', 'update'], {
          special: ['split', 'merge', 'discount', 'reprint', 'refund', 'request', 'complimentary'],
        }),
        payments: actions(['view', 'create']),
        voids: actions(['view', 'approve'], { special: ['request'] }),
        discounts: actions(['view', 'create', 'approve']),
        settings: shared.settings,
        reports: shared.reports,
      },
      menu: [
        {
          path: '/restaurant/orders',
          label: 'nav.restaurant.orders',
          requires: 'restaurant.orders.view',
        },
      ],
    }),
    takeaway: feature({
      name: 'Takeaway & Counter',
      release: 'R1',
      requires: ['restaurant.cashier'],
      scopes: ['own', 'branch', 'company'],
      resources: {
        orders: actions(['view', 'create', 'update'], { special: ['send_to_kitchen'] }),
      },
    }),
    delivery: feature({
      name: 'Delivery',
      release: 'R2',
      requires: ['restaurant.cashier'],
      scopes: ['assigned', 'branch', 'company'],
      resources: {
        orders: actions(['view', 'create', 'update'], { special: ['send_to_kitchen'] }),
        deliveries: actions(['view', 'create', 'update', 'assign', 'cancel']),
        riders: actions(['view', 'create', 'update'], { special: ['settle'] }),
        delivery_zones: actions(['view', 'create', 'update', 'delete']),
      },
      menu: [
        {
          path: '/restaurant/delivery',
          label: 'nav.restaurant.delivery',
          requires: 'restaurant.deliveries.view',
        },
      ],
    }),
    reservations: feature({
      name: 'Reservations & Waitlist',
      release: 'R2',
      requires: ['restaurant.floor'],
      scopes: ['branch', 'company'],
      resources: {
        reservations: actions(['view', 'create', 'update', 'cancel']),
        waitlist: actions(['view', 'create', 'update']),
      },
      menu: [
        {
          path: '/restaurant/reservations',
          label: 'nav.restaurant.reservations',
          requires: 'restaurant.reservations.view',
        },
      ],
    }),
    recipes: feature({
      name: 'Recipes & Food Cost',
      release: 'R1',
      requires: ['inventory.stock'],
      recommends: ['purchasing.orders'],
      scopes: ['branch', 'company'],
      resources: {
        recipes: actions(['view', 'create', 'update', 'delete']),
        wastage: actions(['view', 'create']),
      },
      menu: [
        {
          path: '/restaurant/recipes',
          label: 'nav.restaurant.recipes',
          requires: 'restaurant.recipes.view',
        },
      ],
    }),
    qr_ordering: feature({
      name: 'QR Menu & Table Ordering',
      release: 'R3',
      requires: ['restaurant.menu'],
      resources: {
        qr_menus: actions(['view', 'configure']),
        qr_orders: actions(['view'], { special: ['confirm'] }),
      },
    }),
    loyalty: feature({
      name: 'Guests & Loyalty',
      release: 'R2',
      requires: ['core.parties'],
      resources: {
        // contact_view is the sensitive guest contact group (Part 04 §4.9.4).
        guests: actions(['view', 'create', 'update', 'export'], {
          special: ['merge', 'contact_view'],
        }),
        loyalty: actions(['view'], { special: ['adjust'] }),
      },
      menu: [
        {
          path: '/restaurant/guests',
          label: 'nav.restaurant.guests',
          requires: 'restaurant.guests.view',
        },
      ],
    }),
    hub: feature({
      name: 'Outlet Hub (local-network mode)',
      release: 'R2',
      requiresAnyOf: ['restaurant.waiter_app', 'restaurant.kds'],
      resources: { hub: actions(['view', 'configure'], { special: ['pair'] }) },
    }),
  },
});
