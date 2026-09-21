// One-off/idempotent seed: populates the Employee Current Information dropdown
// masters (Employee Category, Grade, Shift, Designation/Position, Department)
// with dummy/test data for every company, wherever those masters are empty.
//
// Safe to re-run: every row is upserted against its unique (companyId, code)
// key (or (name, companyId) for Department), so it never duplicates or
// overwrites a company's own existing records — it only fills gaps.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEPARTMENTS = [
  { name: 'Human Resources', description: 'HR & Personnel Administration' },
  { name: 'Finance & Accounts', description: 'Accounting, Treasury & Financial Reporting' },
  { name: 'Information Technology', description: 'IT Systems & Support' },
  { name: 'Operations', description: 'Day-to-day Operations' },
  { name: 'Sales & Marketing', description: 'Sales, Marketing & Business Development' },
];

const EMPLOYEE_CATEGORIES = [
  { code: 'PERM', name: 'Permanent' },
  { code: 'CONT', name: 'Contract' },
  { code: 'PROB', name: 'Probation' },
  { code: 'TEMP', name: 'Temporary' },
];

const GRADES = [
  { code: 'G1', description: 'Grade 1 - Junior' },
  { code: 'G2', description: 'Grade 2 - Mid' },
  { code: 'G3', description: 'Grade 3 - Senior' },
  { code: 'G4', description: 'Grade 4 - Management' },
];

const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon-Fri
const SHIFTS = [
  { code: 'MORN', name: 'Morning Shift', startTime: '09:00', endTime: '17:00', isOvernight: false, breakMinutes: 60, workDays: WEEKDAYS },
  { code: 'EVE', name: 'Evening Shift', startTime: '14:00', endTime: '22:00', isOvernight: false, breakMinutes: 45, workDays: WEEKDAYS },
  { code: 'NIGHT', name: 'Night Shift', startTime: '22:00', endTime: '06:00', isOvernight: true, breakMinutes: 45, workDays: WEEKDAYS },
];

const POSITIONS = [
  { code: 'MGR', title: 'Manager', level: 3 },
  { code: 'AMGR', title: 'Assistant Manager', level: 2 },
  { code: 'SOFF', title: 'Senior Officer', level: 2 },
  { code: 'OFF', title: 'Officer', level: 1 },
  { code: 'EXEC', title: 'Executive', level: 1 },
];

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  console.log(`Seeding HR dropdown masters for ${companies.length} companies...`);

  for (const company of companies) {
    for (const d of DEPARTMENTS) {
      await prisma.department.upsert({
        where: { name_companyId: { name: d.name, companyId: company.id } },
        update: {},
        create: { companyId: company.id, name: d.name, description: d.description },
      });
    }

    for (const c of EMPLOYEE_CATEGORIES) {
      await prisma.employeeCategory.upsert({
        where: { companyId_code: { companyId: company.id, code: c.code } },
        update: {},
        create: { companyId: company.id, code: c.code, name: c.name },
      });
    }

    for (const g of GRADES) {
      await prisma.grade.upsert({
        where: { companyId_code: { companyId: company.id, code: g.code } },
        update: {},
        create: { companyId: company.id, code: g.code, description: g.description },
      });
    }

    for (const s of SHIFTS) {
      await prisma.shift.upsert({
        where: { companyId_code: { companyId: company.id, code: s.code } },
        update: {},
        create: {
          companyId: company.id,
          code: s.code,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          isOvernight: s.isOvernight,
          breakMinutes: s.breakMinutes,
          workDays: s.workDays,
        },
      });
    }

    for (const p of POSITIONS) {
      await prisma.position.upsert({
        where: { companyId_title: { companyId: company.id, title: p.title } },
        update: {},
        create: { companyId: company.id, title: p.title, code: p.code, level: p.level },
      });
    }

    console.log(`  ✔ ${company.name}`);
  }

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
