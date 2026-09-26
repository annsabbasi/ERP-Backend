/**
 * Payroll arithmetic, kept free of Prisma and of NestJS so it can be reasoned
 * about — and tested — without a database.
 *
 * The shape of a payslip here is:
 *
 *     gross            = sum of the grade pay-scale components
 *     perDayRate       = gross / PayPeriod.workingDays
 *     lopDeduction     = perDayRate * (unpaid leave days + unexplained absence)
 *     loanDeduction    = loan installments outstanding up to the period end
 *     advanceDeduction = salary-advance installments outstanding up to the period end
 *     taxDeduction     = progressive slab tax on the annualised taxable gross
 *     netPay           = gross + adjustment additions - all of the above
 *                        - adjustment deductions
 *
 * Every figure is returned, not just the net, because the Payroll Process
 * window shows the working — an accountant has to be able to see *why* a
 * salary came out lower, which is the whole point of deducting for leave.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Prisma Decimal, a JS number, a numeric string, or nothing. */
export type Numish = { toString(): string } | number | string | null | undefined;

/** Decimal-safe coercion. Prisma hands back Decimal objects, not numbers. */
export const num = (v: Numish): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
};

/** Rounds to 2dp without the float drift of `Math.round(x * 100) / 100`. */
export const money = (n: number): number =>
  Number.isFinite(n) ? Number(n.toFixed(2)) : 0;

/** Inclusive whole-day count between two dates, minimum 1. */
export const inclusiveDays = (from: Date, to: Date): number =>
  Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1);

// ─── Leave ────────────────────────────────────────────────────────────────────

export interface LeaveWindow {
  startDate: Date;
  endDate: Date;
  /** Days as declared on the request — may be fractional for half-days. */
  days: Numish;
  /** LeaveType.paid — false means the day comes out of the salary. */
  paid: boolean;
}

export interface LeaveSplit {
  paidDays: number;
  unpaidDays: number;
}

/**
 * How much of a leave request lands inside [from, to].
 *
 * A request may straddle the period boundary — someone on leave from 28 May to
 * 3 June should only have the May days docked from the May payroll. The
 * declared `days` (which may be fractional, e.g. 0.5 for a half day) is
 * pro-rated by the share of the request's calendar span that overlaps.
 */
export function overlapDays(leave: LeaveWindow, from: Date, to: Date): number {
  const start = leave.startDate.getTime();
  const end = leave.endDate.getTime();
  const overlapStart = Math.max(start, from.getTime());
  const overlapEnd = Math.min(end, to.getTime());
  if (overlapEnd < overlapStart) return 0;

  const spanDays = Math.round((end - start) / DAY_MS) + 1;
  const insideDays = Math.round((overlapEnd - overlapStart) / DAY_MS) + 1;
  const declared = num(leave.days);

  // A request whose declared days disagree with its span (half-days, or a span
  // that includes weekends) keeps its own total; we only scale it by overlap.
  if (spanDays <= 0) return 0;
  if (insideDays >= spanDays) return declared;
  return (declared * insideDays) / spanDays;
}

/** Splits an employee's leave in the period into paid and unpaid day counts. */
export function splitLeave(leaves: LeaveWindow[], from: Date, to: Date): LeaveSplit {
  let paidDays = 0;
  let unpaidDays = 0;
  for (const l of leaves) {
    const d = overlapDays(l, from, to);
    if (d <= 0) continue;
    if (l.paid) paidDays += d;
    else unpaidDays += d;
  }
  return { paidDays: money(paidDays), unpaidDays: money(unpaidDays) };
}

// ─── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxBand {
  lowerAmount: Numish;
  /** null = the open-ended top band. */
  higherAmount: Numish;
  percentage: Numish;
}

/**
 * Progressive slab tax: each band is charged only on the portion of `amount`
 * that falls inside it, not on the whole amount. Bands are sorted here rather
 * than trusting `ordering`, because a mis-ordered slab table would otherwise
 * silently produce a wrong tax rather than an error.
 */
export function slabTax(amount: number, bands: TaxBand[]): number {
  if (amount <= 0 || !bands.length) return 0;
  const sorted = [...bands].sort((a, b) => num(a.lowerAmount) - num(b.lowerAmount));

  let tax = 0;
  for (const band of sorted) {
    const lower = num(band.lowerAmount);
    if (amount <= lower) break;
    const upper = band.higherAmount === null || band.higherAmount === undefined
      ? Infinity
      : num(band.higherAmount);
    const taxableInBand = Math.min(amount, upper) - lower;
    if (taxableInBand > 0) tax += taxableInBand * (num(band.percentage) / 100);
  }
  return money(tax);
}

