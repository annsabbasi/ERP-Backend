import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JournalEntryStatus } from '@prisma/client';
import { LEDGER_STATUSES, ledgerStatusWhere } from './ledger-status';

describe('ledgerStatusWhere', () => {
  it('counts REVERSED entries as ledger movement', () => {
    // Reversing posts a mirror entry and keeps the original. Excluding REVERSED
    // drops the original while keeping its mirror, so the pair stops netting to
    // zero and every total shifts by the reversal amount.
    expect(LEDGER_STATUSES).toContain(JournalEntryStatus.REVERSED);
    expect(LEDGER_STATUSES).toContain(JournalEntryStatus.POSTED);
  });

  it('excludes DRAFT by default', () => {
    expect(LEDGER_STATUSES).not.toContain(JournalEntryStatus.DRAFT);
    expect(ledgerStatusWhere()).toEqual({
      status: { in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED] },
    });
  });

  it('drops the filter entirely when unposted entries are wanted', () => {
    expect(ledgerStatusWhere(true)).toEqual({});
  });
});

/**
 * A source-level guard, not a behavioural test.
 *
 * `status: JournalEntryStatus.POSTED` inside a journal-line aggregation is the
 * single mistake this module exists to prevent, and it is invisible in review
 * because the wrong code reads as more obviously correct than the right code —
 * "only count posted entries" sounds like exactly what you want. It shipped
 * once already, in Period-End Closing, where it would have posted a fabricated
 * retained-earnings figure that balanced perfectly.
 *
 * Catching it by grep is blunt, but it is the only check that covers code
 * nobody has written yet.
 */
describe('no hand-written POSTED filter on ledger aggregations', () => {
  const ROOT = join(__dirname, '..', '..');

  /** Files allowed to name POSTED directly: they set status, not filter on it. */
  const ALLOWED = [
    join('financials', 'ledger-status.ts'),
    join('financials', 'journal-entries', 'journal-entries.service.ts'),
    join('financials', 'ar-ap'),
    join('financials', 'fixed-assets'),
  ];

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full, out);
      } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
    return out;
  };

  /**
   * Comments are stripped before anything is matched.
   *
   * Without this the guard is trivially defeated by prose: the first version
   * looked for the string `ledgerStatusWhere` anywhere in the file, so a comment
   * *explaining* that the helper must be used counted as using it. Reintroducing
   * the real bug left that comment in place and the test went green — a guard
   * that cannot fail, which is worse than no guard because it reads as coverage.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('every journalLine aggregation goes through ledgerStatusWhere', () => {
    const offenders: string[] = [];

    for (const file of walk(ROOT)) {
      if (ALLOWED.some((a) => file.includes(a))) continue;
      const src = stripComments(readFileSync(file, 'utf8'));

      // Only files that aggregate journal lines are in scope. A service that
      // merely reads one entry by id is not making a balance.
      const aggregates =
        src.includes('journalLine.groupBy') ||
        src.includes('journalLine.aggregate') ||
        src.includes('journalLine.findMany');
      if (!aggregates) continue;

      const hardCodesPosted =
        /status:\s*JournalEntryStatus\.POSTED/.test(src) ||
        /status:\s*['"]POSTED['"]/.test(src);

      if (hardCodesPosted && !src.includes('ledgerStatusWhere')) {
        offenders.push(file.replace(ROOT, '').replace(/\\/g, '/'));
      }
    }

    expect(offenders).toEqual([]);
  });

  /** The guard above is only worth having if it fails on the real mistake. */
  it('the guard itself detects a hand-written POSTED filter', () => {
    const bad = stripComments(`
      // ledgerStatusWhere is mentioned here but never called.
      const rows = await this.prisma.journalLine.groupBy({
        where: { entry: { status: JournalEntryStatus.POSTED } },
      });
    `);
    expect(bad.includes('journalLine.groupBy')).toBe(true);
    expect(/status:\s*JournalEntryStatus\.POSTED/.test(bad)).toBe(true);
    expect(bad.includes('ledgerStatusWhere')).toBe(false);
  });
});
