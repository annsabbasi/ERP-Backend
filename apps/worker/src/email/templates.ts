import type { EmailTemplate } from '@erp/contracts';

// Transactional e-mail templates (Part 05 §5.9), in English, the only language (D12). Each has a
// version, sent as the X-ERP-Template header, so a mail can be traced to the text it was sent
// with.

type Text = { subject: string; body: string[] };
type Template = { version: number; render: (data: Record<string, string>) => Text };

const MFA_CHANGES: Record<string, string> = {
  enabled: 'two-step sign-in with an authenticator app was turned on',
  disabled: 'two-step sign-in was turned off',
  recovery_codes_replaced: 'new recovery codes were created; the old ones no longer work',
  recovery_code_used: 'a recovery code was used to sign in',
};

const hello = (name: string) => `Hello ${name},`;

export const TEMPLATES: Record<EmailTemplate, Template> = {
  password_reset: {
    version: 1,
    render: (d) => ({
      subject: 'Reset your ERP System password',
      body: [
        hello(d.name!),
        `We received a request to reset your password. Open this link within ${d.expires_minutes} minutes to choose a new one:`,
        d.link!,
        'If you did not ask for this, ignore this e-mail; your password stays the same.',
      ],
    }),
  },
  password_changed: {
    version: 1,
    render: (d) => ({
      subject: 'Your ERP System password was changed',
      body: [
        hello(d.name!),
        'The password of your account was just changed, and every other session was signed out.',
        'If this was not you, reset your password now and tell your company administrator.',
      ],
    }),
  },
  new_sign_in: {
    version: 1,
    render: (d) => ({
      subject: 'New sign-in to your ERP System account',
      body: [
        hello(d.name!),
        `Your account was signed in from a new device: ${d.device}, at ${d.when} (UTC).`,
        'If this was you, there is nothing to do. If not, change your password and sign out the other sessions under My Account › Security.',
      ],
    }),
  },
  mfa_changed: {
    version: 1,
    render: (d) => ({
      subject: 'Two-step sign-in was changed on your account',
      body: [
        hello(d.name!),
        `On your account, ${MFA_CHANGES[d.change!] ?? d.change!}.`,
        'If this was not you, reset your password now and tell your company administrator.',
      ],
    }),
  },
  account_locked: {
    version: 1,
    render: (d) => ({
      subject: `Your ERP System account is locked for ${d.minutes} minutes`,
      body: [
        hello(d.name!),
        `There were too many failed sign-in attempts on your account, so it is locked for ${d.minutes} minutes. If this was you, wait and try again.`,
        "If this wasn't you, reset your password now:",
        d.link!,
      ],
    }),
  },
  email_change_confirm: {
    version: 1,
    render: (d) => ({
      subject: 'Confirm your new e-mail address',
      body: [
        hello(d.name!),
        `Confirm that ${d.new_email} is your new sign-in address by opening this link within 24 hours:`,
        d.link!,
        'Until then your old address stays in use.',
      ],
    }),
  },
  email_change_notice: {
    version: 1,
    render: (d) => ({
      subject: 'A change of your sign-in address was requested',
      body: [
        hello(d.name!),
        `Someone asked to change the sign-in address of your account to ${d.new_email}. It changes only after the new address is confirmed.`,
        'If this was not you, change your password now.',
      ],
    }),
  },
  account_setup: {
    version: 1,
    render: (d) => ({
      subject: 'Set up your ERP System account',
      body: [
        hello(d.name!),
        `An account was created for you. Open this link within ${d.expires_hours} hours to choose your password:`,
        d.link!,
      ],
    }),
  },
  // Version 2: every staff role gets this mail, not only the first Platform Owner.
  staff_setup: {
    version: 2,
    render: (d) => ({
      subject: 'Set up your Platform Console account',
      body: [
        hello(d.name!),
        `A Platform Console account was created for you in ERP System. Open this link within ${d.expires_hours} hours to set your password; at your first sign-in you will add an authenticator app:`,
        d.link!,
      ],
    }),
  },
};

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FOOTER = 'This e-mail was sent by ERP System. Please do not reply.';

/** Subject, plain text and simple HTML; links become buttons-free plain anchors. */
export function render(template: EmailTemplate, data: Record<string, string>) {
  const t = TEMPLATES[template];
  const { subject, body } = t.render(data);
  const text = [...body, '', FOOTER].join('\n\n');
  const paragraphs = body
    .map((line) =>
      /^https?:\/\//.test(line)
        ? `<p><a href="${escape(line)}">${escape(line)}</a></p>`
        : `<p>${escape(line)}</p>`,
    )
    .join('');
  const html = `<!doctype html><html lang="en"><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs}<p style="color:#4b5563;font-size:12px">${escape(FOOTER)}</p></body></html>`;
  return { subject, text, html, version: `${template}@${t.version}` };
}
