// Lint ratchet (QA L1). The repo carries lint debt from before the rule
// existed; this stops it growing without a big-bang reformat.
//
//   node scripts/lint-ratchet.mjs            check: fail if any file has more
//                                            problems than lint-baseline.json
//                                            allows (a file not listed: 0)
//   node scripts/lint-ratchet.mjs --update   rewrite the baseline from the
//                                            current tree — only ever lowers
//                                            counts; refuses to raise one
//
// Counts are errors + warnings per file. Paths are repo-relative, POSIX.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { relative, sep } from 'node:path';

const BASELINE = 'lint-baseline.json';
const update = process.argv.includes('--update');

let raw;
try {
  raw = execSync('npx eslint "{src,apps,libs,test}/**/*.ts" -f json', {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (e) {
  // ESLint exits 1 when it finds problems; the JSON is still on stdout.
  raw = e.stdout;
}
const current = {};
for (const r of JSON.parse(raw)) {
  const n = r.errorCount + r.warningCount;
  if (n) current[relative(process.cwd(), r.filePath).split(sep).join('/')] = n;
}

// ESLint reads the working copy; CI lints the commit. Name any file whose
// count includes uncommitted edits, so a local result is never mistaken for
// CI's (QA review of Step 0).
let uncommitted = new Set();
try {
  uncommitted = new Set(
    execSync('git status --porcelain', { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
      .filter(Boolean),
  );
} catch {
  /* not a git checkout */
}
const wc = (f) => (uncommitted.has(f) ? ' (working copy: uncommitted edits — not what CI sees)' : '');

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

if (update) {
  if (baseline) {
    const raised = Object.entries(current).filter(([f, n]) => n > (baseline[f] ?? 0));
    if (raised.length) {
      for (const [f, n] of raised) console.error(`refusing to raise ${f}: ${baseline[f] ?? 0} -> ${n}${wc(f)}`);
      process.exit(1);
    }
  }
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  const total = Object.values(sorted).reduce((a, n) => a + n, 0);
  console.log(`baseline written: ${Object.keys(sorted).length} files, ${total} problems`);
  process.exit(0);
}

if (!baseline) {
  console.error(`${BASELINE} is missing; create it with --update`);
  process.exit(1);
}
const worse = Object.entries(current).filter(([f, n]) => n > (baseline[f] ?? 0));
const better = Object.entries(baseline).filter(([f, n]) => (current[f] ?? 0) < n);
for (const [f, n] of worse) console.error(`lint got worse: ${f} ${baseline[f] ?? 0} -> ${n}${wc(f)}`);
if (better.length) console.log(`${better.length} file(s) improved — run with --update to lock that in`);
const total = Object.values(current).reduce((a, n) => a + n, 0);
const dirty = [...uncommitted].filter((f) => /\.(ts|tsx)$/.test(f));
if (dirty.length) console.log(`note: linted the working copy; ${dirty.length} file(s) have uncommitted edits: ${dirty.join(', ')}`);
console.log(`lint ratchet: ${worse.length ? 'FAIL' : 'ok'} (${total} problems in ${Object.keys(current).length} files)`);
process.exit(worse.length ? 1 : 0);
