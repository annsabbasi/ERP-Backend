// Prisma commands that can drop data. They may only run against a local
// database; every other database gets `prisma migrate deploy` only.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const DESTRUCTIVE_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ['migrate', 'dev'],
  ['migrate', 'reset'],
  ['db', 'push'],
];

/** The destructive command in a Prisma CLI argument list, if any. */
export function destructiveCommand(argv: readonly string[]): string | undefined {
  const words = argv.filter((arg) => !arg.startsWith('-'));
  for (const [first, second] of DESTRUCTIVE_COMMANDS) {
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === first && words[i + 1] === second) return `${first} ${second}`;
    }
  }
  return undefined;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Throws before Prisma connects when a destructive command targets a non-local host. */
export function assertLocalForDestructive(argv: readonly string[], url: string | undefined): void {
  const command = destructiveCommand(argv);
  if (!command) return;
  const host = hostOf(url);
  if (host && LOCAL_HOSTS.has(host)) return;
  throw new Error(
    `Refusing "prisma ${command}": the database host is "${host ?? 'unknown'}". ` +
      `It is allowed only against localhost. Use "pnpm --filter @erp/db db:migrate:deploy" for any other database.`,
  );
}
