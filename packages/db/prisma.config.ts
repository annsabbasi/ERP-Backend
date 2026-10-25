import { defineConfig, env } from 'prisma/config';
import { assertLocalOnly } from './src/local-only';
import { assertLocalForDestructive } from './src/migration-guard';

// Prisma does not read .env files itself. In local development the
// workspace .env provides the URLs; hosted services set them directly.
try {
  process.loadEnvFile('../../.env');
} catch {
  // no .env file: use the environment as it is
}

// Migrations use the direct connection; DATABASE_URL may be a pooler.
const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

// Prisma loads this file before every command, so both guards cover direct
// `prisma …` calls as well as the package scripts. In local-only mode no Prisma
// command runs at all, `migrate deploy` included, unless every URL is local.
assertLocalOnly(process.env, `"prisma ${process.argv.slice(2).join(' ')}"`);
assertLocalForDestructive(process.argv, migrationUrl);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: migrationUrl ?? env('DATABASE_URL') },
});
