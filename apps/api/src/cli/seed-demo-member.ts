// Local development only: a demo member who works for one or two demo companies, to try
// sign-in before onboarding exists (Stage 5):
//   pnpm --filter @erp/api dev:seed-member --email demo@erp.local --name "Demo User" [--two-companies]
// The member chooses their password from a link e-mailed to Mailpit (http://localhost:8025).
import { generateTenantCode, uuidv7 } from '@erp/contracts';
import { isLocalOnly, type PrismaClient } from '@erp/db';
import { AccountStore } from '../modules/auth/account-store';
import { readAuthConfig } from '../modules/auth/auth.config';
import { LinksService } from '../modules/auth/links.service';
import { MailerService } from '../modules/auth/mailer.service';
import { normalizeEmail } from '../modules/auth/sign-in.service';
import { finish, startCli } from './cli-support';

const SETUP_HOURS = 72;
const COMPANIES = [
  { slug: 'demo-restaurant', name: 'Demo Restaurant', industry: 'restaurant', branch: 'Gulberg' },
  { slug: 'demo-school', name: 'Demo School', industry: 'school', branch: 'Main Campus' },
];

const { values, db } = startCli('dev:seed-member', {
  email: { type: 'string' },
  name: { type: 'string' },
  'two-companies': { type: 'boolean' },
});

/** The demo company with this slug, created on first use. */
async function company(db: PrismaClient, c: (typeof COMPANIES)[number]): Promise<string> {
  const found = await db.tenant.findUnique({ where: { slug: c.slug } });
  if (found) return found.id;
  const id = uuidv7();
  const code = await generateTenantCode(async (candidate) =>
    Boolean(await db.tenant.findUnique({ where: { code: candidate } })),
  );
  await db.$transaction(async (tx) => {
    await tx.tenant.create({
      data: {
        id,
        code,
        slug: c.slug,
        displayName: c.name,
        legalName: `${c.name} (Pvt) Ltd`,
        country: 'PK',
        baseCurrency: 'PKR',
        timezone: 'Asia/Karachi',
        industryKey: c.industry,
        status: 'active',
        region: 'ap-southeast-1',
      },
    });
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    const legalEntity = uuidv7();
    await tx.$executeRaw`
      INSERT INTO app.legal_entities (id, tenant_id, legal_name, base_currency)
      VALUES (${legalEntity}::uuid, ${id}::uuid, ${`${c.name} (Pvt) Ltd`}, 'PKR')`;
    await tx.$executeRaw`
      INSERT INTO app.branches (id, tenant_id, legal_entity_id, name, code, type)
      VALUES (${uuidv7()}::uuid, ${id}::uuid, ${legalEntity}::uuid, ${c.branch}, 'MAIN',
              ${c.industry === 'school' ? 'campus' : 'outlet'})`;
  });
  return id;
}

void finish(db, async () => {
  if (!isLocalOnly(process.env)) throw new Error('dev:seed-member runs only in local-only mode');
  const email = values.email?.trim() ?? 'demo@erp.local';
  const name = values.name?.trim() ?? 'Demo User';
  const normalized = normalizeEmail(email);

  const user =
    (await db.user.findUnique({
      where: {
        emailNormalized_accountKind: { emailNormalized: normalized, accountKind: 'member' },
      },
    })) ??
    (await db.user.create({
      data: { id: uuidv7(), email, emailNormalized: normalized, name, status: 'active' },
    }));

  for (const c of COMPANIES.slice(0, values['two-companies'] ? 2 : 1)) {
    const tenantId = await company(db, c);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`
        INSERT INTO app.memberships (id, tenant_id, user_id, kind, display_name, status)
        VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${user.id}::uuid, 'member', ${name}, 'active')
        ON CONFLICT (tenant_id, user_id) DO NOTHING`;
    });
  }

  const config = readAuthConfig();
  const token = await new LinksService().issue(
    new AccountStore(db, 'member'),
    user.id,
    'setup',
    SETUP_HOURS * 60,
  );
  await new MailerService().send({
    template: 'account_setup',
    to: email,
    data: { name, link: `${config.webUrl}/reset/${token}`, expires_hours: String(SETUP_HOURS) },
  });
  console.log(
    `Demo member ${email} is ready in ${values['two-companies'] ? 'two companies' : 'one company'}; ` +
      'open Mailpit (http://localhost:8025) for the link that sets the password.',
  );
});
