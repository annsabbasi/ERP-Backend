// Field Register (QA E9): every field on every HR-Payroll, Banking-setup,
// G/L Determination and Payment Details window, with the evidence that it is
// used — or the decision that schedules or removes it.
//
//   node scripts/field-register.mjs            write docs/payroll-field-register.md
//   node scripts/field-register.mjs --check    exit 1 if any field is unreviewed
//
// Evidence is computed from the code, not typed: the DB column comes from
// prisma/schema.prisma, "DTO" is whether a request DTO accepts the field, and
// "Read by" lists the backend functions that read it (file:function), found by
// searching for `.field` outside DTOs, specs and the schema. The status of each
// field is the reviewed judgement in docs/field-register.status.json:
//   Used                  — drives behaviour (the readers say where)
//   Scheduled: QA Dn …    — stored only today; built in the named step
//   Removed               — dropped from the screen (and, where safe, the table)
//   System                — ids, tenancy, audit stamps, mirror columns
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const WINDOWS = [
  ['HR Payroll → Masters → Employee Current Information', ['Employee']],
  ['HR Payroll → Masters → Employee Current Information → Payment Details', ['EmployeePaymentDetail']],
  ['HR Payroll → Masters → Pay Period Master', ['PayPeriod']],
  ['HR Payroll → Masters → Grade Master', ['Grade']],
  ['HR Payroll → Masters → Grade Pay Scale', ['GradePayScaleStage']],
  ['HR Payroll → Masters → Loan Master', ['LoanType']],
  ['HR Payroll → Masters → Leave Master', ['LeaveType']],
  ['HR Payroll → Masters → Employee Category Master', ['EmployeeCategory']],
  ['HR Payroll → Masters → Shift Master', ['Shift']],
  ['HR Payroll → Masters → TaxFormulaMaster', ['TaxFormula', 'TaxSlab']],
  ['HR Payroll → Transaction → Monthly Attendance Sheet', ['MonthlyAttendanceSheet', 'AttendanceSheetLine']],
  ['HR Payroll → Transaction → Payroll Process', ['PayrollRun', 'PayrollRunLine']],
  ['HR Payroll → Transaction → Loan Application', ['EmployeeLoan', 'EmployeeLoanInstallment']],
  ['HR Payroll → Transaction → Leave Application', ['LeaveRequest']],
  ['HR Payroll → Transaction → Payroll Monthly Adjustments', ['PayrollAdjustment', 'PayrollAdjustmentLine']],
  ['Administration → Setup → Banking → Banks', ['Bank']],
  ['Administration → Setup → Banking → House Bank Accounts', ['HouseBankAccount']],
  ['Administration → Setup → Banking → Payment Methods', ['PaymentMethod']],
  ['Administration → Setup → Financials → G/L Account Determination', ['AccountDetermination']],
];

const ROOT = process.cwd();
// CRLF on Windows checkouts: `.` does not match CR, so normalise first.
const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]));
const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);

