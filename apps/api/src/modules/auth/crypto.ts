import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// Small, audited building blocks; nothing here logs or returns a secret it did not create.

/** 32 random bytes as base64url: refresh tokens, link tokens, MFA challenges (§10.6). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored as their SHA-256 only. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A sub-key for one purpose, so one secret never serves two. */
export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `erp:${purpose}`, 32));
}

export function hmac(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

const VERSION = 1;

/** AES-256-GCM: version (1) | IV (12) | tag (16) | ciphertext. */
export function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decrypt(key: Buffer, sealed: Buffer): Buffer {
  if (sealed[0] !== VERSION) throw new Error('unknown ciphertext version');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]);
}
