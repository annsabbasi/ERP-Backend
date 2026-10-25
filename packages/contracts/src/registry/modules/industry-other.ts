import { defineModule, feature } from '../define';

// Part 08 §8.4–8.6: feature keys only; each pack's own stage adds permissions.

export const realestate = defineModule({
  key: 'realestate',
  name: 'Real Estate & Housing',
  category: 'industry',
  group: 'Real Estate',
  requires: ['finance.core'],
  features: {
    inventory: feature({ name: 'Projects & Inventory', release: 'R1' }),
    sales: feature({
      name: 'Bookings & Allotments',
      release: 'R1',
      requires: ['realestate.inventory'],
    }),
    plans: feature({ name: 'Payment Plans', release: 'R1', requires: ['realestate.sales'] }),
    billing: feature({
      name: 'Instalment Challans & Collection',
      release: 'R1',
      requires: ['realestate.plans'],
    }),
    surcharge: feature({ name: 'Surcharge', release: 'R1', requires: ['realestate.billing'] }),
    transfers: feature({ name: 'Transfers', release: 'R2', requires: ['realestate.sales'] }),
    possession: feature({ name: 'Possession', release: 'R2', requires: ['realestate.sales'] }),
    maintenance: feature({
      name: 'Society Maintenance Billing',
      release: 'R2',
      requires: ['realestate.inventory'],
    }),
    dealers: feature({
      name: 'Dealers & Commissions',
      release: 'R2',
      requires: ['realestate.sales'],
    }),
    cancellations: feature({
      name: 'Cancellations & Refunds',
      release: 'R2',
      requires: ['realestate.sales'],
    }),
  },
});

export const retail = defineModule({
  key: 'retail',
  name: 'Retail',
  category: 'industry',
  group: 'Retail & Distribution',
  requires: ['pos.core', 'inventory.stock'],
  features: {
    stores: feature({ name: 'Multi-store Retail', release: 'R1' }),
    fbr: feature({
      name: 'FBR Tier-1 Integration',
      release: 'R1',
      requires: ['pos.fiscalization'],
    }),
    loyalty: feature({ name: 'Loyalty & Gift Cards', release: 'R2', requires: ['pos.loyalty'] }),
  },
});

export const distribution = defineModule({
  key: 'distribution',
  name: 'Distribution',
  category: 'industry',
  group: 'Retail & Distribution',
  requires: ['sales.orders', 'inventory.stock'],
  features: {
    routes: feature({ name: 'Routes & Beats', release: 'R2' }),
    order_booking: feature({
      name: 'Order Booking App',
      release: 'R2',
      requires: ['distribution.routes'],
    }),
    van_sales: feature({ name: 'Van Sales & Delivery', release: 'R2' }),
    schemes: feature({ name: 'Trade Schemes', release: 'R2' }),
    credit: feature({ name: 'Credit Control', release: 'R2' }),
  },
});

export const clinic = defineModule({
  key: 'clinic',
  name: 'Clinic & Diagnostics',
  category: 'industry',
  group: 'Clinic',
  requires: ['finance.core'],
  features: {
    patients: feature({ name: 'Patients', release: 'later' }),
    appointments: feature({
      name: 'Appointments & Queues',
      release: 'later',
      requires: ['clinic.patients'],
    }),
    consultations: feature({
      name: 'Consultations',
      release: 'later',
      requires: ['clinic.patients'],
    }),
    laboratory: feature({ name: 'Laboratory', release: 'later', requires: ['clinic.patients'] }),
    pharmacy: feature({ name: 'Pharmacy', release: 'later', requires: ['inventory.stock'] }),
    billing: feature({
      name: 'Billing & Insurance Panels',
      release: 'later',
      requires: ['clinic.patients'],
    }),
  },
});
