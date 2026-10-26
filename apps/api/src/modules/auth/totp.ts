import { createHmac, randomBytes } from 'node:crypto';

// TOTP (RFC 6238 over RFC 4226 HOTP): SHA-1, 6 digits, 30-second steps, the form every
// authenticator app understands (§10.6).

const PERIOD = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (RFC 4226 recommends at least 128). */
export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function hotp(secret: Buffer, counter: bigint, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(at: Date = new Date()): bigint {
  return BigInt(Math.floor(at.getTime() / 1000 / PERIOD));
}

/**
 * The time step a code belongs to, or null. One step either side is accepted for clock drift,
 * and a step at or before `lastStep` is refused, so a code works once.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  options: { at?: Date; lastStep?: bigint | null; window?: number } = {},
): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = timeStep(options.at);
  const window = BigInt(options.window ?? 1);
  for (let step = now - window; step <= now + window; step++) {
    if (options.lastStep != null && step <= options.lastStep) continue;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

export function otpauthUri(secret: Buffer, issuer: string, account: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
