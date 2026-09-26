import {
  computePayslip,
  grossFromStage,
  monthlyTax,
  overlapDays,
  slabTax,
  splitLeave,
  type LeaveWindow,
  type PayScaleStage,
  type TaxBand,
} from './payroll-calculation';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// The grade the "sap- erp system" company actually has on file.
const STAGE: PayScaleStage = {
  basicPay: 80000,
  hra: 16000,
  utilityAllowance: 4000,
  medicalAllowance: 4000,
  conveyanceAllowance: 8000,
};
const GROSS = 112000;

const MAY_FROM = d('2026-05-01');
const MAY_TO = d('2026-05-31');

const baseInput = {
  stage: STAGE,
  workingDays: 22,
  totalDays: 31,
  presentDays: null,
  leave: { paidDays: 0, unpaidDays: 0 },
  loanDue: 0,
  adjustment: null,
  taxBands: [] as TaxBand[],
  taxMonths: 12,
};

describe('grossFromStage', () => {
  it('sums every pay-scale component', () => {
    expect(grossFromStage(STAGE)).toBe(GROSS);
  });

  it('is zero for an employee with no grade', () => {
    expect(grossFromStage(null)).toBe(0);
  });
});

describe('overlapDays', () => {
  const leave = (from: string, to: string, days: number): LeaveWindow => ({
    startDate: d(from), endDate: d(to), days, paid: false,
  });

  it('counts a request fully inside the period', () => {
    expect(overlapDays(leave('2026-05-10', '2026-05-12', 3), MAY_FROM, MAY_TO)).toBe(3);
  });

  it('ignores a request entirely outside the period', () => {
    expect(overlapDays(leave('2026-06-10', '2026-06-12', 3), MAY_FROM, MAY_TO)).toBe(0);
  });

  it('pro-rates a request straddling the period end', () => {
    // 28 May – 3 June is 7 days; 4 of them (28,29,30,31) are in May.
    expect(overlapDays(leave('2026-05-28', '2026-06-03', 7), MAY_FROM, MAY_TO)).toBeCloseTo(4, 5);
  });

  it('keeps a half-day at half a day', () => {
    expect(overlapDays(leave('2026-05-10', '2026-05-10', 0.5), MAY_FROM, MAY_TO)).toBe(0.5);
  });
});

describe('splitLeave', () => {
  it('separates paid from unpaid leave', () => {
    const split = splitLeave(
      [
        { startDate: d('2026-05-04'), endDate: d('2026-05-06'), days: 3, paid: true },
        { startDate: d('2026-05-11'), endDate: d('2026-05-12'), days: 2, paid: false },
      ],
      MAY_FROM, MAY_TO,
    );
    expect(split).toEqual({ paidDays: 3, unpaidDays: 2 });
  });
});

describe('slabTax', () => {
  const bands: TaxBand[] = [
    { lowerAmount: 0, higherAmount: 600000, percentage: 0 },
    { lowerAmount: 600000, higherAmount: 1200000, percentage: 5 },
    { lowerAmount: 1200000, higherAmount: null, percentage: 15 },
  ];

  it('charges nothing below the first threshold', () => {
    expect(slabTax(500000, bands)).toBe(0);
  });

  it('charges only the portion inside a band, not the whole amount', () => {
    // 600k exempt + 200k @ 5% = 10,000. A non-progressive reading would
    // charge 5% of the full 800,000 = 40,000.
    expect(slabTax(800000, bands)).toBe(10000);
  });

  it('accumulates across bands into the open-ended top band', () => {
    // 600k @ 0 + 600k @ 5% (30,000) + 300k @ 15% (45,000) = 75,000
    expect(slabTax(1500000, bands)).toBe(75000);
  });

  it('sorts mis-ordered bands rather than mis-charging them', () => {
    expect(slabTax(800000, [...bands].reverse())).toBe(10000);
  });

  it('is zero when the company has no tax formula', () => {
    expect(slabTax(1500000, [])).toBe(0);
  });

  it('annualises then spreads back over the formula months', () => {
    // 70,000/month → 840,000/yr → 600k exempt + 240k @ 5% = 12,000/yr → 1,000/mo
    expect(monthlyTax(70000, bands, 12)).toBe(1000);
  });
});

