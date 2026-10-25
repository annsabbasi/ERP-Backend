import { actions, defineModule, feature } from '../define';

// School & College pack (Part 08 §8.3). Full permissions now: the Stage 4 role templates
// need them (§8.3.17). Keys follow Part 02 §2.12.2 and Part 11 §11.7.2.

const shared = {
  settings: actions(['view', 'configure']),
  reports: actions(['view', 'export']),
};

export const school = defineModule({
  key: 'school',
  name: 'School',
  category: 'industry',
  group: 'School',
  features: {
    academics: feature({
      name: 'Academic Structure',
      release: 'R1',
      scopes: ['assigned', 'branch', 'company'],
      resources: {
        academic_years: actions(['view', 'create', 'update', 'delete']),
        terms: actions(['view', 'create', 'update', 'delete']),
        grade_levels: actions(['view', 'create', 'update', 'delete']),
        sections: actions(['view', 'create', 'update', 'delete']),
        subjects: actions(['view', 'create', 'update', 'delete']),
        teacher_assignments: actions(['view', 'create', 'update', 'delete']),
        settings: shared.settings,
        reports: shared.reports,
      },
      menu: [
        {
          path: '/school/academics',
          label: 'nav.school.academics',
          requires: 'school.sections.view',
        },
        {
          path: '/school/settings',
          label: 'nav.school.settings',
          requires: 'school.settings.view',
        },
      ],
    }),
    sis: feature({
      name: 'Students',
      release: 'R1',
      requires: ['school.academics'],
      limits: ['school.students.max'],
      scopes: ['own', 'assigned', 'branch', 'company'],
      resources: {
        students: actions(['view', 'create', 'update', 'export', 'import', 'view_sensitive']),
        // contact_view is the sensitive guardian contact group (Part 04 §4.9.4).
        guardians: actions(['view', 'create', 'update'], { special: ['contact_view'] }),
        families: actions(['view', 'create', 'update']),
        medical: actions(['view']),
        certificates: actions(['view'], { special: ['issue'] }),
        withdrawals: actions(['view', 'create', 'approve']),
        promotions: actions(['view'], { special: ['run'] }),
        settings: shared.settings,
        reports: shared.reports,
      },
      menu: [
        {
          path: '/school/students',
          label: 'nav.school.students',
          requires: 'school.students.view',
        },
      ],
    }),
    admissions: feature({
      name: 'Admissions',
      release: 'R1',
      requires: ['school.sis'],
      scopes: ['own', 'assigned', 'branch', 'company'],
      resources: {
        enquiries: actions(['view', 'create', 'update', 'assign']),
        applications: actions(['view', 'create', 'update', 'reject'], {
          special: ['offer', 'enroll'],
        }),
        admission_tests: actions(['view', 'create', 'update'], { special: ['enter_marks'] }),
        merit_lists: actions(['view', 'create'], { special: ['publish'] }),
        offers: actions(['view', 'create', 'cancel']),
      },
      menu: [
        {
          path: '/school/admissions',
          label: 'nav.school.admissions',
          requires: 'school.applications.view',
        },
      ],
    }),
    attendance: feature({
      name: 'Student Attendance',
      release: 'R1',
      requires: ['school.sis'],
      scopes: ['own', 'assigned', 'branch', 'company'],
      resources: {
        attendance: actions(['view', 'update'], { special: ['mark', 'approve_leave'] }),
        leave_requests: actions(['view', 'create', 'approve']),
        reports: shared.reports,
      },
      menu: [
        {
          path: '/school/attendance',
          label: 'nav.school.attendance',
          requires: 'school.attendance.view',
        },
      ],
    }),
    fees: feature({
      name: 'Fees & Challans',
      release: 'R1',
      requires: ['school.sis', 'finance.core'],
      recommends: ['localization.pk.onebill'],
      scopes: ['own', 'assigned', 'branch', 'company'],
      resources: {
        fee_heads: actions(['view', 'create', 'update', 'delete']),
        fee_structures: actions(['view', 'create', 'update', 'delete']),
        challans: actions(['view', 'print', 'send', 'cancel'], { special: ['generate'] }),
        payments: actions(['view', 'import'], { special: ['receive', 'reconcile', 'refund'] }),
        concessions: actions(['view', 'create', 'approve']),
        fines: actions(['view'], { special: ['waive'] }),
        reports: shared.reports,
      },
      menu: [{ path: '/school/fees', label: 'nav.school.fees', requires: 'school.challans.view' }],
    }),
    exams: feature({
      name: 'Exams & Report Cards',
      release: 'R1',
      requires: ['school.academics', 'school.sis'],
      recommends: ['school.attendance'],
      scopes: ['own', 'assigned', 'branch', 'company'],
      resources: {
        exams: actions(['view', 'create', 'update'], { special: ['schedule'] }),
        marks: actions(['view', 'update'], { special: ['enter', 'lock'] }),
        results: actions(['view'], { special: ['publish'] }),
        report_cards: actions(['view', 'print'], { special: ['publish'] }),
        grading_scales: actions(['view', 'create', 'update']),
        reports: shared.reports,
      },
      menu: [{ path: '/school/exams', label: 'nav.school.exams', requires: 'school.exams.view' }],
    }),
    portal: feature({
      name: 'Parent & Student Portal',
      release: 'R1',
      requires: ['school.sis'],
      resources: { portal_access: actions(['view'], { special: ['invite', 'revoke'] }) },
    }),
    comms: feature({
      name: 'Guardian Communication',
      release: 'R1',
      requires: ['school.sis'],
      resources: {
        messages: actions(['view', 'send'], { special: ['broadcast'] }),
        message_templates: actions(['view', 'create', 'update']),
      },
      menu: [
        {
          path: '/school/communication',
          label: 'nav.school.communication',
          requires: 'school.messages.view',
        },
      ],
    }),
    timetable: feature({
      name: 'Timetable',
      release: 'R2',
      requires: ['school.academics'],
      resources: {
        timetables: actions(['view', 'create', 'update'], { special: ['publish'] }),
        substitutions: actions(['view', 'create']),
      },
      menu: [
        {
          path: '/school/timetable',
          label: 'nav.school.timetable',
          requires: 'school.timetables.view',
        },
      ],
    }),
    lms: feature({
      name: 'Homework & Diary',
      release: 'R2',
      requires: ['school.academics'],
      resources: {
        diary: actions(['view', 'create', 'update']),
        homework: actions(['view', 'create', 'update'], { special: ['review'] }),
      },
      menu: [{ path: '/school/diary', label: 'nav.school.diary', requires: 'school.diary.view' }],
    }),
    transport: feature({
      name: 'Transport',
      release: 'R2',
      requires: ['school.sis', 'fleet.vehicles'],
      resources: {
        routes: actions(['view', 'create', 'update', 'delete']),
        route_assignments: actions(['view', 'assign']),
      },
      menu: [
        {
          path: '/school/transport',
          label: 'nav.school.transport',
          requires: 'school.routes.view',
        },
      ],
    }),
    library: feature({
      name: 'Library',
      release: 'R2',
      requires: ['school.sis'],
      resources: {
        library_items: actions(['view', 'create', 'update', 'delete']),
        loans: actions(['view'], { special: ['issue', 'return', 'renew'] }),
      },
      menu: [
        {
          path: '/school/library',
          label: 'nav.school.library',
          requires: 'school.library_items.view',
        },
      ],
    }),
    hostel: feature({
      name: 'Hostel',
      release: 'R3',
      requires: ['school.sis'],
      resources: {
        hostel_rooms: actions(['view', 'create', 'update', 'delete']),
        hostel_allocations: actions(['view', 'assign']),
      },
      menu: [
        {
          path: '/school/hostel',
          label: 'nav.school.hostel',
          requires: 'school.hostel_rooms.view',
        },
      ],
    }),
  },
});
