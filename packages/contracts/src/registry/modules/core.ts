import { actions, defineModule, feature } from '../define';

// Core platform services, always on (Part 06 §6.2). Resources and menu entries follow the
// company Settings tree (Part 04 §4.4), the routes of Part 12 §12.8.2 and the permission
// keys of Part 11 §11.10.4.
export const core = defineModule({
  key: 'core',
  name: 'Core services',
  category: 'core',
  group: 'Core',
  features: {
    org: feature({
      name: 'Organization & Settings',
      release: 'R1',
      limits: ['branches.max'],
      resources: {
        company: actions(['view', 'configure']),
        legal_entities: actions(['view', 'create', 'update', 'delete']),
        branches: actions(['view', 'create', 'update', 'delete']),
        departments: actions(['view', 'create', 'update', 'delete']),
        teams: actions(['view', 'create', 'update', 'delete']),
        positions: actions(['view', 'create', 'update', 'delete']),
        cost_centres: actions(['view', 'create', 'update', 'delete']),
        settings: actions(['view', 'configure']),
        plan: actions(['view'], { special: ['request'] }),
        billing: actions(['view', 'configure']),
      },
      menu: [
        {
          path: '/settings/overview',
          label: 'nav.settings.overview',
          requires: 'core.company.view',
        },
        { path: '/settings/company', label: 'nav.settings.company', requires: 'core.company.view' },
        {
          path: '/settings/organization',
          label: 'nav.settings.organization',
          requires: 'core.branches.view',
        },
        { path: '/settings/plan', label: 'nav.settings.plan', requires: 'core.plan.view' },
        { path: '/settings/billing', label: 'nav.settings.billing', requires: 'core.billing.view' },
      ],
    }),
    iam: feature({
      name: 'Identity & Access',
      release: 'R1',
      limits: ['users.max', 'devices.max', 'devices.kiosks.max'],
      resources: {
        members: actions(['view', 'update', 'export'], {
          special: [
            'invite',
            'suspend',
            'reactivate',
            'deactivate',
            'send_reset',
            'require_mfa',
            'sign_out_all',
            'transfer_ownership',
          ],
        }),
        join_links: actions(['view', 'create', 'update', 'delete']),
        join_requests: actions(['view', 'approve', 'reject']),
        roles: actions(['view', 'create', 'update', 'delete', 'assign']),
        security_policy: actions(['view', 'configure']),
        sessions: actions(['view'], { special: ['revoke'] }),
        devices: actions(['view', 'create', 'update'], { special: ['pair', 'revoke'] }),
        support_grants: actions(['view', 'create'], { special: ['revoke'] }),
      },
      menu: [
        { path: '/settings/users', label: 'nav.settings.users', requires: 'core.members.view' },
        {
          path: '/settings/join-requests',
          label: 'nav.settings.join_requests',
          requires: 'core.join_requests.view',
        },
        { path: '/settings/roles', label: 'nav.settings.roles', requires: 'core.roles.view' },
        {
          path: '/settings/security',
          label: 'nav.settings.security',
          requires: 'core.security_policy.view',
        },
        { path: '/settings/devices', label: 'nav.settings.devices', requires: 'core.devices.view' },
        {
          path: '/settings/support',
          label: 'nav.settings.support',
          requires: 'core.support_grants.view',
        },
      ],
    }),
    parties: feature({
      name: 'Parties',
      release: 'R1',
      resources: {
        parties: actions(['view', 'create', 'update', 'export'], { special: ['merge'] }),
        // Sensitive: national ID and passport numbers (Part 04 §4.9.4).
        identity_numbers: actions(['view']),
      },
    }),
    files: feature({
      name: 'Files & Attachments',
      release: 'R1',
      limits: ['storage.gb'],
      resources: { files: actions(['view', 'create', 'delete']) },
    }),
    activity: feature({
      name: 'Activity & Comments',
      release: 'R1',
      resources: {
        comments: actions(['view', 'create', 'update', 'delete']),
        tasks: actions(['view', 'create', 'update', 'assign']),
      },
      menu: [{ path: '/tasks', label: 'nav.tasks', requires: 'core.tasks.view' }],
    }),
    notify: feature({
      name: 'Notifications',
      release: 'R1',
      limits: ['messaging.sms.monthly', 'messaging.whatsapp.monthly'],
      resources: {
        notifications: actions(['view']),
        notification_rules: actions(['view', 'configure']),
      },
      menu: [
        { path: '/notifications', label: 'nav.notifications', requires: 'core.notifications.view' },
        {
          path: '/settings/notifications',
          label: 'nav.settings.notifications',
          requires: 'core.notification_rules.view',
        },
      ],
    }),
    workflow: feature({
      name: 'Workflow & Approvals',
      release: 'R1',
      resources: {
        workflows: actions(['view', 'configure']),
        approvals: actions(['view', 'approve', 'reject'], { special: ['delegate'] }),
      },
      menu: [
        { path: '/approvals', label: 'nav.approvals', requires: 'core.approvals.view' },
        {
          path: '/settings/workflows',
          label: 'nav.settings.workflows',
          requires: 'core.workflows.view',
        },
      ],
    }),
    numbering: feature({
      name: 'Numbering, document templates and printing',
      release: 'R1',
      resources: {
        numbering_series: actions(['view', 'configure']),
        document_templates: actions(['view', 'configure']),
      },
      menu: [
        {
          path: '/settings/numbering',
          label: 'nav.settings.numbering',
          requires: 'core.numbering_series.view',
        },
        {
          path: '/settings/templates',
          label: 'nav.settings.templates',
          requires: 'core.document_templates.view',
        },
      ],
    }),
    audit: feature({
      name: 'Audit',
      release: 'R1',
      resources: { audit: actions(['view', 'export']) },
      menu: [{ path: '/settings/audit', label: 'nav.settings.audit', requires: 'core.audit.view' }],
    }),
    reports: feature({
      name: 'Reports engine',
      release: 'R1',
      resources: {
        reports: actions(['view', 'export']),
        dashboards: actions(['view', 'configure']),
      },
      menu: [
        { path: '/reports', label: 'nav.reports', requires: 'core.reports.view' },
        {
          path: '/settings/dashboards',
          label: 'nav.settings.dashboards',
          requires: 'core.dashboards.view',
        },
      ],
    }),
    data: feature({
      name: 'Import / Export',
      release: 'R1',
      resources: { data: actions(['import', 'export']) },
      menu: [{ path: '/settings/data', label: 'nav.settings.data', requires: 'core.data.import' }],
    }),
    integrations: feature({
      name: 'Integrations, API keys and webhooks',
      release: 'R1',
      limits: ['api.calls.daily'],
      resources: {
        integrations: actions(['view', 'configure']),
        api_keys: actions(['view', 'create'], { special: ['revoke'] }),
        webhooks: actions(['view', 'create', 'update', 'delete']),
      },
      menu: [
        {
          path: '/settings/integrations',
          label: 'nav.settings.integrations',
          requires: 'core.integrations.view',
        },
      ],
    }),
    search: feature({ name: 'Search', release: 'R1' }),
    custom_fields: feature({
      name: 'Custom fields',
      release: 'later',
      alwaysOn: false,
      resources: { custom_fields: actions(['view', 'configure']) },
    }),
  },
});
