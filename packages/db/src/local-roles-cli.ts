// pnpm --filter @erp/db db:local-roles — local and CI only (see roles.ts).
import { enableLocalLoginRoles } from './roles';

try {
  process.loadEnvFile('../../.env');
} catch {
  // no .env file: use the environment as it is
}

enableLocalLoginRoles(process.env)
  .then((roles) => console.log(`db:local-roles: ${roles.join(' and ')} can sign in`))
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