describe('computePayslip — leave deduction', () => {
  it('pays the full gross when nobody took leave', () => {
    const slip = computePayslip(baseInput);
    expect(slip.grossPay).toBe(GROSS);
    expect(slip.lopDeduction).toBe(0);
    expect(slip.netPay).toBe(GROSS);
  });

  it('does not dock pay for PAID leave', () => {
    const slip = computePayslip({ ...baseInput, leave: { paidDays: 3, unpaidDays: 0 } });
    expect(slip.lopDays).toBe(0);
    expect(slip.lopDeduction).toBe(0);
    expect(slip.netPay).toBe(GROSS);
  });

  it('docks gross ÷ working days for each UNPAID leave day', () => {
    const slip = computePayslip({ ...baseInput, leave: { paidDays: 0, unpaidDays: 3 } });
    // 112000 / 22 = 5090.909…, × 3 = 15272.73
    expect(slip.perDayRate).toBeCloseTo(5090.91, 2);
    expect(slip.lopDays).toBe(3);
    expect(slip.lopDeduction).toBeCloseTo(15272.73, 2);
    expect(slip.netPay).toBeCloseTo(GROSS - 15272.73, 2);
  });

  it('uses working days, never calendar days, as the divisor', () => {
    const onCalendarDays = computePayslip({ ...baseInput, workingDays: 31 });
    const onWorkingDays = computePayslip(baseInput);
    expect(onWorkingDays.perDayRate).toBeGreaterThan(onCalendarDays.perDayRate);
    expect(onWorkingDays.perDayRate).toBeCloseTo(112000 / 22, 2);
  });

  it('assumes an employee with no attendance record is present, not absent', () => {
    // The regression that produced 31-days-LOP payslips for everyone.
    const slip = computePayslip({ ...baseInput, presentDays: null });
    expect(slip.absenceDays).toBe(0);
    expect(slip.netPay).toBe(GROSS);
  });

  it('charges unexplained absence once attendance IS recorded', () => {
    const slip = computePayslip({ ...baseInput, presentDays: 20 });
    expect(slip.absenceDays).toBe(2);
    expect(slip.lopDeduction).toBeCloseTo(2 * (112000 / 22), 2);
  });

  it('does not charge a leave day twice as absence', () => {
    // Present 19 of 22, with 3 days of approved paid leave: fully accounted.
    const slip = computePayslip({
      ...baseInput, presentDays: 19, leave: { paidDays: 3, unpaidDays: 0 },
    });
    expect(slip.absenceDays).toBe(0);
    expect(slip.lopDays).toBe(0);
    expect(slip.netPay).toBe(GROSS);
  });
});

describe('computePayslip — other deductions', () => {
  it('deducts loan installments falling due in the period', () => {
    const slip = computePayslip({ ...baseInput, loanDue: 5000 });
    expect(slip.loanDeduction).toBe(5000);
    expect(slip.netPay).toBe(GROSS - 5000);
  });

  it('lets a manual adjustment override the generated loan figure', () => {
    const slip = computePayslip({
      ...baseInput, loanDue: 5000, adjustment: { loanDeduction: 2000 },
    });
    expect(slip.loanDeduction).toBe(2000);
  });

  it('does not count the loan twice via the adjustment document', () => {
    const slip = computePayslip({
      ...baseInput,
      adjustment: { loanDeduction: 2000, generalDeduction: 1000 },
    });
    expect(slip.adjustmentDeductions).toBe(1000);
    expect(slip.loanDeduction).toBe(2000);
    expect(slip.totalDeductions).toBe(3000);
  });

  it('adds adjustment additions and subtracts adjustment deductions', () => {
    const slip = computePayslip({
      ...baseInput,
      adjustment: { arrears: 10000, fuel: 5000, messDeduction: 2000 },
    });
    expect(slip.adjustmentAdditions).toBe(15000);
    expect(slip.adjustmentDeductions).toBe(2000);
    expect(slip.totalEarnings).toBe(GROSS + 15000);
    expect(slip.netPay).toBe(GROSS + 15000 - 2000);
  });

  it('taxes the gross after LOP, so leave lowers the tax too', () => {
    const bands: TaxBand[] = [{ lowerAmount: 0, higherAmount: null, percentage: 10 }];
    const full = computePayslip({ ...baseInput, taxBands: bands });
    const withLeave = computePayslip({
      ...baseInput, taxBands: bands, leave: { paidDays: 0, unpaidDays: 5 },
    });
    expect(full.taxDeduction).toBeCloseTo(11200, 2);
    expect(withLeave.taxDeduction).toBeLessThan(full.taxDeduction);
  });

  it('keeps net = earnings - deductions for every combination', () => {
    const slip = computePayslip({
      ...baseInput,
      presentDays: 18,
      leave: { paidDays: 1, unpaidDays: 2 },
      loanDue: 4000,
      adjustment: { arrears: 3000, messDeduction: 500 },
      taxBands: [{ lowerAmount: 0, higherAmount: null, percentage: 10 }],
    });
    expect(slip.totalEarnings).toBeCloseTo(slip.grossPay + slip.adjustmentAdditions, 2);
    expect(slip.totalDeductions).toBeCloseTo(
      slip.lopDeduction + slip.loanDeduction + slip.advanceDeduction + slip.taxDeduction + slip.adjustmentDeductions,
      2,
    );
    expect(slip.netPay).toBeCloseTo(slip.totalEarnings - slip.totalDeductions, 2);
  });

  it('deducts a salary advance on its own line, separate from the loan', () => {
    const slip = computePayslip({ ...baseInput, loanDue: 4000, advanceDue: 10000 });
    expect(slip.loanDeduction).toBe(4000);
    expect(slip.advanceDeduction).toBe(10000);
    expect(slip.totalDeductions).toBe(14000);
    expect(slip.netPay).toBe(GROSS - 14000);
  });

  it('never charges absence for an employee with no attendance row (demo employees)', () => {
    const slip = computePayslip({ ...baseInput, presentDays: null, leave: { paidDays: 0, unpaidDays: 0 } });
    expect(slip.lopDays).toBe(0);
    expect(slip.lopDeduction).toBe(0);
    expect(slip.netPay).toBe(GROSS);
  });

  it('produces a zero payslip, not NaN, for an employee with no grade', () => {
    const slip = computePayslip({ ...baseInput, stage: null, leave: { paidDays: 0, unpaidDays: 5 } });
    expect(slip.grossPay).toBe(0);
    expect(slip.perDayRate).toBe(0);
    expect(slip.lopDeduction).toBe(0);
    expect(slip.netPay).toBe(0);
  });
});
