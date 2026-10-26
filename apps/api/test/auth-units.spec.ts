import { randomBytes } from 'node:crypto';
import { decrypt, deriveKey, encrypt, randomToken, sha256 } from '../src/modules/auth/crypto';
import {
  assertPasswordAllowed,
  hashPassword,
  isCommonPassword,
  needsRehash,
  singleFactorOk,
  verifyPassword,
} from '../src/modules/auth/passwords';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
} from '../src/modules/auth/recovery-codes';
import { failureDelay, normalizeEmail } from '../src/modules/auth/sign-in.service';
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  timeStep,
  verifyTotp,
} from '../src/modules/auth/totp';

describe('TOTP (RFC 6238 appendix B, SHA-1)', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at %i seconds gives %s', (seconds, code) => {
    expect(hotp(secret, timeStep(new Date(seconds * 1000)), 8)).toBe(code);
  });

  it('accepts one step of drift either side, and each code once', () => {
    const at = new Date(1_234_567_890_000);
    const step = timeStep(at);
    const code = hotp(secret, step);
    expect(verifyTotp(secret, code, { at })).toBe(step);
    expect(verifyTotp(secret, hotp(secret, step - 1n), { at })).toBe(step - 1n);
    expect(verifyTotp(secret, hotp(secret, step + 2n), { at })).toBeNull();
    expect(verifyTotp(secret, code, { at, lastStep: step })).toBeNull(); // replay
    expect(verifyTotp(secret, 'abcdef', { at })).toBeNull();
  });

  it('round-trips base32 and builds an otpauth URI apps understand', () => {
    const key = randomBytes(20);
    expect(base32Decode(base32Encode(key)).equals(key)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    const uri = new URL(otpauthUri(key, 'ERP System', 'sana@example.com'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(key));
    expect(uri.searchParams.get('issuer')).toBe('ERP System');
  });
});

describe('crypto helpers', () => {
  it('encrypts with AES-256-GCM and refuses a changed ciphertext', () => {
    const key = deriveKey(randomBytes(32), 'test');
    const sealed = encrypt(key, Buffer.from('secret'));
    expect(decrypt(key, sealed).toString()).toBe('secret');
    const last = sealed.length - 1;
    sealed[last] = sealed[last]! ^ 1;
    expect(() => decrypt(key, sealed)).toThrow();
  });

  it('derives a different key for each purpose', () => {
    const master = randomBytes(32);
    expect(deriveKey(master, 'a').equals(deriveKey(master, 'b'))).toBe(false);
  });

  it('makes 256-bit tokens and stores only their SHA-256', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(sha256(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('recovery codes', () => {
  it('makes 10 different codes of 10 characters', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('accepts them as people type them', () => {
    expect(normalizeRecoveryCode(' abcde-fgh0l ')).toBe('ABCDEFGH01');
    expect(normalizeRecoveryCode('OOIIL')).toBe('00111');
    const key = randomBytes(32);
    expect(hashRecoveryCode(key, 'ABCDE-FGH01')).toBe(hashRecoveryCode(key, 'abcde fgh0l'));
  });
});

describe('passwords (Part 05 §5.4)', () => {
  it('hashes with Argon2id at the OWASP minimum and verifies', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(needsRehash(stored)).toBe(false);
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'Correct horse battery staple')).toBe(false);
  });

  it('asks for a new hash when the parameters are weaker or the algorithm differs', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$c2FsdA$aGFzaA')).toBe(true);
    expect(needsRehash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
  });

  it('refuses common passwords whatever their case', () => {
    expect(isCommonPassword('password')).toBe(true);
    expect(isCommonPassword('PASSWORD')).toBe(true);
    expect(isCommonPassword('green tea at noon in lahore')).toBe(false);
  });

  it('names every broken rule as a field error (AC-U01)', () => {
    let caught: unknown;
    try {
      assertPasswordAllowed('password', { mfa: false, email: 'sana@example.com' });
    } catch (error) {
      caught = error;
    }
    const errors = (caught as { options: { errors: { code: string }[] } }).options.errors;
    expect(errors.map((e) => e.code).sort()).toEqual(['length', 'not_common']);
    expect(() => assertPasswordAllowed('ten chars!', { mfa: true })).not.toThrow();
    expect(() => assertPasswordAllowed('ten chars!', { mfa: false })).toThrow();
  });

  it('records whether a password may be used without MFA (gap G16)', () => {
    expect(singleFactorOk('ten chars!')).toBe(false);
    expect(singleFactorOk('fifteen chars!!')).toBe(true);
  });
});

describe('sign-in helpers', () => {
  it('waits longer after each failure from the fourth on, up to 8 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map((n) => failureDelay(n, 500))).toEqual([
      0, 0, 0, 500, 1000, 2000, 8000,
    ]);
    expect(failureDelay(9, 0)).toBe(0);
  });

  it('compares e-mail addresses without case or spaces', () => {
    expect(normalizeEmail('  Sana@Example.COM ')).toBe('sana@example.com');
  });
});
