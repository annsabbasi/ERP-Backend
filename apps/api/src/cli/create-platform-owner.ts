// The first Platform Owner (D5, gap G6):
//   pnpm --filter @erp/api staff:create-owner --email you@example.com --name "Your Name"
// Creates the staff account and e-mails a one-time setup link (72 hours). No password or link
// is ever printed. Refuses when a Platform Owner already exists: later staff come from the
// Console (Stage 4).
import { uuidv7 } from '@erp/contracts';
import { AccountStore } from '../modules/auth/account-store';
import { readAuthConfig } from '../modules/auth/auth.config';
import { LinksService } from '../modules/auth/links.service';
import { MailerService } from '../modules/auth/mailer.service';
import { normalizeEmail } from '../modules/auth/sign-in.service';
import { finish, startCli } from './cli-support';

const SETUP_HOURS = 72;

const { values, db } = startCli('staff:create-owner', {
  email: { type: 'string' },
  name: { type: 'string' },
});

void finish(db, async () => {
  const email = values.email?.trim();
  const name = values.name?.trim();
  if (!email || !name)
    throw new Error('Use: staff:create-owner --email <address> --name "<full name>"');
  const config = readAuthConfig();
  const normalized = normalizeEmail(email);

  const owners = await db.staffRoleAssignment.count({
    where: { roleKey: 'platform_owner', staffUser: { status: { in: ['active', 'invited'] } } },
  });
  const existing = await db.staffUser.findUnique({ where: { emailNormalized: normalized } });
  if (owners > 0 && existing?.status !== 'invited') {
    throw new Error(
      'A Platform Owner already exists; add further staff from the Platform Console.',
    );
  }

  const staff =
    existing ??
    (await db.staffUser.create({
      data: { id: uuidv7(), email, emailNormalized: normalized, name, status: 'invited' },
    }));
  if (!existing) {
    await db.staffRoleAssignment.create({
      data: { staffUserId: staff.id, roleKey: 'platform_owner' },
    });
    await db.$executeRaw`
      SELECT platform.append_audit(${uuidv7()}::uuid, NULL, 'staff.owner_created', NULL,
        'staff_user', ${staff.id}, NULL, ${JSON.stringify({ email, name })}::jsonb,
        'first Platform Owner, created from the command line', NULL)`;
  }

  const token = await new LinksService().issue(
    new AccountStore(db, 'staff'),
    staff.id,
    'setup',
    SETUP_HOURS * 60,
  );
  await new MailerService().send({
    template: 'staff_setup',
    to: email,
    data: { name, link: `${config.consoleUrl}/setup/${token}`, expires_hours: String(SETUP_HOURS) },
  });
  console.log(
    `${existing ? 'A new setup link' : 'The Platform Owner account'} for ${email} is ready; ` +
      `the setup link was e-mailed (valid ${SETUP_HOURS} hours). It is not printed here.`,
  );
});
