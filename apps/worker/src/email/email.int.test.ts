import { EMAIL_TEMPLATES, uuidv7, type EmailTemplate } from '@erp/contracts';
import { hostOf, LOCAL_HOSTS } from '@erp/db';
import type { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { EmailProcessor } from './email.processor';
import { render, TEMPLATES } from './templates';

// Transactional e-mail (Part 05 §5.9): every template, and a real delivery to the local mail
// catcher (Mailpit, D4) read back through its API.

const MAILPIT = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025';
if (!LOCAL_HOSTS.has(hostOf(MAILPIT) ?? '')) throw new Error('TEST_MAILPIT_URL must be local');

const sample = (template: EmailTemplate) =>
  Object.fromEntries(
    EMAIL_TEMPLATES[template].map((key) => [
      key,
      key === 'link'
        ? 'https://app.example.com/reset/abc'
        : key === 'change'
          ? 'enabled'
          : `${key}-value`,
    ]),
  );

describe('templates', () => {
  it.each(Object.keys(TEMPLATES) as EmailTemplate[])('%s renders with every value', (template) => {
    const mail = render(template, sample(template));
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.version).toBe(`${template}@${TEMPLATES[template].version}`);
    expect(mail.html).toContain('<html lang="en">');
    for (const key of EMAIL_TEMPLATES[template]) {
      if (key !== 'change') expect(mail.text).toContain(sample(template)[key]);
    }
  });

  it('tells invited staff of any role about their console account, not only Owners', () => {
    const mail = render('staff_setup', sample('staff_setup'));
    expect(mail.text).toContain('A Platform Console account was created for you');
    expect(mail.text).not.toContain('Platform Owner');
  });

  it('escapes values in the HTML', () => {
    const mail = render('password_changed', { name: '<script>x</script>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('delivery', () => {
  it('sends through SMTP and the mail arrives in the mail catcher (AC-U04)', async () => {
    const to = `mail-${uuidv7().slice(-8)}@example.com`;
    const processor = new EmailProcessor();
    await processor.process({
      id: 'test-1',
      data: {
        template: 'password_changed',
        to,
        data: { name: 'Sana' },
      },
    } as unknown as Job);
    let found: { ID: string; Subject: string }[] = [];
    for (let i = 0; i < 20 && found.length === 0; i++) {
      const search = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      );
      found = ((await search.json()) as { messages: { ID: string; Subject: string }[] }).messages;
      if (found.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(found).toHaveLength(1);
    expect(found[0]!.Subject).toBe('Your ERP System password was changed');
    const headers = (await (
      await fetch(`${MAILPIT}/api/v1/message/${found[0]!.ID}/headers`)
    ).json()) as Record<string, string[]>;
    expect(headers['X-Erp-Template'] ?? headers['X-ERP-Template']).toEqual(['password_changed@1']);
  });

  it('refuses a job that misses a value its template needs', async () => {
    await expect(
      new EmailProcessor().process({
        id: 'test-2',
        data: { template: 'password_reset', to: 'x@example.com', data: { name: 'X' } },
      } as unknown as Job),
    ).rejects.toThrow();
  });
});
