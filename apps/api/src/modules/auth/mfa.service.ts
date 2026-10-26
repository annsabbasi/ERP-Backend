import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import type { AccountStore } from './account-store';
import { decrypt, deriveKey, encrypt } from './crypto';
import { hashRecoveryCode, newRecoveryCodes } from './recovery-codes';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp';

// TOTP factors and recovery codes (§5.3.9, §10.6). Secrets are kept encrypted (AES-256-GCM);
// recovery codes as keyed hashes; a code is accepted once.

@Injectable()
export class MfaService {
  private readonly secretKey: Buffer;
  private readonly codeKey: Buffer;

  constructor(@Inject(AUTH_CONFIG) config: AuthConfig) {
    // Local-only mode without a key in .env: one for this process (enrolments end with it).
    const master = config.encryptionKey ?? randomBytes(32);
    this.secretKey = deriveKey(master, 'totp-secrets');
    this.codeKey = deriveKey(master, 'recovery-codes');
  }

  /** The confirmed TOTP factor, if any. */
  activeFactor(store: AccountStore, userId: string) {
    return store.t.mfaFactor.findFirst({
      where: { userId, kind: 'totp', confirmedAt: { not: null }, disabledAt: null },
    });
  }

  async isEnrolled(store: AccountStore, userId: string): Promise<boolean> {
    return (await this.activeFactor(store, userId)) !== null;
  }

  /** Starts an enrolment: a new secret, stored but not active until a code confirms it. */
  async startEnrolment(store: AccountStore, userId: string, account: string, issuer: string) {
    await store.t.mfaFactor.deleteMany({ where: { userId, confirmedAt: null } });
    const secret = newTotpSecret();
    const factor = await store.t.mfaFactor.create({
      data: {
        userId,
        kind: 'totp',
        secret: new Uint8Array(encrypt(this.secretKey, secret)),
        label: 'Authenticator app',
      },
    });
    return { factorId: factor.id, secret, uri: otpauthUri(secret, issuer, account) };
  }

  /** Confirms the pending enrolment with a first code; returns the new recovery codes. */
  async confirmEnrolment(
    store: AccountStore,
    userId: string,
    code: string,
  ): Promise<string[] | null> {
    const pending = await store.t.mfaFactor.findFirst({
      where: { userId, kind: 'totp', confirmedAt: null, disabledAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending?.secret) return null;
    const step = verifyTotp(decrypt(this.secretKey, Buffer.from(pending.secret)), code);
    if (step === null) return null;
    const now = new Date();
    await store.t.mfaFactor.updateMany({
      where: { userId, kind: 'totp', confirmedAt: { not: null }, disabledAt: null },
      data: { disabledAt: now },
    });
    await store.t.mfaFactor.update({
      where: { id: pending.id },
      data: { confirmedAt: now, lastUsedAt: now, lastUsedStep: step },
    });
    return this.replaceRecoveryCodes(store, userId);
  }

  /** Checks a TOTP code or a recovery code against the active factor, once. */
  async check(
    store: AccountStore,
    userId: string,
    input: { code?: string; recovery_code?: string },
  ): Promise<'otp' | 'recovery' | null> {
    if (input.code) {
      const factor = await this.activeFactor(store, userId);
      if (!factor?.secret) return null;
      const step = verifyTotp(decrypt(this.secretKey, Buffer.from(factor.secret)), input.code, {
        lastStep: factor.lastUsedStep,
      });
      if (step === null) return null;
      // Conditional update: two requests with the same code cannot both succeed.
      const used = await store.t.mfaFactor.updateMany({
        where: { id: factor.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
        data: { lastUsedStep: step, lastUsedAt: new Date() },
      });
      return used.count === 1 ? 'otp' : null;
    }
    if (input.recovery_code) {
      const used = await store.t.recoveryCode.updateMany({
        where: {
          userId,
          codeHash: hashRecoveryCode(this.codeKey, input.recovery_code),
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      return used.count === 1 ? 'recovery' : null;
    }
    return null;
  }

  async replaceRecoveryCodes(store: AccountStore, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await store.t.recoveryCode.deleteMany({ where: { userId } });
    await store.t.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(this.codeKey, code) })),
    });
    return codes;
  }

  async disable(store: AccountStore, userId: string): Promise<void> {
    await store.t.mfaFactor.updateMany({
      where: { userId, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    await store.t.recoveryCode.deleteMany({ where: { userId } });
  }
}
