import { Controller, INestApplication, Param, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Public } from '../../src/common/decorators/public.decorator';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * QA Round 3, Q5: a refusal raised *inside Postgres* — a CHECK constraint, one
 * of our ERP_RULE triggers, or a ledger guard — must reach the caller as a
 * readable 4xx, never as the anonymous "Internal server error (reference …)"
 * this whole task started from.
 *
 * The services validate first, so no production route normally reaches these
 * constraints; that is the point of them. To drive each one through the real
 * HTTP pipeline (guards → handler → AllExceptionsFilter → response), the app
 * is booted with one extra test-only controller that performs the raw write.
 */
let fixture: { companyId: string; postedRun: string; recoveryId: string; postedJe: string | null };

@Controller('__test__/db-rules')
class DbRulesTestController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post(':scenario')
  async run(@Param('scenario') scenario: string) {
    const p = this.prisma;
    const f = fixture;
    switch (scenario) {
      case 'check-regular-needs-period':
        return p.payrollRun.create({ data: { companyId: f.companyId, runType: 'Regular', status: 'Open' } });
      case 'check-unknown-run-type':
        return p.payrollRun.create({ data: { companyId: f.companyId, runType: 'Weekly', status: 'Open' } });
      case 'trigger-line-on-posted-run':
        return p.payrollRunLine.updateMany({ where: { payrollRunId: f.postedRun }, data: { basic: 1 } });
      case 'trigger-line-on-posted-run-raw':
        return p.$executeRawUnsafe(`UPDATE payroll_run_lines SET basic = 1 WHERE "payrollRunId" = $1`, f.postedRun);
      case 'trigger-reopen-posted-run':
        return p.payrollRun.update({ where: { id: f.postedRun }, data: { status: 'Open' } });
      case 'trigger-edit-recovery':
        return p.loanRecovery.update({ where: { id: f.recoveryId }, data: { amount: 1 } });
      case 'ledger-guard-edit-posted-je':
        return p.journalEntry.update({ where: { id: f.postedJe! }, data: { description: 'tampered' } });
      default:
        return { ok: true };
    }
  }
}

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [DbRulesTestController] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  prisma = app.get(PrismaService);

  const stamp = Date.now();
  const company = await prisma.company.create({ data: { name: `DB Rules ${stamp}`, slug: `db-rules-${stamp}`, currency: 'PKR' } });
  const period = await prisma.payPeriod.create({
    data: { companyId: company.id, code: 'P1', name: 'P1', fromDate: new Date('2026-01-01'), toDate: new Date('2026-01-31') },
  });
  const emp = await prisma.employee.create({ data: { companyId: company.id, name: 'Rule Emp' } });
  const run = await prisma.payrollRun.create({ data: { companyId: company.id, payPeriodId: period.id, runType: 'Regular', status: 'Open' } });
  await prisma.payrollRunLine.create({ data: { payrollRunId: run.id, employeeId: emp.id, basic: 1000 } });
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'Posted' } });
  const lt = await prisma.loanType.create({ data: { companyId: company.id, code: 'PL', description: 'PL' } });
  const loan = await prisma.employeeLoan.create({ data: { companyId: company.id, code: 'L1', employeeId: emp.id, loanTypeId: lt.id, loanAmount: 500 } });
  const inst = await prisma.employeeLoanInstallment.create({ data: { loanId: loan.id, amount: 500 } });
  const rec = await prisma.loanRecovery.create({
    data: { companyId: company.id, loanId: loan.id, installmentId: inst.id, amount: 100, source: 'payroll', payrollRunId: run.id },
  });
  // Any posted journal entry will do for the ledger guard (read-only use).
  const je = await prisma.journalEntry.findFirst({ where: { status: 'POSTED' }, select: { id: true } });
  fixture = { companyId: company.id, postedRun: run.id, recoveryId: rec.id, postedJe: je?.id ?? null };
}, 120_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`ALTER TABLE payroll_runs DISABLE TRIGGER payroll_runs_lock`);
  try {
    await prisma.company.delete({ where: { id: fixture.companyId } });
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE payroll_runs ENABLE TRIGGER payroll_runs_lock`);
    await app.close();
  }
});

const hit = (scenario: string) => request(app.getHttpServer()).post(`/api/v1/__test__/db-rules/${scenario}`).send();

describe('database refusals reach the caller as readable 4xx, never a 500', () => {
  it.each([
    ['check-regular-needs-period', 400, /A Regular payroll run needs a Pay Period/],
    ['check-unknown-run-type', 400, /Run type must be Regular, Supplementary, Off-cycle or Bonus/],
    ['trigger-line-on-posted-run', 409, /This payroll run is posted — its lines can no longer change/],
    ['trigger-line-on-posted-run-raw', 409, /This payroll run is posted — its lines can no longer change/],
    ['trigger-reopen-posted-run', 409, /cannot be reopened/],
    ['trigger-edit-recovery', 409, /A loan recovery cannot be edited; reverse it instead/],
  ])('%s → %i', async (scenario, status, message) => {
    const res = await hit(scenario);
    expect(res.status).toBe(status);
    expect(String(res.body.message)).toMatch(message);
    expect(String(res.body.message)).not.toMatch(/Internal server error|ERP_RULE|ConnectorError/);
  });

  it('ledger guard (posted journal entry edited) → 409 with the guard\'s own words', async () => {
    if (!fixture.postedJe) return; // no posted entry in this database
    const res = await hit('ledger-guard-edit-posted-je');
    expect(res.status).toBe(409);
    expect(String(res.body.message)).toMatch(/is posted and immutable/);
  });

  it('a healthy request is untouched', async () => {
    expect((await hit('noop')).status).toBe(201);
  });
});
