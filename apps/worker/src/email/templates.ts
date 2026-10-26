import type { EmailTemplate } from '@erp/contracts';

// Transactional e-mail templates (Part 05 §5.9), English and Urdu. Each has a version, sent as
// the X-ERP-Template header, so a mail can be traced to the text it was sent with. The Urdu is
// a draft for review by a native speaker before go-live.

type Locale = 'en' | 'ur';
type Text = { subject: string; body: string[] };
type Template = { version: number; render: (data: Record<string, string>, locale: Locale) => Text };

const MFA_CHANGES: Record<string, Record<Locale, string>> = {
  enabled: {
    en: 'two-step sign-in with an authenticator app was turned on',
    ur: 'آتھنٹیکیٹر ایپ کے ساتھ دو مرحلہ سائن اِن آن کر دی گئی ہے',
  },
  disabled: { en: 'two-step sign-in was turned off', ur: 'دو مرحلہ سائن اِن بند کر دی گئی ہے' },
  recovery_codes_replaced: {
    en: 'new recovery codes were created; the old ones no longer work',
    ur: 'نئے ریکوری کوڈ بنائے گئے ہیں؛ پرانے کوڈ اب کام نہیں کریں گے',
  },
  recovery_code_used: {
    en: 'a recovery code was used to sign in',
    ur: 'سائن اِن کے لیے ایک ریکوری کوڈ استعمال کیا گیا ہے',
  },
};

const hello = (name: string, locale: Locale) =>
  locale === 'ur' ? `السلام علیکم ${name}،` : `Hello ${name},`;

