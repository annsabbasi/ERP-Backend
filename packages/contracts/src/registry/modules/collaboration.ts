import { actions, defineModule, feature } from '../define';

// Part 07 §7.9–7.14. Permissions only where Part 11 §11.7.2 names them.

export const meetings = defineModule({
  key: 'meetings',
  name: 'Meetings',
  category: 'business',
  group: 'Collaboration',
  features: {
    core: feature({
      name: 'Meetings',
      release: 'R1',
      resources: {
        meetings: actions(['view', 'create', 'update', 'cancel'], {
          special: ['publish_minutes', 'view_confidential'],
        }),
      },
    }),
    agenda: feature({ name: 'Agenda & Pre-reads', release: 'R1', requires: ['meetings.core'] }),
    minutes: feature({
      name: 'Minutes, Decisions & Actions',
      release: 'R1',
      requires: ['meetings.core'],
    }),
    rooms: feature({ name: 'Rooms & Resources', release: 'R1', requires: ['meetings.core'] }),
    booking: feature({ name: 'Booking Slots', release: 'R2', requires: ['meetings.core'] }),
    calendar_sync: feature({ name: 'Calendar Sync', release: 'R2', requires: ['meetings.core'] }),
    governance: feature({
      name: 'Board Governance',
      release: 'later',
      requires: ['meetings.minutes'],
    }),
  },
});

export const projects = defineModule({
  key: 'projects',
  name: 'Projects & Tasks',
  category: 'business',
  group: 'Collaboration',
  features: {
    tasks: feature({ name: 'Tasks', release: 'R1' }),
    projects: feature({ name: 'Projects', release: 'R1' }),
    time: feature({ name: 'Time Tracking', release: 'R1', requires: ['projects.projects'] }),
    costing: feature({ name: 'Project Costing', release: 'R2', requires: ['projects.projects'] }),
    billing: feature({
      name: 'Project Billing',
      release: 'R2',
      requires: ['projects.projects', 'sales.invoicing'],
    }),
    portal: feature({ name: 'Client Portal', release: 'later', requires: ['projects.projects'] }),
  },
});

export const helpdesk = defineModule({
  key: 'helpdesk',
  name: 'Helpdesk & Service',
  category: 'business',
  group: 'Collaboration',
  features: {
    tickets: feature({ name: 'Tickets', release: 'R1' }),
    sla: feature({ name: 'SLAs', release: 'R1', requires: ['helpdesk.tickets'] }),
    kb: feature({ name: 'Knowledge Base', release: 'R2' }),
    contracts: feature({
      name: 'Service Contracts & Warranty',
      release: 'R2',
      requires: ['helpdesk.tickets'],
    }),
    field: feature({ name: 'Field Service', release: 'later', requires: ['helpdesk.tickets'] }),
  },
});

export const documents = defineModule({
  key: 'documents',
  name: 'Documents',
  category: 'business',
  group: 'Collaboration',
  features: {
    library: feature({ name: 'Document Library', release: 'R2' }),
    acknowledge: feature({
      name: 'Acknowledgements',
      release: 'R2',
      requires: ['documents.library'],
    }),
    expiry: feature({ name: 'Expiry Tracking', release: 'R2' }),
    esign: feature({ name: 'E-signature', release: 'later' }),
  },
});

export const fleet = defineModule({
  key: 'fleet',
  name: 'Fleet & Transport',
  category: 'business',
  group: 'Collaboration',
  features: {
    vehicles: feature({ name: 'Vehicles & Drivers', release: 'R2' }),
    fuel: feature({ name: 'Fuel & Trips', release: 'R2', requires: ['fleet.vehicles'] }),
    maintenance: feature({
      name: 'Vehicle Maintenance',
      release: 'later',
      requires: ['fleet.vehicles'],
    }),
  },
});

export const announcements = defineModule({
  key: 'announcements',
  name: 'Announcements',
  category: 'business',
  group: 'Collaboration',
  features: {
    board: feature({ name: 'Notice Board', release: 'R1' }),
    polls: feature({ name: 'Polls & Surveys', release: 'later' }),
  },
});