function fieldsOf(model) {
  const body = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'));
  if (!body) throw new Error(`model ${model} not in schema`);
  const table = (body[1].match(/@@map\("([^"]+)"\)/) ?? [])[1] ?? model;
  const out = [];
  for (const line of body[1].split('\n')) {
    const m = line.match(/^\s+(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
    if (!m) continue;
    const [, name, type, list, , rest] = m;
    if (list || (!SCALARS.has(type) && !enums.has(type))) continue; // relations
    const column = (rest.match(/@map\("([^"]+)"\)/) ?? [])[1] ?? name;
    out.push({ name, type, column });
  }
  return { table, fields: out };
}

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
const files = walk(join(ROOT, 'src')).map((p) => ({ path: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const dtoFiles = files.filter((f) => /\.dto\.ts$|\/dto\//.test(f.path));
const codeFiles = files.filter((f) => !/\.dto\.ts$|\/dto\/|\.spec\.ts$/.test(f.path));

/** The nearest enclosing function/method name above a line. */
function enclosing(lines, i) {
  for (let j = i; j >= 0; j--) {
    const l = lines[j];
    let m = l.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (m) return m[1];
    m = l.match(/^\s*(?:(?:private|protected|public|static|async|override)\s+)*(\w+)\s*(?:<[^>]*>)?\(.*\)\s*(?::\s*[^{]+)?\{\s*$/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) return m[1];
    m = l.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=/);
    if (m) return m[1];
  }
  return '(module)';
}

// Where each window's logic lives. A generic name (`name`, `status`) is read
// all over the codebase; only reads in the window's own modules count.
const SCOPE_HR = ['src/modules/hr/', 'src/modules/employees/'];
const SCOPE = (window) =>
  window.includes('Payment Details') ? ['src/modules/hr/payment-details/', 'src/modules/hr/transactions/']
    : window.includes('Banking') ? ['src/modules/financials/setup/', 'src/modules/hr/payment-details/', 'src/modules/hr/transactions/']
      : window.includes('G/L Account Determination') ? ['src/modules/financials/', 'src/modules/hr/transactions/']
        : SCOPE_HR;

function readersOf(field, scopes) {
  const re = new RegExp(`\\.${field}\\b(?!\\s*=[^=])`);
  const hits = new Set();
  for (const f of codeFiles) {
    if (!scopes.some((s) => f.path.startsWith(s))) continue;
    if (!f.text.includes(field)) continue;
    const lines = f.text.split('\n');
    lines.forEach((l, i) => {
      if (re.test(l) && !/^\s*(\/\/|\*)/.test(l)) hits.add(`${f.path.replace(/^src\/modules\//, '')}:${enclosing(lines, i)}`);
    });
  }
  return [...hits];
}

const dtoAccepts = (field) =>
  dtoFiles.some((f) => new RegExp(`\\b${field}[?!]?\\s*:`).test(f.text));

const statusPath = join(ROOT, 'docs/field-register.status.json');
let statuses = {};
try { statuses = JSON.parse(readFileSync(statusPath, 'utf8')); } catch { /* first run */ }

const SYSTEM = new Set(['id', 'companyId', 'createdAt', 'updatedAt']);
const rows = [];
let unreviewed = 0;
const tally = {};
let md = '';
for (const [window, modelNames] of WINDOWS) {
  md += `\n## ${window}\n\n| Field | DB column | DTO | Read by (file:function) | Status | Note |\n|---|---|---|---|---|---|\n`;
  for (const model of modelNames) {
    const { table, fields } = fieldsOf(model);
    for (const f of fields) {
      const key = `${model}.${f.name}`;
      const readers = readersOf(f.name, SCOPE(window));
      const st = statuses[key] ?? (SYSTEM.has(f.name) ? { status: 'System' } : null);
      if (!st) unreviewed++;
      const status = st?.status ?? 'UNREVIEWED';
      tally[status.split(':')[0]] = (tally[status.split(':')[0]] ?? 0) + 1;
      const shown = readers.slice(0, 4).join('<br>') + (readers.length > 4 ? `<br>… +${readers.length - 4}` : '');
      md += `| ${key} | ${table}.${f.column} | ${dtoAccepts(f.name) ? 'yes' : '—'} | ${shown || '—'} | ${status} | ${(st?.note ?? '').replace(/\|/g, '\\|')} |\n`;
      rows.push({ key, readers: readers.length, status });
    }
  }
}

const head = `# Payroll field register

Generated by \`node scripts/field-register.mjs\` from prisma/schema.prisma, the
request DTOs and the backend source; statuses from
\`docs/field-register.status.json\`. Do not edit this file by hand.

"Read by" is every backend function in the window's own modules that reads the
field (a \`.field\` access outside DTOs, specs and the schema). It over-matches
generic names (\`name\`, \`status\`) and lists CRUD pass-through too, so for every
**Used** field the Note names the function that actually decides with it.

| Status | Meaning |
|---|---|
| Used | drives behaviour — the Note names where |
| Used — record data | descriptive (address, phone…): shown and searched, no rule reads it by design |
| Scheduled: QA Dn (step k) | stored only today; the named QA decision builds it in that step |
| Question | stored only (or inconsistent) and not covered by a QA decision — needs a ruling |
| Removed | not on the screen; column kept read-only for older rows |
| System | ids, tenancy, audit stamps, owner/sort/mirror columns |

**Totals:** ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')} · fields ${rows.length}
`;
writeFileSync(join(ROOT, 'docs/payroll-field-register.md'), head + md);
console.log(`field register: ${rows.length} fields; ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (process.argv.includes('--check') && unreviewed) {
  console.error(`${unreviewed} field(s) have no reviewed status`);
  process.exit(1);
}
if (process.argv.includes('--dump')) {
  for (const r of rows) console.log(`${r.key}\t${r.readers}\t${r.status}`);
}
