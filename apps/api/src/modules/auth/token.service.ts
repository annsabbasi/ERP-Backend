import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccessTokenClaims, Audience } from '@erp/contracts';
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWK,
  type KeyObject,
} from 'jose';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';

// Access tokens (§10.6): EdDSA (Ed25519) JWTs with a key id, 10 minutes, one issuer and one
// audience per realm, so a staff token is refused on company routes and the other way round.

type Key = { kid: string; privateKey: CryptoKey | KeyObject; publicJwk: JWK };

export type TokenInput = Omit<AccessTokenClaims, 'iss' | 'iat' | 'exp'>;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private keys?: Promise<Key[]>;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  issuer(aud: Audience): string {
    return aud === 'console'
      ? `${this.config.apiUrl}/api/platform/v1/auth`
      : `${this.config.apiUrl}/api/v1/auth`;
  }

  async sign(claims: TokenInput): Promise<{ token: string; expiresIn: number }> {
    const [key] = await this.loadKeys();
    const { sub, aud, ...rest } = claims;
    const token = await new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'EdDSA', kid: key!.kid, typ: 'at+jwt' })
      .setSubject(sub)
      .setAudience(aud)
      .setIssuer(this.issuer(aud))
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenSeconds}s`)
      .sign(key!.privateKey);
    return { token, expiresIn: this.config.accessTokenSeconds };
  }

  /** The claims of a valid token for `aud`, or null (bad signature, expired, other audience). */
  async verify(token: string, aud: Audience): Promise<AccessTokenClaims | null> {
    const keys = await this.loadKeys();
    try {
      const { payload } = await jwtVerify(
        token,
        async (header) => {
          const key = keys.find((k) => k.kid === header.kid);
          if (!key) throw new Error('unknown key');
          return importJWK(key.publicJwk, 'EdDSA');
        },
        {
          algorithms: ['EdDSA'],
          audience: aud,
          issuer: this.issuer(aud),
          typ: 'at+jwt',
          clockTolerance: 5,
        },
      );
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return payload as unknown as AccessTokenClaims;
    } catch {
      return null;
    }
  }

  /** Public keys only, for /auth/jwks. */
  async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: (await this.loadKeys()).map((k) => k.publicJwk) };
  }

  private loadKeys(): Promise<Key[]> {
    this.keys ??= this.readKeys();
    return this.keys;
  }

  private async readKeys(): Promise<Key[]> {
    if (!this.config.jwks?.keys.length) {
      // Local-only mode without keys in .env (readAuthConfig refuses this elsewhere): one key for
      // this process. Tokens then end with it; `pnpm local:up` writes a lasting key instead.
      this.logger.warn('AUTH_JWKS is not set: using a temporary signing key for this process');
      const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
      const publicJwk = {
        ...(await exportJWK(publicKey)),
        kid: 'temporary',
        alg: 'EdDSA',
        use: 'sig',
      };
      return [{ kid: 'temporary', privateKey, publicJwk }];
    }
    return Promise.all(
      this.config.jwks.keys.map(async (jwk) => {
        const kid = String(jwk.kid);
        const privateKey = (await importJWK(jwk as JWK, 'EdDSA')) as CryptoKey;
        const { d: _d, ...rest } = jwk as JWK;
        void _d;
        return { kid, privateKey, publicJwk: { ...rest, alg: 'EdDSA', use: 'sig' } };
      }),
    );
  }
}