/**
 * Monthly tax withheld: slabs are written as annual brackets, so the monthly
 * taxable gross is annualised, taxed, then spread back over the formula's
 * months (12 unless the formula says otherwise — a mid-year formula covering
 * fewer months spreads the same liability over fewer paydays).
 */
export function monthlyTax(
  monthlyTaxableGross: number,
  bands: TaxBand[],
  monthsInFormula = 12,
): number {
  const months = monthsInFormula > 0 ? monthsInFormula : 12;
  const annual = monthlyTaxableGross * 12;
  return money(slabTax(annual, bands) / months);
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

export interface PayScaleStage {
  basicPay?: Numish;
  hra?: Numish;
  utilityAllowance?: Numish;
  medicalAllowance?: Numish;
  conveyanceAllowance?: Numish;
  adhoc2017?: Numish;
  adhoc2018?: Numish;
}

/** Every pay-scale component an employee is entitled to before deductions. */
export function grossFromStage(stage: PayScaleStage | null | undefined): number {
  if (!stage) return 0;
  return money(
    num(stage.basicPay) +
    num(stage.hra) +
    num(stage.utilityAllowance) +
    num(stage.medicalAllowance) +
    num(stage.conveyanceAllowance) +
    num(stage.adhoc2017) +
    num(stage.adhoc2018),
  );
}

// ─── Monthly adjustments ──────────────────────────────────────────────────────

export interface AdjustmentLine {
  arrears?: Numish;
  carAllowance?: Numish;
  taDa?: Numish;
  dowryAllowance?: Numish;
  taxableAddition?: Numish;
  fuel?: Numish;
  generalDeduction?: Numish;
  carInsLaptopDed?: Numish;
  messDeduction?: Numish;
  generalDeduction2?: Numish;
  carInsLaptopDed2?: Numish;
  loanDeduction?: Numish;
  deduction11?: Numish;
  deduction12?: Numish;
  deduction13?: Numish;
  deduction14?: Numish;
  deduction15?: Numish;
}

export const adjustmentAdditions = (a: AdjustmentLine | null | undefined): number =>
  !a ? 0 : money(
    num(a.arrears) + num(a.carAllowance) + num(a.taDa) +
    num(a.dowryAllowance) + num(a.taxableAddition) + num(a.fuel),
  );

/**
 * Note `loanDeduction` is deliberately excluded: it is reported on its own
 * line, and counting it here as well would deduct the installment twice.
 */
export const adjustmentDeductions = (a: AdjustmentLine | null | undefined): number =>
  !a ? 0 : money(
    num(a.generalDeduction) + num(a.carInsLaptopDed) + num(a.messDeduction) +
    num(a.generalDeduction2) + num(a.carInsLaptopDed2) +
    num(a.deduction11) + num(a.deduction12) + num(a.deduction13) +
    num(a.deduction14) + num(a.deduction15),
  );

// ─── The payslip ──────────────────────────────────────────────────────────────

export interface PayslipInput {
  stage: PayScaleStage | null;
  /** Denominator for the per-day rate — PayPeriod.workingDays. */
  workingDays: number;
  /** Calendar days in the period, reported but never used as a divisor. */
  totalDays: number;
  /** Present days from the attendance sheet, or null when none was recorded. */
  presentDays: number | null;
  leave: LeaveSplit;
  /** Loan installments still outstanding with a dueDate up to the period end. */
  loanDue: number;
  /**
   * Salary-advance installments outstanding up to the period end. Kept apart
   * from loanDue because an advance credits Salary Advance Receivable, not
   * Employee Loan Receivable.
   */
  advanceDue?: number;
  adjustment: AdjustmentLine | null;
  taxBands: TaxBand[];
  taxMonths: number;
}

export interface Payslip {
  grossPay: number;
  perDayRate: number;
  totalDaysWorking: number;
  totalDaysWorked: number | null;
  paidDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absenceDays: number;
  lopDays: number;
  lopDeduction: number;
  loanDeduction: number;
  advanceDeduction: number;
  taxableGross: number;
  taxDeduction: number;
  adjustmentAdditions: number;
  adjustmentDeductions: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
}

/**
 * Turns one employee's period into a payslip.
 *
 * Two things are worth calling out:
 *
 * 1. Unexplained absence is only charged when attendance was actually
 *    recorded. Deriving it as `workingDays - presentDays` unconditionally —
 *    which is what this used to do — marks every employee absent for the whole
 *    month at any company that does not run biometrics, wiping out the payroll.
 *    With no attendance line the employee is assumed present, and leave is the
 *    only thing that reduces pay.
 *
 * 2. Paid leave is subtracted before absence so a day cannot be charged twice:
 *    a day already accounted for as leave is not also unexplained absence.
 */
export function computePayslip(input: PayslipInput): Payslip {
  const workingDays = input.workingDays > 0 ? input.workingDays : input.totalDays;
  const gross = grossFromStage(input.stage);
  const perDayRate = workingDays > 0 ? gross / workingDays : 0;

  const { paidDays: paidLeaveDays, unpaidDays: unpaidLeaveDays } = input.leave;

  const absenceDays = input.presentDays === null
    ? 0
    : money(Math.max(workingDays - input.presentDays - paidLeaveDays - unpaidLeaveDays, 0));

  const lopDays = money(unpaidLeaveDays + absenceDays);
  const lopDeduction = money(perDayRate * lopDays);

  const additions = adjustmentAdditions(input.adjustment);
  const otherDeductions = adjustmentDeductions(input.adjustment);

  // An explicit loan figure on the adjustment document is a manual override of
  // the generated schedule — the accountant's number wins.
  const manualLoan = num(input.adjustment?.loanDeduction);
  const loanDeduction = money(manualLoan > 0 ? manualLoan : input.loanDue);
  const advanceDeduction = money(input.advanceDue ?? 0);

  const taxableGross = money(Math.max(gross - lopDeduction + additions, 0));
  const taxDeduction = monthlyTax(taxableGross, input.taxBands, input.taxMonths);

  const totalEarnings = money(gross + additions);
  const totalDeductions = money(
    lopDeduction + loanDeduction + advanceDeduction + taxDeduction + otherDeductions,
  );

  const totalDaysWorked = input.presentDays === null
    ? money(Math.max(workingDays - lopDays, 0))
    : money(input.presentDays);

  return {
    grossPay: gross,
    perDayRate: money(perDayRate),
    totalDaysWorking: money(workingDays),
    totalDaysWorked,
    paidDays: money(Math.max(workingDays - lopDays, 0)),
    paidLeaveDays,
    unpaidLeaveDays,
    absenceDays,
    lopDays,
    lopDeduction,
    loanDeduction,
    advanceDeduction,
    taxableGross,
    taxDeduction,
    adjustmentAdditions: additions,
    adjustmentDeductions: otherDeductions,
    totalEarnings,
    totalDeductions,
    netPay: money(totalEarnings - totalDeductions),
  };
}

// ─── Row totals (Payroll Process grid — Generate defaults, then free entry) ───

/**
 * The four "headline" figures the Payroll Process grid shows per row, always
 * derived from that row's own visible/editable cells — never from the grade's
 * hidden utility/medical/adhoc pay-scale components (those never had a column
 * in this grid, so a figure built from them couldn't be verified by looking
 * at the row, and a payslip total has to match what it's added up from).
 *
 * `generateLines` seeds basic/hra/conveyance from the grade and
 * lopDeduction/loanDeduction/taxDeduction from real attendance/loan/tax data,
 * then calls this same function so the number it returns is exactly what
 * `replaceLines` recomputes if the row is saved untouched. The Payroll
 * Process window mirrors this formula client-side for live-as-you-type
 * totals — keep the two in sync.
 */
export interface RowEarnings {
  basic?: Numish;
  hra?: Numish;
  conveyance?: Numish;
  entertainment?: Numish;
  education?: Numish;
  bigCity?: Numish;
  adjustmentAdditions?: Numish;
  lopDeduction?: Numish;
  loanDeduction?: Numish;
  advanceDeduction?: Numish;
  taxDeduction?: Numish;
  adjustmentDeductions?: Numish;
}

export interface RowTotals {
  grossPay: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
}

export function rowTotals(row: RowEarnings): RowTotals {
  const grossPay = money(
    num(row.basic) + num(row.hra) + num(row.conveyance) +
    num(row.entertainment) + num(row.education) + num(row.bigCity),
  );
  const totalEarnings = money(grossPay + num(row.adjustmentAdditions));
  const totalDeductions = money(
    num(row.lopDeduction) + num(row.loanDeduction) + num(row.advanceDeduction) +
    num(row.taxDeduction) + num(row.adjustmentDeductions),
  );
  return {
    grossPay,
    totalEarnings,
    totalDeductions,
    netPay: money(totalEarnings - totalDeductions),
  };
}
