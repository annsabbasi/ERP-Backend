import { z } from 'zod';

// Transactional e-mail (Part 10 §10.2, Part 05 §5.9): the API puts a job on the worker's
// `email` queue; the worker renders the template in the person's language and sends it.

export const EMAIL_QUEUE = 'email';

export const EMAIL_LOCALES = ['en', 'ur'] as const;

/** Every template and the values it needs. Links are full URLs built by the API. */
export const EMAIL_TEMPLATES = {
  password_reset: ['name', 'link', 'expires_minutes'],
  password_changed: ['name'],
  new_sign_in: ['name', 'when', 'device'],
  mfa_changed: ['name', 'change'],
  account_locked: ['name', 'link', 'minutes'],
  email_change_confirm: ['name', 'link', 'new_email'],
  email_change_notice: ['name', 'new_email'],
  account_setup: ['name', 'link', 'expires_hours'],
  staff_setup: ['name', 'link', 'expires_hours'],
} as const satisfies Record<string, readonly string[]>;

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES;

export const EmailJobSchema = z
  .object({
    template: z.enum(Object.keys(EMAIL_TEMPLATES) as [EmailTemplate, ...EmailTemplate[]]),
    to: z.email(),
    locale: z.enum(EMAIL_LOCALES).default('en'),
    data: z.record(z.string(), z.string()),
  })
  .superRefine((job, ctx) => {
    for (const key of EMAIL_TEMPLATES[job.template]) {
      if (!job.data[key])
        ctx.addIssue({ code: 'custom', path: ['data', key], message: 'required' });
    }
  });
export type EmailJob = z.input<typeof EmailJobSchema>;