export const TEMPLATES: Record<EmailTemplate, Template> = {
  password_reset: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'اپنا ERP System پاس ورڈ دوبارہ ترتیب دیں',
            body: [
              hello(d.name!, l),
              `ہمیں آپ کا پاس ورڈ دوبارہ ترتیب دینے کی درخواست ملی ہے۔ نیا پاس ورڈ منتخب کرنے کے لیے یہ لنک ${d.expires_minutes} منٹ کے اندر کھولیں:`,
              d.link!,
              'اگر یہ درخواست آپ نے نہیں کی تو اس ای میل کو نظر انداز کر دیں؛ آپ کا پاس ورڈ تبدیل نہیں ہوگا۔',
            ],
          }
        : {
            subject: 'Reset your ERP System password',
            body: [
              hello(d.name!, l),
              `We received a request to reset your password. Open this link within ${d.expires_minutes} minutes to choose a new one:`,
              d.link!,
              'If you did not ask for this, ignore this e-mail; your password stays the same.',
            ],
          },
  },
  password_changed: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'آپ کا ERP System پاس ورڈ تبدیل کر دیا گیا',
            body: [
              hello(d.name!, l),
              'آپ کے اکاؤنٹ کا پاس ورڈ ابھی تبدیل کیا گیا ہے اور باقی تمام سیشن ختم کر دیے گئے ہیں۔',
              'اگر یہ آپ نے نہیں کیا تو فوراً اپنا پاس ورڈ دوبارہ ترتیب دیں اور اپنی کمپنی کے ایڈمنسٹریٹر کو بتائیں۔',
            ],
          }
        : {
            subject: 'Your ERP System password was changed',
            body: [
              hello(d.name!, l),
              'The password of your account was just changed, and every other session was signed out.',
              'If this was not you, reset your password now and tell your company administrator.',
            ],
          },
  },
  new_sign_in: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'آپ کے ERP System اکاؤنٹ میں نیا سائن اِن',
            body: [
              hello(d.name!, l),
              `آپ کے اکاؤنٹ میں ایک نئے آلے سے سائن اِن ہوا ہے: ${d.device}، وقت ${d.when} (UTC)۔`,
              'اگر یہ آپ تھے تو کچھ کرنے کی ضرورت نہیں۔ ورنہ اپنا پاس ورڈ تبدیل کریں اور My Account › Security میں باقی سیشن ختم کریں۔',
            ],
          }
        : {
            subject: 'New sign-in to your ERP System account',
            body: [
              hello(d.name!, l),
              `Your account was signed in from a new device: ${d.device}, at ${d.when} (UTC).`,
              'If this was you, there is nothing to do. If not, change your password and sign out the other sessions under My Account › Security.',
            ],
          },
  },
  mfa_changed: {
    version: 1,
    render: (d, l) => {
      const change = MFA_CHANGES[d.change!]?.[l] ?? d.change!;
      return l === 'ur'
        ? {
            subject: 'آپ کے اکاؤنٹ کی دو مرحلہ سائن اِن میں تبدیلی',
            body: [
              hello(d.name!, l),
              `آپ کے اکاؤنٹ پر ${change}۔`,
              'اگر یہ آپ نے نہیں کیا تو فوراً اپنا پاس ورڈ دوبارہ ترتیب دیں اور اپنی کمپنی کے ایڈمنسٹریٹر کو بتائیں۔',
            ],
          }
        : {
            subject: 'Two-step sign-in was changed on your account',
            body: [
              hello(d.name!, l),
              `On your account, ${change}.`,
              'If this was not you, reset your password now and tell your company administrator.',
            ],
          };
    },
  },
  account_locked: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: `آپ کا ERP System اکاؤنٹ ${d.minutes} منٹ کے لیے بند کر دیا گیا ہے`,
            body: [
              hello(d.name!, l),
              `آپ کے اکاؤنٹ پر سائن اِن کی بہت سی ناکام کوششیں ہوئی ہیں، اس لیے اسے ${d.minutes} منٹ کے لیے بند کر دیا گیا ہے۔ اگر یہ آپ تھے تو انتظار کریں اور دوبارہ کوشش کریں۔`,
              'اگر یہ آپ نہیں تھے تو ابھی اپنا پاس ورڈ دوبارہ ترتیب دیں:',
              d.link!,
            ],
          }
        : {
            subject: `Your ERP System account is locked for ${d.minutes} minutes`,
            body: [
              hello(d.name!, l),
              `There were too many failed sign-in attempts on your account, so it is locked for ${d.minutes} minutes. If this was you, wait and try again.`,
              "If this wasn't you, reset your password now:",
              d.link!,
            ],
          },
  },
  email_change_confirm: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'اپنا نیا ای میل پتہ تصدیق کریں',
            body: [
              hello(d.name!, l),
              `یہ تصدیق کرنے کے لیے کہ ${d.new_email} آپ کا نیا سائن اِن پتہ ہے، یہ لنک 24 گھنٹوں کے اندر کھولیں:`,
              d.link!,
              'تب تک آپ کا پرانا پتہ ہی استعمال ہوگا۔',
            ],
          }
        : {
            subject: 'Confirm your new e-mail address',
            body: [
              hello(d.name!, l),
              `Confirm that ${d.new_email} is your new sign-in address by opening this link within 24 hours:`,
              d.link!,
              'Until then your old address stays in use.',
            ],
          },
  },
  email_change_notice: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'آپ کے سائن اِن پتے کی تبدیلی کی درخواست',
            body: [
              hello(d.name!, l),
              `کسی نے آپ کے اکاؤنٹ کا سائن اِن پتہ ${d.new_email} میں تبدیل کرنے کی درخواست کی ہے۔ یہ تبدیلی نئے پتے کی تصدیق کے بعد ہی ہوگی۔`,
              'اگر یہ آپ نے نہیں کیا تو ابھی اپنا پاس ورڈ تبدیل کریں۔',
            ],
          }
        : {
            subject: 'A change of your sign-in address was requested',
            body: [
              hello(d.name!, l),
              `Someone asked to change the sign-in address of your account to ${d.new_email}. It changes only after the new address is confirmed.`,
              'If this was not you, change your password now.',
            ],
          },
  },
  account_setup: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'اپنا ERP System اکاؤنٹ ترتیب دیں',
            body: [
              hello(d.name!, l),
              `آپ کے لیے ایک اکاؤنٹ بنایا گیا ہے۔ اپنا پاس ورڈ منتخب کرنے کے لیے یہ لنک ${d.expires_hours} گھنٹوں کے اندر کھولیں:`,
              d.link!,
            ],
          }
        : {
            subject: 'Set up your ERP System account',
            body: [
              hello(d.name!, l),
              `An account was created for you. Open this link within ${d.expires_hours} hours to choose your password:`,
              d.link!,
            ],
          },
  },
  staff_setup: {
    version: 1,
    render: (d, l) =>
      l === 'ur'
        ? {
            subject: 'اپنا پلیٹ فارم کنسول اکاؤنٹ ترتیب دیں',
            body: [
              hello(d.name!, l),
              `آپ کو ERP System کا پلیٹ فارم اونر بنایا گیا ہے۔ اپنا پاس ورڈ ترتیب دینے کے لیے یہ لنک ${d.expires_hours} گھنٹوں کے اندر کھولیں؛ پہلی بار سائن اِن پر آپ ایک آتھنٹیکیٹر ایپ شامل کریں گے:`,
              d.link!,
            ],
          }
        : {
            subject: 'Set up your Platform Console account',
            body: [
              hello(d.name!, l),
              `You have been made a Platform Owner of ERP System. Open this link within ${d.expires_hours} hours to set your password; at your first sign-in you will add an authenticator app:`,
              d.link!,
            ],
          },
  },
};

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Subject, plain text and simple HTML; links become buttons-free plain anchors. */
export function render(template: EmailTemplate, data: Record<string, string>, locale: Locale) {
  const t = TEMPLATES[template];
  const { subject, body } = t.render(data, locale);
  const footer =
    locale === 'ur'
      ? 'یہ ای میل ERP System نے بھیجی ہے۔ اس کا جواب نہ دیں۔'
      : 'This e-mail was sent by ERP System. Please do not reply.';
  const text = [...body, '', footer].join('\n\n');
  const paragraphs = body
    .map((line) =>
      /^https?:\/\//.test(line)
        ? `<p><a href="${escape(line)}">${escape(line)}</a></p>`
        : `<p>${escape(line)}</p>`,
    )
    .join('');
  const dir = locale === 'ur' ? 'rtl' : 'ltr';
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs}<p style="color:#4b5563;font-size:12px">${escape(footer)}</p></body></html>`;
  return { subject, text, html, version: `${template}@${t.version}` };
}
