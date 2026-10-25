import { z } from 'zod';

// Identifiers (Part 02 §2.8). Shared with the clients so that offline devices can create
// records with their own ids (Part 11 §11.1).

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** A UUID version 7 (RFC 9562): 48-bit Unix time in ms, then 74 random bits. Sorts by time. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f); // version 7
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Crockford Base32 without I, L, O and U (§2.8). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const TENANT_CODE_PATTERN = /^T-[0-9A-HJKMNP-TV-Z]{6}$/;

/** A random tenant code such as T-8K2M9Q. Uniqueness is checked by the caller. */
export function randomTenantCode(): string {
  const bytes = randomBytes(6);
  return `T-${Array.from(bytes, (b) => CROCKFORD_ALPHABET[b % 32]).join('')}`;
}

/**
 * A tenant code that `isTaken` reports as free. Collisions are rare (32^6 ≈ 1.07 billion
 * codes), so a few attempts are plenty; running out means something is wrong.
 */
export async function generateTenantCode(
  isTaken: (code: string) => Promise<boolean>,
  attempts = 10,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = randomTenantCode();
    if (!(await isTaken(code))) return code;
  }
  throw new Error(`No free tenant code after ${attempts} attempts`);
}

/** Slugs that are part of our own addresses (Part 03 §3.6, step 1). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'console',
  'admin',
  'app',
  'mail',
  'status',
  'help',
]);

/** 3–40 characters: a–z, 0–9 and hyphens, starting and ending with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export type SlugProblem = 'format' | 'reserved';

/** Why a slug is not allowed, or undefined when it is. */
export function slugProblem(slug: string): SlugProblem | undefined {
  if (!SLUG_PATTERN.test(slug)) return 'format';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return undefined;
}

export const SlugSchema = z
  .string()
  .regex(SLUG_PATTERN, '3–40 characters: lowercase letters, digits and hyphens, not at either end')
  .refine((slug) => !RESERVED_SLUGS.has(slug), 'This web address is reserved');

export const TenantCodeSchema = z.string().regex(TENANT_CODE_PATTERN);

export const UuidSchema = z.uuid();
