// Lists ESLint problems that sit on lines changed since <base>, per file.
//   node scripts/lint-on-changed-lines.mjs <base> [files…]
// Used to clean up exactly what a branch introduced, without reformatting
// lines it never touched.
import { execFileSync } from 'node:child_process';

const [base, ...only] = process.argv.slice(2);
if (!base) {
  console.error('usage: node scripts/lint-on-changed-lines.mjs <base> [files…]');
  process.exit(2);
}
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
const files = only.length
  ? only
  : git('diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`, '--', '*.ts').split('\n').filter(Boolean);

let total = 0;
for (const file of files) {
  const changed = new Set();
  for (const m of git('diff', '-U0', base, '--', file).matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) changed.add(start + i);
  }
  let out = '[]';
  try {
    out = execFileSync('npx', ['eslint', '-f', 'json', file], { encoding: 'utf8', shell: true });
  } catch (e) {
    out = e.stdout;
  }
  const msgs = JSON.parse(out)[0]?.messages ?? [];
  const hits = msgs.filter((m) => changed.has(m.line));
  total += hits.length;
  for (const m of hits) console.log(`${file}:${m.line}:${m.column} ${m.ruleId} ${m.message}`);
}
console.log(`${total} problem(s) on changed lines`);
process.exit(total ? 1 : 0);
