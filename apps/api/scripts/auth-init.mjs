// Local development only: writes the auth secrets into the workspace .env when they are missing
// (an Ed25519 signing key as a JWK set, and a 32-byte encryption key). Hosted environments set
// them in the platform's variables (ADR 0008). Never prints a secret.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '../../../.env');
if (!existsSync(envPath)) {
  console.error('auth:init: no .env yet; copy .env.example to .env first');
  process.exit(1);
}
const env = readFileSync(envPath, 'utf8');
const value = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
const localOnly = process.env.NODE_ENV !== 'production' && value('LOCAL_ONLY') !== '0';
if (!localOnly) {
  console.error('auth:init: runs only in local-only mode');
  process.exit(1);
}

const added = [];
if (!value('AUTH_JWKS')) {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = {
    ...privateKey.export({ format: 'jwk' }),
    kid: randomUUID(),
    alg: 'EdDSA',
    use: 'sig',
  };
  appendFileSync(
    envPath,
    `\n# Local signing key for access tokens (auth:init; ADR 0008)\nAUTH_JWKS=${JSON.stringify({ keys: [jwk] })}\n`,
  );
  added.push('AUTH_JWKS');
}
if (!value('AUTH_ENCRYPTION_KEY')) {
  appendFileSync(
    envPath,
    `# Local key for MFA secrets (auth:init)\nAUTH_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}\n`,
  );
  added.push('AUTH_ENCRYPTION_KEY');
}
console.log(
  added.length
    ? `auth:init: added ${added.join(' and ')} to .env`
    : 'auth:init: .env already has the auth keys',
);
