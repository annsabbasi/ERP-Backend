import { defineModule, feature } from '../define';

// Paid extras (Part 02 §2.9.2, Part 04 §4.6) and country capabilities (Part 02 §2.6).

export const addon = defineModule({
  key: 'addon',
  name: 'Add-ons',
  category: 'addon',
  group: 'Add-ons',
  features: {
    sms_credits: feature({ name: 'SMS credits', release: 'R1' }),
    whatsapp_credits: feature({ name: 'WhatsApp credits', release: 'R1' }),
    extra_storage: feature({ name: 'Extra storage', release: 'R1' }),
    api_access: feature({ name: 'API access', release: 'R2' }),
    sso: feature({ name: 'Single sign-on', release: 'later' }),
    dedicated_database: feature({ name: 'Dedicated database', release: 'later' }),
    multi_entity: feature({ name: 'Multiple legal entities', release: 'later' }),
    white_label: feature({ name: 'White label', release: 'later' }),
  },
});

// Feature keys are localization.<country>.<capability>, as in Part 02 §2.9.6
// (localization.pk.onebill). They are usually switched on with the country.
export const localization = defineModule({
  key: 'localization',
  name: 'Localization',
  category: 'localization',
  group: 'Localization',
  features: {
    'pk.tax': feature({ name: 'Pakistan taxes', release: 'R1' }),
    'pk.fbr': feature({
      name: 'FBR fiscalization',
      release: 'R1',
      requires: ['pos.fiscalization'],
    }),
    'pk.pra': feature({
      name: 'PRA fiscalization',
      release: 'R1',
      requires: ['pos.fiscalization'],
    }),
    'pk.srb': feature({
      name: 'SRB fiscalization',
      release: 'later',
      requires: ['pos.fiscalization'],
    }),
    'pk.kpra': feature({
      name: 'KPRA fiscalization',
      release: 'later',
      requires: ['pos.fiscalization'],
    }),
    'pk.bra': feature({
      name: 'BRA fiscalization',
      release: 'later',
      requires: ['pos.fiscalization'],
    }),
    'pk.onebill': feature({ name: '1BILL collection', release: 'R1', requires: ['finance.core'] }),
    'pk.payroll': feature({
      name: 'Pakistan payroll statutory rules',
      release: 'R1',
      requires: ['payroll.statutory'],
    }),
  },
});
