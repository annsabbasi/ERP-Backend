import {
  checkPassword,
  normalizePassword,
  passwordLength,
  PASSWORD_POLICY,
  type PasswordContext,
  type PasswordRule,
} from '@erp/contracts';
import { hash, verify } from '@node-rs/argon2';
import { dictionary } from '@zxcvbn-ts/language-common';
import { ProblemException } from '../../common/problem';

// Password storage and policy (Part 05 §5.4, OWASP Password Storage Cheat Sheet).

/** Argon2id at the OWASP minimum: 19 MiB, 2 iterations, parallelism 1. */
export const ARGON2_PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const ARGON2_ALGORITHM = 'argon2id';

/** The Argon2id hash (PHC string: the parameters are stored in it). */
export function hashPassword(password: string): Promise<string> {
  // Algorithm.Argon2id is 2 in @node-rs/argon2; the PHC string records it as well.
  return hash(normalizePassword(password), { ...ARGON2_PARAMS, algorithm: 2 });
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, normalizePassword(password));
  } catch {
    return false;
  }
}

/** A hash made with weaker parameters than today's is replaced at the next sign-in. */
export function needsRehash(stored: string): boolean {
  const m = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!m) return true;
  return (
    Number(m[1]) < ARGON2_PARAMS.memoryCost ||
    Number(m[2]) < ARGON2_PARAMS.timeCost ||
    Number(m[3]) !== ARGON2_PARAMS.parallelism
  );
}

/** Verified when an e-mail has no account, so both cases take the same time (§5.3.4). */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('no account has this password, it only takes time');
  return dummyHash;
}

/** The 49,233 most common passwords (zxcvbn-ts common list), compared without case. */
const COMMON = new Set(
  (dictionary['passwords-common'] as string[]).map((p) => normalizePassword(p).toLowerCase()),
);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(normalizePassword(password).toLowerCase());
}

/** All rules, including the common-password list that only the server holds. */
export function passwordRules(password: string, context: PasswordContext): PasswordRule[] {
  return [
    ...checkPassword(password, context),
    { key: 'not_common', ok: !isCommonPassword(password) },
  ];
}

/** Throws 400 validation_failed, one error per broken rule, for the field `field`. */
export function assertPasswordAllowed(
  password: string,
  context: PasswordContext,
  field = 'password',
): void {
  const broken = passwordRules(password, context).filter((r) => !r.ok);
  if (broken.length === 0) return;
  const messages: Record<string, string> = {
    length: `Use at least ${context.mfa ? PASSWORD_POLICY.minWithMfa : PASSWORD_POLICY.minWithoutMfa} characters`,
    max_length: `Use at most ${PASSWORD_POLICY.max} characters`,
    not_email: 'Do not use your e-mail address in the password',
    not_company: 'Do not use the company name in the password',
    not_common: 'This password is too common; choose another',
  };
  throw new ProblemException('validation_failed', 'The password does not meet the rules', {
    errors: broken.map((r) => ({ field, message: messages[r.key] ?? r.key, code: r.key })),
  });
}

/** Long enough to be used without MFA (gap G16). */
export function singleFactorOk(password: string): boolean {
  return passwordLength(password) >= PASSWORD_POLICY.minWithoutMfa;
}
