import { randomInt } from 'node:crypto';
import { hmac } from './crypto';

// Recovery codes (§5.3.9): 10 single-use codes of 10 Crockford Base32 characters (50 bits),
// shown once as "ABCDE-FGHJK". Stored as an HMAC under a server key, so a copied table is
// not enough to try codes offline.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let code = '';
    for (let i = 0; i < 10; i++) code += ALPHABET[randomInt(32)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** How people type them: any case, spaces or dashes, O for 0 and I or L for 1. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function hashRecoveryCode(key: Buffer, input: string): string {
  return hmac(key, normalizeRecoveryCode(input));
}
