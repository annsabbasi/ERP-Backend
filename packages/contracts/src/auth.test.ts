import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  LoginResponseSchema,
  MfaVerifyRequestSchema,
  passwordLength,
  PASSWORD_POLICY,
} from './auth';
import { EmailJobSchema } from './email';

const rule = (password: string, ctx: Parameters<typeof checkPassword>[1], key: string) =>
  checkPassword(password, ctx).find((r) => r.key === key)!.ok;

describe('password policy (Part 05 §5.4)', () => {
  it('needs 15 characters without MFA and 8 with MFA (AC-U01)', () => {
    expect(rule('ten chars!', { mfa: false }, 'length')).toBe(false);
    expect(rule('ten chars!', { mfa: true }, 'length')).toBe(true);
    expect(rule('fifteen chars!!', { mfa: false }, 'length')).toBe(true);
    expect(rule('seven c', { mfa: true }, 'length')).toBe(false);
  });

  it('accepts at least 64 characters, spaces and Unicode, with no composition rules', () => {
    const long = 'a correct horse battery staple '.repeat(3).slice(0, 80);
    expect(checkPassword(long, { mfa: false }).every((r) => r.ok)).toBe(true);
    expect(rule('x'.repeat(PASSWORD_POLICY.max + 1), { mfa: true }, 'max_length')).toBe(false);
    expect(rule('مری چائے بہت گرم ہے', { mfa: false }, 'length')).toBe(true);
  });

  it('counts characters, not bytes, after NFKC normalization', () => {
    expect(passwordLength('ｐａｓｓ')).toBe(4); // full-width letters become "pass"
    expect(passwordLength('😀😀')).toBe(2);
  });

  it('refuses passwords that contain the e-mail name or the company name', () => {
    const ctx = { mfa: true, email: 'imran.khan@alnaik.pk', companyName: 'Al-Naik Foods' };
    expect(rule('my imran.khan pass', ctx, 'not_email')).toBe(false);
    expect(rule('al-naik foods 2026', ctx, 'not_company')).toBe(false);
    expect(rule('green tea at noon', ctx, 'not_email')).toBe(true);
    expect(rule('green tea at noon', ctx, 'not_company')).toBe(true);
  });
});

describe('auth schemas', () => {
  it('tells the three sign-in outcomes apart', () => {
    expect(
      LoginResponseSchema.parse({
        status: 'mfa_required',
        challenge: 'c'.repeat(32),
        methods: ['totp'],
      }),
    ).toMatchObject({ status: 'mfa_required' });
    expect(() => LoginResponseSchema.parse({ status: 'signed_in' })).toThrow();
  });

  it('takes either a code or a recovery code, not both', () => {
    const challenge = 'c'.repeat(32);
    expect(MfaVerifyRequestSchema.safeParse({ challenge, code: '123456' }).success).toBe(true);
    expect(
      MfaVerifyRequestSchema.safeParse({ challenge, recovery_code: 'abcd-efgh-jkmn' }).success,
    ).toBe(true);
    expect(MfaVerifyRequestSchema.safeParse({ challenge }).success).toBe(false);
    expect(
      MfaVerifyRequestSchema.safeParse({
        challenge,
        code: '123456',
        recovery_code: 'abcd-efgh-jkmn',
      }).success,
    ).toBe(false);
  });
});

describe('e-mail jobs', () => {
  it('requires the values each template uses', () => {
    const job = {
      template: 'password_reset',
      to: 'a@example.com',
      data: { name: 'A', link: 'https://x' },
    };
    expect(EmailJobSchema.safeParse(job).success).toBe(false);
    expect(
      EmailJobSchema.parse({ ...job, data: { ...job.data, expires_minutes: '30' } }).locale,
    ).toBe('en');
  });
});
