import { COMPANY_ROLES } from './company-roles';
import { buildTemplate, role, type GrantSpec } from './define';

// School (K-12) 1.0 (Part 02 §2.10.3, §2.12.2, Part 08 §8.3). Role templates follow the matrix
// of Part 08 §8.3.17 (B branch = campus, A assigned = the classes and sections given to the
// teacher). Guardians are portal users, not staff roles (Part 05 §5.3.13).

const ACADEMICS = [
  'academic_years',
  'terms',
  'grade_levels',
  'sections',
  'subjects',
  'teacher_assignments',
];
const academics = (actions: string[], scope: 'branch' | 'assigned'): GrantSpec[] =>
  ACADEMICS.map((r): GrantSpec => [`school.${r}`, actions, scope]);

const PRINCIPAL = role(
  'principal',
  'Principal',
  'پرنسپل',
  'Runs the campus: structure, students, approves concessions and publishes results.',
  [
    ...academics(['view', 'create', 'update'], 'branch'),
    ['school.enquiries', ['view'], 'branch'],
    ['school.applications', ['view'], 'branch'],
    ['school.merit_lists', ['view', 'publish'], 'branch'],
    ['school.students', ['view', 'create', 'update'], 'branch'],
    ['school.guardians', ['view', 'create', 'update'], 'branch'],
    ['school.families', ['view', 'create', 'update'], 'branch'],
    ['school.attendance', ['view'], 'branch'],
    ['school.challans', ['view'], 'branch'],
    ['school.payments', ['view'], 'branch'],
    ['school.concessions', ['view', 'approve'], 'branch'],
    ['school.exams', ['view'], 'branch'],
    ['school.marks', ['view'], 'branch'],
    ['school.results', ['view', 'publish'], 'branch'],
    ['school.report_cards', ['view', 'publish'], 'branch'],
    ['school.messages', ['view', 'send', 'broadcast'], 'branch'],
    ['school.reports', ['view', 'export'], 'branch'],
    ['school.settings', ['view', 'configure'], 'branch'],
  ],
);

const ADMISSIONS_OFFICER = role(
  'admissions_officer',
  'Admissions Officer',
  'داخلہ آفیسر',
  'Enquiries to enrollment: applications, tests, merit lists and offers.',
  [
    ...academics(['view'], 'branch'),
    ['school.enquiries', ['view', 'create', 'update', 'assign'], 'branch'],
    ['school.applications', ['view', 'create', 'update', 'reject', 'offer', 'enroll'], 'branch'],
    ['school.admission_tests', ['view', 'create', 'update'], 'branch'],
    ['school.merit_lists', ['view', 'create'], 'branch'],
    ['school.offers', ['view', 'create'], 'branch'],
    ['school.students', ['view', 'create'], 'branch'],
    ['school.guardians', ['view', 'create'], 'branch'],
    ['school.challans', ['view'], 'branch'],
    ['school.messages', ['view', 'send'], 'branch'],
  ],
);

const FEE_OFFICER = role(
  'fee_officer',
  'Fee Officer',
  'فیس آفیسر',
  'Fee structures, challans, collection and reconciliation; concessions go to the Principal.',
  [
    ...academics(['view'], 'branch'),
    ['school.applications', ['view'], 'branch'],
    ['school.students', ['view'], 'branch'],
    ['school.families', ['view'], 'branch'],
    ['school.fee_heads', ['view', 'create', 'update'], 'branch'],
    ['school.fee_structures', ['view', 'create', 'update'], 'branch'],
    ['school.challans', ['view', 'generate', 'print', 'send'], 'branch'],
    ['school.payments', ['view', 'import', 'receive', 'reconcile'], 'branch'],
    ['school.concessions', ['view', 'create'], 'branch'],
    ['school.fines', ['view'], 'branch'],
    ['school.messages', ['view', 'send'], 'branch'],
    ['school.reports', ['view', 'export'], 'branch'],
  ],
);

const TEACHER = role(
  'teacher',
  'Teacher',
  'استاد',
  'Their own classes: attendance, marks, test marks for admissions, messages to their sections.',
  [
    ['school.sections', ['view'], 'assigned'],
    ['school.subjects', ['view'], 'assigned'],
    ['school.teacher_assignments', ['view'], 'assigned'],
    ['school.admission_tests', ['view', 'enter_marks'], 'assigned'],
    ['school.students', ['view'], 'assigned'],
    ['school.attendance', ['view', 'mark'], 'assigned'],
    ['school.exams', ['view'], 'assigned'],
    ['school.marks', ['view', 'enter'], 'assigned'],
    ['school.messages', ['view', 'send'], 'assigned'],
    ['school.reports', ['view'], 'assigned'],
  ],
);

