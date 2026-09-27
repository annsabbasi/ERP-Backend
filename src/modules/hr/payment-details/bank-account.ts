/**
 * Bank account number rules for employee payment details. Pure functions, so
 * the rules are unit-tested without a database.
 */

/** Strips spaces and dashes and upper-cases, the form an IBAN is stored in. */
export const normalizeIban = (raw: string) => raw.replace(/[\s-]+/g, '').toUpperCase();

/** Account numbers keep dashes (some banks print them) but lose spaces. */
export const normalizeAccountNo = (raw: string) => raw.replace(/\s+/g, '');

/**
 * Lengths for the countries this ERP's tenants use; any other country is held
 * to the generic 15–34 characters. PK IBANs are 24 (PKkk bbbb nnnn nnnn nnnn nnnn).
 */
const IBAN_LENGTH: Record<string, number> = { PK: 24, AE: 23, SA: 24, GB: 22, DE: 22 };

/**
 * ISO 13616: format, country length, and the mod-97 check digits. Returns the
 * reason it is invalid, or null when it is valid. The mod-97 check is what
 * catches a mistyped digit, which a format check alone lets through.
 */
export function ibanProblem(iban: string): string | null {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return 'An IBAN is 2 letters (the country), 2 check digits, then 11–30 letters or digits.';
  }
  const expected = IBAN_LENGTH[iban.slice(0, 2)];
  if (expected && iban.length !== expected) {
    return `A ${iban.slice(0, 2)} IBAN is ${expected} characters; this one has ${iban.length}.`;
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1 ? null : 'The IBAN check digits do not match — a character is probably mistyped.';
}

/** Last four characters shown, the rest starred — how lists and logs show them. */
export function maskTail(v: string | null | undefined): string | null {
  if (v == null) return null;
  return v.length <= 4 ? '*'.repeat(v.length) : '*'.repeat(v.length - 4) + v.slice(-4);
}
