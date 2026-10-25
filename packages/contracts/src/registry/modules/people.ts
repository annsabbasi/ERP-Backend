import { actions, defineModule, feature } from '../define';

// Part 07 §7.1–7.8. Permissions only where Part 11 §11.7.2 and Part 04 §4.9.4 name them.

export const hr = defineModule({
  key: 'hr',
  name: 'HR Core',
  category: 'business',
  group: 'People',
  features: {
    core: feature({
      name: 'Employee Records',
      release: 'R1',
      resources: {
        employees: actions(['view', 'create', 'update', 'export', 'view_sensitive']),
        // Sensitive: medical notes (Part 04 §4.9.4).
        medical: actions(['view']),
      },
    }),
    lifecycle: feature({ name: 'Employee Lifecycle', release: 'R1', requires: ['hr.core'] }),
    letters: feature({ name: 'Letters', release: 'R1', requires: ['hr.core'] }),
    discipline: feature({ name: 'Discipline', release: 'R2', requires: ['hr.core'] }),
    assets: feature({ name: 'Assets Issued', release: 'R2', requires: ['hr.core'] }),
    training: feature({ name: 'Training', release: 'later', requires: ['hr.core'] }),
  },
});

export const attendance = defineModule({
  key: 'attendance',
  name: 'Attendance & Time',
  category: 'business',
  group: 'People',
  requires: ['hr.core'],
  features: {
    shifts: feature({ name: 'Shifts & Rosters', release: 'R1' }),
    capture: feature({ name: 'Attendance Capture', release: 'R1' }),
    rules: feature({ name: 'Rules', release: 'R1' }),
    sheet: feature({ name: 'Monthly Attendance Sheet', release: 'R1' }),
    corrections: feature({ name: 'Corrections', release: 'R1' }),
    overtime: feature({ name: 'Overtime', release: 'R1' }),
    timesheets: feature({ name: 'Timesheets', release: 'R2' }),
    holidays: feature({ name: 'Holiday Calendars', release: 'R1' }),
  },
});

export const leave = defineModule({
  key: 'leave',
  name: 'Leave',
  category: 'business',
  group: 'People',
  requires: ['hr.core'],
  features: {
    types: feature({ name: 'Leave Types & Policies', release: 'R1' }),
    applications: feature({
      name: 'Applications',
      release: 'R1',
      requires: ['leave.types'],
      resources: { applications: actions(['view', 'create', 'approve', 'cancel']) },
    }),
    balances: feature({ name: 'Balances', release: 'R1', requires: ['leave.types'] }),
    calendar: feature({ name: 'Team Calendar', release: 'R1' }),
    encashment: feature({ name: 'Encashment', release: 'R2' }),
    compoff: feature({ name: 'Compensatory Off', release: 'R2' }),
  },
});

export const payroll = defineModule({
  key: 'payroll',
  name: 'Payroll',
  category: 'business',
  group: 'People',
  requires: ['hr.core', 'finance.core'],
  recommends: ['attendance.sheet', 'leave.applications'],
  features: {
    structures: feature({
      name: 'Pay Structures',
      release: 'R1',
      // Sensitive: salaries, pay components and others' payslips (Part 04 §4.9.4).
      resources: { compensation: actions(['view_sensitive']) },
    }),
    periods: feature({ name: 'Pay Periods', release: 'R1' }),
    runs: feature({
      name: 'Payroll Runs',
      release: 'R1',
      requires: ['payroll.structures', 'payroll.periods'],
      limits: ['payroll.employees.max'],
      resources: {
        runs: actions(['view', 'create', 'approve', 'post'], {
          special: ['generate', 'cancel', 'bank_file'],
        }),
      },
    }),
    adjustments: feature({ name: 'Monthly Adjustments', release: 'R1' }),
    loans: feature({ name: 'Loans & Advances', release: 'R1' }),
    tax: feature({ name: 'Income Tax', release: 'R1' }),
    statutory: feature({ name: 'Statutory Contributions', release: 'R1' }),
    payments: feature({ name: 'Salary Payments', release: 'R1' }),
    payslips: feature({ name: 'Payslips', release: 'R1' }),
    settlement: feature({ name: 'Final Settlement', release: 'R2' }),
    bonus: feature({ name: 'Bonuses & Increments', release: 'R2' }),
    costing: feature({ name: 'Cost Allocation', release: 'R2' }),
  },
});

export const recruitment = defineModule({
  key: 'recruitment',
  name: 'Recruitment',
  category: 'business',
  group: 'People',
  // Works alone; hired candidates become employees only once HR Core is on (§2.9.6).
  recommends: ['hr.core', 'meetings.core'],
  features: {
    requisitions: feature({ name: 'Job Requisitions', release: 'R1' }),
    postings: feature({ name: 'Job Postings & Careers Page', release: 'R1' }),
    applications: feature({ name: 'Applications', release: 'R1' }),
    pipeline: feature({
      name: 'Candidate Pipeline',
      release: 'R1',
      resources: {
        candidates: actions(['view', 'create', 'update', 'export'], { special: ['move_stage'] }),
      },
    }),
    interviews: feature({ name: 'Interviews & Scorecards', release: 'R1' }),
    offers: feature({ name: 'Offers', release: 'R1' }),
    onboarding: feature({ name: 'Hire & Onboard', release: 'R1', requires: ['hr.core'] }),
    talent_pool: feature({ name: 'Talent Pool', release: 'R2' }),
  },
});

export const performance = defineModule({
  key: 'performance',
  name: 'Performance',
  category: 'business',
  group: 'People',
  requires: ['hr.core'],
  features: {
    goals: feature({ name: 'Goals & KPIs', release: 'R2' }),
    reviews: feature({ name: 'Review Cycles', release: 'R2' }),
    feedback: feature({ name: 'Continuous Feedback', release: 'later' }),
    outcomes: feature({ name: 'Outcomes', release: 'R2' }),
  },
});

export const expenses = defineModule({
  key: 'expenses',
  name: 'Expenses & Travel',
  category: 'business',
  group: 'People',
  recommends: ['hr.core', 'finance.payables'],
  features: {
    claims: feature({ name: 'Expense Claims', release: 'R1' }),
    travel: feature({ name: 'Travel & TA/DA', release: 'R2' }),
    cards: feature({ name: 'Company Cards', release: 'later' }),
  },
});

export const ess = defineModule({
  key: 'ess',
  name: 'Employee Self-Service',
  category: 'business',
  group: 'People',
  requires: ['hr.core'],
  features: {
    portal: feature({ name: 'Self-Service', release: 'R1', scopes: ['own'] }),
  },
});
