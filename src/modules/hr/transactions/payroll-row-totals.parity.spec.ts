import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { rowTotals } from './payroll-calculation';

// The Payroll Process window's own copy of the formula — the one the user sees
// while typing. Loaded straight from the Electron source so this spec breaks
// the moment the two disagree. Transpiled here rather than imported because
// ts-jest would compile it with the Electron tsconfig (ES modules).
const WINDOW_TOTALS = path.resolve(
  __dirname,
  '../../../../../erp-electron/src/components/hr-payroll/Transactions/payrollRowTotals.ts',
);
function loadWindowTotals(): { payrollRowTotals: (row: Record<string, unknown>) => unknown } {
  const source = fs.readFileSync(WINDOW_TOTALS, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} as any };
  new Function('exports', 'module', outputText)(mod.exports, mod);
  return mod.exports;
}
const { payrollRowTotals } = loadWindowTotals();

const FIELDS = [
  'basic', 'hra', 'conveyance', 'entertainment', 'education', 'bigCity', 'adjustmentAdditions',
  'lopDeduction', 'loanDeduction', 'advanceDeduction', 'taxDeduction', 'adjustmentDeductions',
] as const;

/** Deterministic pseudo-random rows (no flaky seeds). */
function* rows(count: number) {
  let x = 20260926;
  const next = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < count; i++) {
    const row: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const r = next();
      // A mix of empty cells, integers, cents and strings — what the grid sends.
      row[f] = r < 0.15 ? null : r < 0.2 ? '' : r < 0.6 ? Math.round(next() * 200000) / 100 : String(Math.round(next() * 50000));
    }
    yield row;
  }
}

describe('Payroll Process row totals — backend and window agree', () => {
  it('on a hand-built row with every deduction, including Advance Ded.', () => {
    const row = {
      basic: 80000, hra: 16000, conveyance: 8000, entertainment: 0, education: 0, bigCity: 0,
      adjustmentAdditions: 3000,
      lopDeduction: 5090.91, loanDeduction: 4000, advanceDeduction: 10000, taxDeduction: 1200, adjustmentDeductions: 500,
    };
    const backend = rowTotals(row);
    expect(payrollRowTotals(row)).toEqual(backend);
    expect(backend.totalDeductions).toBeCloseTo(5090.91 + 4000 + 10000 + 1200 + 500, 2);
    expect(backend.netPay).toBeCloseTo(107000 - 20790.91, 2);
  });

  it('on 500 generated rows', () => {
    for (const row of rows(500)) {
      expect(payrollRowTotals(row)).toEqual(rowTotals(row as any));
    }
  });

  it('treats an empty row as all zeroes on both sides', () => {
    expect(payrollRowTotals({})).toEqual(rowTotals({}));
    expect(rowTotals({})).toEqual({ grossPay: 0, totalEarnings: 0, totalDeductions: 0, netPay: 0 });
  });
});