const CLASS_TEACHER = role(
  'class_teacher',
  'Class Teacher',
  'کلاس ٹیچر',
  'Their homeroom section: attendance and leave, remarks, fee status, guardians’ messages.',
  [
    ['school.sections', ['view'], 'assigned'],
    ['school.subjects', ['view'], 'assigned'],
    ['school.students', ['view', 'update'], 'assigned'],
    ['school.attendance', ['view', 'mark', 'update', 'approve_leave'], 'assigned'],
    ['school.leave_requests', ['view', 'approve'], 'assigned'],
    ['school.challans', ['view'], 'assigned'],
    ['school.marks', ['view', 'update'], 'assigned'],
    ['school.report_cards', ['view'], 'assigned'],
    ['school.messages', ['view', 'send'], 'assigned'],
    ['school.reports', ['view'], 'assigned'],
  ],
);

const EXAM_CONTROLLER = role(
  'exam_controller',
  'Exam Controller',
  'امتحانی کنٹرولر',
  'Exam schedule, marks completion, locking and publishing results and report cards.',
  [
    ...academics(['view'], 'branch'),
    ['school.students', ['view'], 'branch'],
    ['school.attendance', ['view'], 'branch'],
    ['school.exams', ['view', 'create', 'update', 'schedule'], 'branch'],
    ['school.marks', ['view', 'update', 'lock'], 'branch'],
    ['school.results', ['view', 'publish'], 'branch'],
    ['school.report_cards', ['view', 'print', 'publish'], 'branch'],
    ['school.grading_scales', ['view', 'create', 'update'], 'branch'],
    ['school.messages', ['view', 'send'], 'branch'],
    ['school.reports', ['view', 'export'], 'branch'],
  ],
);

const FRONT_DESK = role(
  'front_desk',
  'Front Desk',
  'فرنٹ ڈیسک',
  'Walk-in enquiries, basic student look-up and fee payments at the counter.',
  [
    ...academics(['view'], 'branch'),
    ['school.enquiries', ['view', 'create'], 'branch'],
    ['school.students', ['view'], 'branch'],
    ['school.payments', ['view', 'receive'], 'branch'],
    ['school.messages', ['view'], 'branch'],
  ],
);

export const SCHOOL_K12 = buildTemplate({
  key: 'school_k12',
  version: '1.0.0',
  name: { en: 'School (K-12)', ur: 'اسکول (K-12)' },
  industry: 'school',
  description:
    'Academic structure, students, admissions, attendance, fees and challans, exams and report cards, parent portal, with people and payroll.',
  entitlements: [
    'school.academics',
    'school.sis',
    'school.admissions',
    'school.attendance',
    'school.fees',
    'school.exams',
    'school.portal',
    'school.comms',
    'hr.core',
    'attendance.capture',
    'attendance.sheet',
    'leave.types',
    'leave.applications',
    'payroll.structures',
    'payroll.periods',
    'payroll.runs',
    'payroll.payslips',
    'meetings.core',
  ],
  limits: { 'users.max': 50, 'branches.max': 1, 'school.students.max': 500 },
  terminology: {
    branch: { en: 'Campus', ur: 'کیمپس' },
    customer: { en: 'Student and Guardian', ur: 'طالب علم اور سرپرست' },
    sales_invoice: { en: 'Fee Challan', ur: 'فیس چالان' },
    item: { en: 'Fee head', ur: 'فیس ہیڈ' },
    employee: { en: 'Faculty & Staff', ur: 'اساتذہ و عملہ' },
    department: { en: 'Department / Wing', ur: 'شعبہ / ونگ' },
    appointment: { en: 'Parent-Teacher Meeting', ur: 'والدین اساتذہ میٹنگ' },
  },
  roles: [
    ...COMPANY_ROLES,
    PRINCIPAL,
    ADMISSIONS_OFFICER,
    FEE_OFFICER,
    TEACHER,
    CLASS_TEACHER,
    EXAM_CONTROLLER,
    FRONT_DESK,
  ],
  settings: {
    'core.locale': 'en',
    'core.fiscal_year_start_month': 7,
    'school.attendance_mode': 'daily',
    'school.attendance_threshold_pct': 75,
    'school.fees.due_day': 10,
    'school.portal.enabled': true,
  },
  wizard: [
    'welcome',
    'company_profile',
    'localization',
    'organization',
    'academic_year',
    'grade_levels',
    'subjects',
    'fee_structure',
    'challan_settings',
    'admission_settings',
    'attendance_mode',
    'grading_scale',
    'parent_portal',
    'team',
    'review',
  ],
});
