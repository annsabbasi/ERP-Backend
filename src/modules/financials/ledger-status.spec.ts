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

  const AGGREGATIONS = ['journalLine.groupBy', 'journalLine.aggregate', 'journalLine.findMany'];

  /**
   * The argument block of every journal-line aggregation in a source file.
   *
   * Checking per call rather than per file matters: the first version asked
   * only whether `ledgerStatusWhere` appeared *somewhere* in the file, so a
   * file that used the helper in one query and hard-coded POSTED in another
   * passed clean. Brace-matching from the opening `{` gives each call its own
   * text to judge.
   */
  const aggregationCalls = (src: string): string[] => {
    const blocks: string[] = [];

    for (const marker of AGGREGATIONS) {
      let from = 0;
      for (;;) {
        const hit = src.indexOf(marker, from);
        if (hit === -1) break;
        from = hit + marker.length;

        const open = src.indexOf('{', from);
        if (open === -1) break;

        let depth = 0;
        let end = -1;
        for (let i = open; i < src.length; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        if (end === -1) break;
        blocks.push(src.slice(open, end + 1));
        from = end;
      }
    }
    return blocks;
  };

  const hardCodesPosted = (block: string) =>
    /status:\s*JournalEntryStatus\.POSTED/.test(block) || /status:\s*['"]POSTED['"]/.test(block);

  it('every journalLine aggregation goes through ledgerStatusWhere', () => {
    const offenders: string[] = [];

    for (const file of walk(ROOT)) {
      if (ALLOWED.some((a) => file.includes(a))) continue;
      const src = stripComments(readFileSync(file, 'utf8'));

      for (const block of aggregationCalls(src)) {
        if (hardCodesPosted(block) && !block.includes('ledgerStatusWhere')) {
          offenders.push(file.replace(ROOT, '').replace(/\\/g, '/'));
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The guard is only worth having if it fails on the real mistake.
   *
   * Both cases below are ones an earlier version let through: a file whose
   * prose mentions the helper, and a file that genuinely uses it in one query
   * while hard-coding POSTED in another.
   */
  it('detects a hand-written POSTED filter despite a comment naming the helper', () => {
    const src = stripComments(`
      // ledgerStatusWhere is mentioned here but never called.
      const rows = await this.prisma.journalLine.groupBy({
        where: { entry: { status: JournalEntryStatus.POSTED } },
      });
    `);
    const blocks = aggregationCalls(src);
    expect(blocks).toHaveLength(1);
    expect(hardCodesPosted(blocks[0])).toBe(true);
    expect(blocks[0].includes('ledgerStatusWhere')).toBe(false);
  });

  it('detects a bad query in a file whose other query uses the helper', () => {
    const src = stripComments(`
      const good = await this.prisma.journalLine.groupBy({
        where: { entry: { ...ledgerStatusWhere() } },
      });
      const bad = await this.prisma.journalLine.aggregate({
        where: { entry: { status: JournalEntryStatus.POSTED } },
      });
    `);
    const blocks = aggregationCalls(src);
    expect(blocks).toHaveLength(2);

    const flagged = blocks.filter((b) => hardCodesPosted(b) && !b.includes('ledgerStatusWhere'));
    expect(flagged).toHaveLength(1);
    // File-scoped checking would have found `ledgerStatusWhere` present and
    // passed the whole file.
    expect(src.includes('ledgerStatusWhere')).toBe(true);
  });
});
