import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { assertDisposableDatabase, balance } from './harness';

/**
 * Fixed Assets FA-1 end to end, against the QA brief's fixture and figures
 * (qa-evidence/fixed-assets/FA-1-QA-brief.md, Part 7).
 *
 * The suite onboards its own company through POST /companies/onboard (local
 * currency PKR, calendar fiscal year) and then works as that company's own
 * Company Admin, not as a super admin: on payroll, super-admin testing hid
 * exactly the permission gaps a real admin hits (FA-D14). The app runs with the
 * production pipes and filter, so a refusal arrives as the client would see it.
 *
 * Accounts as in the brief: 1510 Computer Equipment (FIXED_ASSET), 1519 Acc.
 * Depreciation, 6110 Depreciation Expense, 2190 Asset Acquisition Clearing;
 * asset class IT, MAIN straight-line over 60 months; FA-00001 "Dell Latitude
 * 7440", salvage 0, cost center Admin.
 */
const prisma = new PrismaClient();
const stamp = Date.now();
const PASSWORD = 'FixedAssets#2026';
let app: INestApplication;
let superToken = '';
let adminToken = '';
let companyId = '';
let otherCompanyId = '';
let otherAdminToken = '';

type Res = { status: number; body: any };
const call = async (
  token: string,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> => {
  let req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  const res = await (body === undefined ? req.send() : req.send(body as object));
  const payload =
    res.body && res.body.success === true && 'data' in res.body
      ? res.body.data
      : res.body;
  return { status: res.status, body: payload };
};
const api = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => call(adminToken, method, path, body, headers);
/**
 * Cross-checks outside Fixed Assets (trial balance, balance sheet, manual
 * journal entries, A/P invoices) go through a super admin who chose the
 * company: the template's Company Admin role carries only the module-level
 * financials keys, not financials.report / journal / ap_bill — a gap that
 * predates FA-1 and is listed in the report.
 */
const asSuper = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  body?: unknown,
) => call(superToken, method, path, body, { 'x-company-id': companyId });
const msg = (r: Res) => String(r.body?.message ?? r.body?.error ?? JSON.stringify(r.body));

const login = async (email: string, companySlug?: string) => {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, ...(companySlug ? { companySlug } : {}) });
  const token = res.body?.data?.accessToken ?? res.body?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return token as string;
};

const onboard = async (slug: string, name: string) => {
  const res = await call(superToken, 'post', '/companies/onboard', {
    name,
    slug,
    currency: 'PKR',
    fiscalYearStart: 1,
    planKey: 'starter',
    adminName: `${name} Admin`,
    adminEmail: `admin.${slug}@example.com`,
    adminPassword: PASSWORD,
  });
  if (res.status >= 300) throw new Error(`onboarding failed: ${res.status} ${msg(res)}`);
  const company = await prisma.company.findUniqueOrThrow({ where: { slug } });
  return { id: company.id, token: await login(`admin.${slug}@example.com`, slug) };
};

// Fixture ids
const acct = { apc: '', acc: '', exp: '', clr: '', exp2: '', clr3: '', apControl: '' };
let classId = '';
let mainAreaId = '';
let taxAreaId = '';
let costCenterId = '';
let distributionRuleId = '';
let projectId = '';
let branchId = '';
let employeeId = '';
let technicianId = '';
let vendorId = '';
let customerId = '';
let fa1 = '';
let t1Id = '';
let t3Id = '';

const bal = (code: string) => balance(prisma, companyId, code);
const asset = async (id: string) => (await api('get', `/financials/fixed-assets/${id}`)).body;
const main = (a: any) => a.areaValues.find((v: any) => v.areaId === mainAreaId);
const num = (v: unknown) => Number(v);
const newAsset = (body: Record<string, unknown> = {}) =>
  api('post', '/financials/fixed-assets', {
    name: `Asset ${stamp}`,
    assetClassId: classId,
    ...body,
  });
const capitalize = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  api('post', '/financials/asset-capitalizations', body, headers);
const dryRun = async (assetId: string, postingDate: string) => {
  const r = await api('post', '/financials/fixed-assets/depreciation-run', {
    postingDate,
    assetIds: [assetId],
    dryRun: true,
  });
  expect(r.status).toBe(201);
  return r.body.results.find((x: any) => x.area === 'MAIN');
};
const jeLines = async (journalEntryId: string) =>
  (
    await prisma.journalLine.findMany({
      where: { entryId: journalEntryId },
      include: { account: { select: { code: true } } },
    })
  ).map((l) => ({
    code: l.account.code,
    debit: num(l.debit),
    credit: num(l.credit),
    costCenterId: l.costCenterId,
    projectId: l.projectId,
  }));
const tbRow = async (code: string) => {
  const tb = await asSuper('get', '/financials/reports/trial-balance');
  expect(tb.status).toBe(200);
  return tb.body.rows.find((r: any) => r.code === code);
};

beforeAll(async () => {
  assertDisposableDatabase();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();

  const superEmail = `fa.super.${stamp}@example.com`;
  await prisma.user.create({
    data: {
      name: 'FA Super',
      email: superEmail,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      isSuperAdmin: true,
      roleType: 'SUPER_ADMIN',
      passwordChangedAt: new Date(),
    },
  });
  superToken = await login(superEmail);

  ({ id: companyId, token: adminToken } = await onboard(`fa-co-${stamp}`, `FA Co ${stamp}`));
  ({ id: otherCompanyId, token: otherAdminToken } = await onboard(`fa-other-${stamp}`, `FA Other ${stamp}`));

  const mk = async (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EXPENSE', subtype?: 'FIXED_ASSET') =>
    (
      await prisma.account.create({
        data: { companyId, code, name, type, currency: 'PKR', ...(subtype ? { subtype } : {}) },
      })
    ).id;
  acct.apc = await mk('1510', 'Computer Equipment', 'ASSET', 'FIXED_ASSET');
  acct.acc = await mk('1519', 'Acc. Depreciation – Computer Equipment', 'ASSET');
  acct.exp = await mk('6110', 'Depreciation Expense', 'EXPENSE');
  acct.clr = await mk('2190', 'Asset Acquisition Clearing', 'LIABILITY');
  acct.exp2 = await mk('6111', 'Depreciation Expense – IT', 'EXPENSE');
  acct.clr3 = await mk('2193', 'Clearing (to be deactivated)', 'LIABILITY');
  acct.apControl = (await prisma.account.findFirstOrThrow({ where: { companyId, isControl: true, type: 'LIABILITY' } })).id;

  const dim =
    (await prisma.dimension.findFirst({ where: { companyId, dimensionNo: 1 } })) ??
    (await prisma.dimension.create({ data: { companyId, dimensionNo: 1, name: 'Departments' } }));
  costCenterId = (await prisma.costCenter.create({ data: { companyId, dimensionId: dim.id, code: 'ADMIN', name: 'Admin' } })).id;
  distributionRuleId = (
    await prisma.distributionRule.create({ data: { companyId, dimensionId: dim.id, code: 'SPLIT', name: 'Split' } })
  ).id;
  projectId = (await prisma.financeProject.create({ data: { companyId, code: 'P-IT', name: 'IT Refresh' } })).id;
  branchId =
    (await prisma.branch.findFirst({ where: { companyId, isActive: true } }))?.id ??
    (await prisma.branch.create({ data: { companyId, name: 'Head Office', code: 'HO' } })).id;
  employeeId = (await prisma.employee.create({ data: { companyId, name: 'Ayesha Custodian', employeeNumber: 'E-1' } })).id;
  technicianId = (await prisma.employee.create({ data: { companyId, name: 'Bilal Technician', employeeNumber: 'E-2' } })).id;
  vendorId = (
    await prisma.businessPartner.create({ data: { companyId, cardCode: 'V-DELL', cardName: 'Dell Pakistan', cardType: 'VENDOR' } })
  ).id;
  customerId = (
    await prisma.businessPartner.create({ data: { companyId, cardCode: 'C-1', cardName: 'A Customer', cardType: 'CUSTOMER' } })
  ).id;
}, 180_000);

afterAll(async () => {
  const triggers = [
    'journal_lines DISABLE TRIGGER journal_line_guard',
    'journal_lines DISABLE TRIGGER journal_line_balance_guard',
    'journal_entries DISABLE TRIGGER journal_entry_guard',
    'journal_entries DISABLE TRIGGER journal_entry_post_guard',
    'asset_capitalizations DISABLE TRIGGER asset_capitalization_guard',
    'asset_capitalization_lines DISABLE TRIGGER asset_capitalization_line_guard',
    'fixed_asset_transactions DISABLE TRIGGER fixed_asset_transaction_guard',
  ];
  try {
    for (const t of triggers) await prisma.$executeRawUnsafe(`ALTER TABLE ${t}`);
    for (const id of [companyId, otherCompanyId].filter(Boolean)) {
      await prisma.fixedAssetTransaction.deleteMany({ where: { companyId: id } });
      await prisma.assetCapitalization.updateMany({
        where: { companyId: id },
        data: { journalEntryId: null, cancellationJournalEntryId: null, baseCapitalizationId: null },
      });
      await prisma.assetCapitalizationLine.deleteMany({ where: { companyId: id } });
      await prisma.assetCapitalization.deleteMany({ where: { companyId: id } });
      await prisma.aPBill.updateMany({ where: { companyId: id }, data: { journalEntryId: null } });
      await prisma.journalEntry.updateMany({ where: { companyId: id }, data: { reversalOfId: null } });
      await prisma.journalLine.deleteMany({ where: { companyId: id } });
      await prisma.journalEntry.deleteMany({ where: { companyId: id } });
      await prisma.fixedAssetAreaValue.deleteMany({ where: { companyId: id } });
      await prisma.fixedAsset.deleteMany({ where: { companyId: id } });
      await prisma.assetClass.deleteMany({ where: { companyId: id } });
      await prisma.costCenter.deleteMany({ where: { companyId: id } });
      await prisma.distributionRule.deleteMany({ where: { companyId: id } });
      await prisma.dimension.deleteMany({ where: { companyId: id } });
      await prisma.aPBillLine.deleteMany({ where: { companyId: id } });
      await prisma.aPBill.deleteMany({ where: { companyId: id } });
      await prisma.approvalTemplate.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
  } finally {
    for (const t of triggers) await prisma.$executeRawUnsafe(`ALTER TABLE ${t.replace('DISABLE', 'ENABLE')}`);
    // The users this suite created. The onboarding demo users stay behind
    // with their substitute-authorizer rows, as in payroll-fresh-company.
    await prisma.user.deleteMany({
      where: { email: { in: [`fa.super.${stamp}@example.com`, `fa.viewer.${stamp}@example.com`] } },
    });
    await prisma.$disconnect();
    await app.close();
  }
}, 180_000);

// ─── T11: onboarding gives a company everything Fixed Assets needs ────────────
describe('onboarding (T11, FA-D5, FA-D14)', () => {
  it('comes with the MAIN posting area, the three series, and admin access to every Fixed Assets route', async () => {
    const areas = await prisma.depreciationArea.findMany({ where: { companyId } });
    expect(areas.map((a) => [a.code, a.postsToGl, a.isActive])).toEqual([['MAIN', true, true]]);
    mainAreaId = areas[0].id;

    const series = await prisma.numberingSeries.findMany({
      where: { companyId, documentType: { in: ['fixed_asset', 'fixed_asset_capitalization', 'fixed_asset_credit_memo'] } },
    });
    expect(series.map((s) => `${s.documentType}:${s.prefix}:${s.isDefault}`).sort()).toEqual([
      'fixed_asset:FA-:true',
      'fixed_asset_capitalization:CAP-:true',
      'fixed_asset_credit_memo:CAPCM-:true',
    ]);

    // As the company's own admin, not a super admin.
    for (const path of [
      '/financials/fixed-assets',
      '/financials/fixed-assets/lookups',
      '/financials/asset-classes',
      '/financials/asset-classes/lookups',
      '/financials/depreciation-areas',
      '/financials/asset-capitalizations',
      '/financials/asset-capitalizations/lookups?kind=CREDIT_MEMO',
    ]) {
      const r = await api('get', path);
      expect([path, r.status, r.status === 200 ? '' : msg(r)]).toEqual([path, 200, '']);
    }
  });

  it('replaying the defaults is a no-op', async () => {
    const count = async () => ({
      areas: await prisma.depreciationArea.count({ where: { companyId } }),
      series: await prisma.numberingSeries.count({ where: { companyId, documentType: { startsWith: 'fixed_asset' } } }),
    });
    const before = await count();
    for (let i = 0; i < 2; i++) {
      const log = await prisma.$queryRawUnsafe<{ erp_apply_fixed_asset_defaults: string }[]>(
        'SELECT erp_apply_fixed_asset_defaults($1)',
        companyId,
      );
      expect(log.map((l) => l.erp_apply_fixed_asset_defaults).join(' | ')).toMatch(/kept existing depreciation areas/);
    }
    expect(await count()).toEqual(before);
  });
});

// ─── Setup masters ────────────────────────────────────────────────────────────
describe('asset classes (FA-D4)', () => {
  const base = () => ({
    code: 'IT',
    name: 'Computer equipment',
    depreciationMethod: 'STRAIGHT_LINE',
    usefulLifeMonths: 60,
    assetAccountId: acct.apc,
    accumulatedDepreciationAccountId: acct.acc,
    depreciationExpenseAccountId: acct.exp,
    clearingAccountId: acct.clr,
  });

  it('refuses accounts that would not reconcile', async () => {
    const notFixedAsset = await api('post', '/financials/asset-classes', { ...base(), assetAccountId: acct.acc, accumulatedDepreciationAccountId: acct.apc });
    expect(notFixedAsset.status).toBe(400);
    expect(msg(notFixedAsset)).toMatch(/1519 .* must be an account of subtype FIXED_ASSET/);

    const sameAsClearing = await api('post', '/financials/asset-classes', { ...base(), clearingAccountId: acct.apc });
    expect(sameAsClearing.status).toBe(400);

    const wrongType = await api('post', '/financials/asset-classes', { ...base(), depreciationExpenseAccountId: acct.clr });
    expect(wrongType.status).toBe(400);
    expect(msg(wrongType)).toMatch(/expected expense/i);

    const control = await api('post', '/financials/asset-classes', { ...base(), clearingAccountId: acct.apControl });
    expect(control.status).toBe(400);
    expect(msg(control)).toMatch(/control account/);
  });

  it('creates class IT on 1510 / 1519 / 6110 / 2190, straight line over 60 months', async () => {
    const res = await api('post', '/financials/asset-classes', base());
    expect(res.status).toBe(201);
    classId = res.body.id;
    expect(res.body.assetAccount.code).toBe('1510');
    expect(res.body.clearingAccount.code).toBe('2190');
  });

  it('T7: the database refuses a class pointing at another company’s account', async () => {
    const foreign = await prisma.account.findFirstOrThrow({ where: { companyId: otherCompanyId, type: 'ASSET', isTitle: false } });
    await expect(
      prisma.assetClass.create({
        data: {
          companyId,
          code: 'XT',
          name: 'Cross-tenant',
          assetAccountId: foreign.id,
          accumulatedDepreciationAccountId: acct.acc,
          depreciationExpenseAccountId: acct.exp,
          clearingAccountId: acct.clr,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});

describe('depreciation areas (FA-D5)', () => {
  it('allows one posting area only, and adds a statistical TAX area', async () => {
    const second = await api('post', '/financials/depreciation-areas', { code: 'BOOK2', name: 'Second posting', postsToGl: true });
    expect(second.status).toBe(409);
    const tax = await api('post', '/financials/depreciation-areas', { code: 'TAX', name: 'Tax', postsToGl: false, ordering: 2 });
    expect(tax.status).toBe(201);
    taxAreaId = tax.body.id;
  });
});

// ─── Asset Master Data ────────────────────────────────────────────────────────
describe('asset master data', () => {
  it('numbers FA-00001 from the default series and copies the class defaults into every area', async () => {
    const res = await newAsset({ name: 'Dell Latitude 7440', costCenterId });
    expect(res.status).toBe(201);
    fa1 = res.body.id;
    expect(res.body.code).toBe('FA-00001');
    expect(res.body.status).toBe('NEW');
    expect(res.body.deletable).toBe(true);
    expect(res.body.locked).toBe(false);
    expect(res.body.quantity).toBe(0);
    expect(res.body.areaValues.map((v: any) => [v.area.code, v.depreciationMethod, v.usefulLifeMonths, num(v.salvageValue)])).toEqual([
      ['MAIN', 'STRAIGHT_LINE', 60, 0],
      ['TAX', 'STRAIGHT_LINE', 60, 0],
    ]);
  });

  it('T9: every SAVE and LINK field round-trips, and clearing a field clears it', async () => {
    const full = {
      name: 'HP LaserJet M507',
      foreignName: 'ایچ پی لیزر جیٹ 🖨️',
      barCode: `BC-${stamp}`,
      manufacturer: 'HP',
      additionalIdentifier: 'TAG-77',
      inventoryNo: 'INV-0042',
      serialNumber: 'SN-PRN-1',
      branchId,
      employeeId,
      technicianId,
      vendorId,
      mfrCatalogNo: 'M507DN',
      purchaseDate: '2026-08-20',
      purchaseCost: 85000.5,
      projectId,
      distributionRuleId,
      remarks: 'دفتر کا پرنٹر — first floor ✅',
      isActive: true,
    };
    const created = await newAsset(full);
    expect(created.status).toBe(201);
    const a = await asset(created.body.id);
    expect({
      name: a.name,
      foreignName: a.foreignName,
      barCode: a.barCode,
      manufacturer: a.manufacturer,
      additionalIdentifier: a.additionalIdentifier,
      inventoryNo: a.inventoryNo,
      serialNumber: a.serialNumber,
      branchId: a.branch.id,
      employeeId: a.employee.id,
      technicianId: a.technician.id,
      vendorId: a.vendor.id,
      mfrCatalogNo: a.mfrCatalogNo,
      purchaseDate: a.purchaseDate.slice(0, 10),
      purchaseCost: num(a.purchaseCost),
      projectId: a.project.id,
      distributionRuleId: a.distributionRule.id,
      remarks: a.remarks,
      isActive: a.isActive,
    }).toEqual(full);
    expect(a.vendorCardType).toBe('VENDOR');

    const cleared = await api('put', `/financials/fixed-assets/${a.id}`, {
      foreignName: '',
      barCode: '',
      vendorId: '',
      purchaseDate: null,
      purchaseCost: null,
      distributionRuleId: '',
      costCenterId,
    });
    expect(cleared.status).toBe(200);
    const b = await asset(a.id);
    expect([b.foreignName, b.barCode, b.vendor, b.vendorCardType, b.purchaseDate, b.purchaseCost, b.distributionRule, b.costCenter.id]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      costCenterId,
    ]);
  });

  it('Find searches code, description, serial number, inventory no. and bar code', async () => {
    for (const term of ['FA-00001', 'latitude', 'SN-PRN-1', 'INV-0042']) {
      const r = await api('get', `/financials/fixed-assets?search=${encodeURIComponent(term)}`);
      expect([term, r.status, r.body.length > 0]).toEqual([term, 200, true]);
    }
    const none = await api('get', '/financials/fixed-assets?search=no-such-asset-zzz');
    expect(none.body).toEqual([]);
  });

  it('refuses a customer as preferred vendor, both clearly and in the database (T7)', async () => {
    const res = await newAsset({ vendorId: customerId });
    expect(res.status).toBe(400);
    expect(msg(res)).toMatch(/is not a vendor/);
    const cls = await prisma.assetClass.findUniqueOrThrow({ where: { id: classId } });
    await expect(
      prisma.fixedAsset.create({ data: { companyId, code: 'RAW-1', name: 'raw', assetClassId: cls.id, vendorId: customerId, vendorCardType: 'VENDOR' } }),
    ).rejects.toThrow(/Foreign key constraint/);
    await expect(
      prisma.fixedAsset.create({ data: { companyId, code: 'RAW-2', name: 'raw', assetClassId: cls.id, vendorId: customerId, vendorCardType: 'CUSTOMER' } }),
    ).rejects.toThrow(/fixed_assets_vendor_is_vendor|check constraint/i);
  });

  it('cost center and distribution rule are mutually exclusive', async () => {
    const res = await newAsset({ costCenterId, distributionRuleId });
    expect(res.status).toBe(400);
    expect(msg(res)).toMatch(/cost center or a distribution rule/);
  });

  it('a duplicate number is named; lengths are enforced; Urdu and emoji are kept', async () => {
    const dup = await newAsset({ code: 'FA-00001' });
    expect(dup.status).toBe(409);
    expect(msg(dup)).toMatch(/FA-00001 already exists/);
    expect((await newAsset({ name: 'x'.repeat(201) })).status).toBe(400);
    const long = await newAsset({ name: 'd'.repeat(200), remarks: 'r'.repeat(5000) });
    expect(long.status).toBe(201);
    expect((await newAsset({ remarks: 'r'.repeat(5001) })).status).toBe(400);
    expect((await newAsset({ name: '' })).status).toBe(400);
    expect((await newAsset({ assetClassId: undefined })).status).toBe(400);
  });

  it('a new asset can change class (re-copying its defaults) and be deleted while it has no postings', async () => {
    const other = await api('post', '/financials/asset-classes', {
      code: 'IT36',
      name: 'Short-life IT',
      usefulLifeMonths: 36,
      depreciationMethod: 'SUM_OF_YEARS',
      assetAccountId: acct.apc,
      accumulatedDepreciationAccountId: acct.acc,
      depreciationExpenseAccountId: acct.exp,
      clearingAccountId: acct.clr,
    });
    expect(other.status).toBe(201);
    const a = (await newAsset()).body;
    const moved = await api('put', `/financials/fixed-assets/${a.id}`, { assetClassId: other.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body.areaValues.map((v: any) => [v.depreciationMethod, v.usefulLifeMonths])).toEqual([
      ['SUM_OF_YEARS', 36],
      ['SUM_OF_YEARS', 36],
    ]);
    const del = await api('delete', `/financials/fixed-assets/${a.id}`);
    expect(del.status).toBe(200);
    expect(await prisma.fixedAsset.count({ where: { id: a.id } })).toBe(0);
  });
});

// ─── T1–T5: the brief's figures ───────────────────────────────────────────────
describe('T1–T5 on FA-00001', () => {
  it('T1: capitalizes 120,000.00 — Dr 1510 / Cr 2190 in PKR, asset Active from 01.09.2026', async () => {
    const res = await capitalize(
      {
        postingDate: '2026-10-05',
        documentDate: '2026-10-05',
        assetValueDate: '2026-09-01',
        reference: 'PO-7440',
        lines: [{ assetId: fa1, amount: 120000, quantity: 1 }],
      },
      { 'Idempotency-Key': `t1-${stamp}` },
    );
    expect(res.status).toBe(201);
    t1Id = res.body.id;
    expect(res.body.number).toBe('CAP-00001');
    expect(res.body.status).toBe('POSTED');
    expect(res.body.journalRemark).toBe('Capitalization');

    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.body.journalEntry.id } });
    expect([je.currency, je.date.toISOString().slice(0, 10), je.source, je.sourceId, je.reference, je.description]).toEqual([
      'PKR',
      '2026-10-05',
      'fixed_asset_capitalization',
      t1Id,
      'CAP-00001',
      'Capitalization',
    ]);
    const lines = await jeLines(je.id);
    expect(lines.map((l) => [l.code, l.debit, l.credit]).sort()).toEqual([
      ['1510', 120000, 0],
      ['2190', 0, 120000],
    ]);

    const a = await asset(fa1);
    expect(a.status).toBe('CAPITALIZED');
    expect(a.capitalizedAt.slice(0, 10)).toBe('2026-09-01');
    expect(a.quantity).toBe(1);
    const m = main(a);
    expect([num(m.acquisitionCost), num(m.accumulatedDepreciation), num(m.netBookValue)]).toEqual([120000, 0, 120000]);
    expect([m.depreciationStartDate.slice(0, 10), m.endDate.slice(0, 10), m.remainingLifeMonths]).toEqual(['2026-09-01', '2031-08-31', 60]);
    expect([a.locked, a.deletable]).toEqual([true, false]);

    expect((await tbRow('1510')).closing).toBe('120000.00');
    expect((await tbRow('2190')).closing).toBe('120000.00');
    const bs = await asSuper('get', '/financials/reports/balance-sheet?to=2026-10-31');
    expect(bs.body.totals.assets).toBe('120000.00');
  });

  it('T2: a dry run to 31.10.2026 charges 2,000.00 (one month from 01.09)', async () => {
    expect((await dryRun(fa1, '2026-10-31')).charge).toBe('2000.00');
    // Nothing on 30.09: the first month completes on 01.10.
    expect(await dryRun(fa1, '2026-09-30')).toBeUndefined();
  });

  it('T3: a credit memo of 20,000.00 posts Dr 2190 / Cr 1510 and leaves APC 100,000.00', async () => {
    const res = await capitalize({
      kind: 'CREDIT_MEMO',
      postingDate: '2026-10-10',
      lines: [{ assetId: fa1, amount: 20000, quantity: 0 }],
    });
    expect(res.status).toBe(201);
    t3Id = res.body.id;
    expect(res.body.number).toBe('CAPCM-00001');
    expect(res.body.journalRemark).toBe('Capitalization Credit Memo');
    const lines = await jeLines(res.body.journalEntry.id);
    expect(lines.map((l) => [l.code, l.debit, l.credit]).sort()).toEqual([
      ['1510', 0, 20000],
      ['2190', 20000, 0],
    ]);
    const a = await asset(fa1);
    expect([num(main(a).acquisitionCost), num(main(a).netBookValue), a.quantity]).toEqual([100000, 100000, 1]);
    expect((await dryRun(fa1, '2026-10-31')).charge).toBe('1666.67');
  });

  it('T4: cancelling the credit memo reverses its JE and restores APC 120,000.00', async () => {
    const res = await api('post', `/financials/asset-capitalizations/${t3Id}/cancel`, { reason: 'Wrong amount' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CANCELLED');
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.body.journalEntry.id } });
    expect(original.status).toBe('REVERSED');
    const mirror = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.body.cancellationJournalEntry.id } });
    expect(mirror.reversalOfId).toBe(original.id);
    expect((await jeLines(mirror.id)).map((l) => [l.code, l.debit, l.credit]).sort()).toEqual([
      ['1510', 20000, 0],
      ['2190', 0, 20000],
    ]);
    const a = await asset(fa1);
    expect(num(main(a).acquisitionCost)).toBe(120000);
    // Both the original and its reversal are counted.
    const tb = await tbRow('1510');
    expect([tb.debit, tb.credit, tb.closing]).toEqual(['140000.00', '20000.00', '120000.00']);

    const values = (await api('get', `/financials/fixed-assets/${fa1}/values`)).body;
    const y2026 = values.find((v: any) => v.area.code === 'MAIN').years.find((y: any) => y.fiscalYear === 2026);
    expect([y2026.apcFirstDay, y2026.acquisition, y2026.retirement, y2026.transfer, y2026.writeUp, y2026.apcLastDay, y2026.nbvLastDay]).toEqual([
      '0.00',
      '120000.00',
      '0.00',
      '0.00',
      '0.00',
      '120000.00',
      '120000.00',
    ]);
  });

  it('T5: the real run to 31.10.2026 posts Dr 6110 2,000.00 (cost center Admin) / Cr 1519 2,000.00, once', async () => {
    const before = { exp: await bal('6110'), acc: await bal('1519') };
    const [r1, r2] = await Promise.all([
      api('post', '/financials/fixed-assets/depreciation-run', { postingDate: '2026-10-31', assetIds: [fa1] }),
      api('post', '/financials/fixed-assets/depreciation-run', { postingDate: '2026-10-31', assetIds: [fa1] }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(await bal('6110')).toBe(before.exp + 2000);
    // An asset account: the credit lowers its natural balance.
    expect(await bal('1519')).toBe(before.acc - 2000);

    const je = await prisma.journalEntry.findFirstOrThrow({ where: { companyId, source: 'fixed_asset_depreciation', sourceId: fa1 } });
    const lines = await jeLines(je.id);
    expect(lines.find((l) => l.code === '6110')).toMatchObject({ debit: 2000, costCenterId });
    expect(lines.find((l) => l.code === '1519')).toMatchObject({ credit: 2000, costCenterId: null });

    const a = await asset(fa1);
    expect([num(main(a).accumulatedDepreciation), num(main(a).netBookValue), main(a).remainingLifeMonths]).toEqual([2000, 118000, 59]);
    const forecast = (await api('get', `/financials/fixed-assets/${fa1}/forecast?months=2`)).body;
    expect(forecast.rows.map((r: any) => [r.month, r.date, r.charge])).toEqual([
      [2, '2026-11-30', '2000.00'],
      [3, '2026-12-31', '2000.00'],
    ]);
  });

  it('T5(a): no credit memo or addition after depreciation has started (FA-D6)', async () => {
    for (const kind of ['CREDIT_MEMO', 'CAPITALIZATION']) {
      const r = await capitalize({ kind, postingDate: '2026-10-31', lines: [{ assetId: fa1, amount: 100, quantity: 0 }] });
      expect(r.status).toBe(409);
      expect(msg(r)).toBe(
        'Asset FA-00001 already has depreciation posted (to 31.10.2026). Additions and credit memos after depreciation starts arrive with the depreciation rework (FA-2).',
      );
    }
  });

  it('T5(b, c): T1 cannot be cancelled and FA-00001 cannot be deleted', async () => {
    const cancel = await api('post', `/financials/asset-capitalizations/${t1Id}/cancel`, {});
    expect(cancel.status).toBe(409);
    expect(msg(cancel)).toMatch(/FA-00001 has later movements/);
    const del = await api('delete', `/financials/fixed-assets/${fa1}`);
    expect(del.status).toBe(409);
    expect(msg(del)).toMatch(/Deactivate it instead/);
  });

  it('T5(d): the Journal Entry window refuses to reverse the capitalization or depreciation JE (B4)', async () => {
    const t1 = (await api('get', `/financials/asset-capitalizations/${t1Id}`)).body;
    const r = await asSuper('post', `/financials/journal-entries/${t1.journalEntry.id}/reverse`, {});
    expect(r.status).toBe(409);
    expect(msg(r)).toMatch(/Cancel it in Financials → Fixed Assets → Capitalization/);
    const dep = await prisma.journalEntry.findFirstOrThrow({ where: { companyId, source: 'fixed_asset_depreciation' } });
    expect((await asSuper('post', `/financials/journal-entries/${dep.id}/reverse`, {})).status).toBe(409);
  });

  it('T5(e): a manual journal entry to 1510 or 1519 is refused (FA-D9); 6110 is not', async () => {
    for (const [accountId, code] of [
      [acct.apc, '1510'],
      [acct.acc, '1519'],
    ]) {
      const r = await asSuper('post', '/financials/journal-entries', {
        date: '2026-10-15',
        currency: 'PKR',
        post: true,
        description: 'manual',
        lines: [
          { accountId, debit: 10 },
          { accountId: acct.exp, credit: 10 },
        ],
      });
      expect(r.status).toBe(400);
      expect(msg(r)).toBe(`Line 1: Account ${code} is maintained by Fixed Assets; post through Capitalization / Credit Memo.`);
    }
    const ok = await asSuper('post', '/financials/journal-entries', {
      date: '2026-10-15',
      currency: 'PKR',
      post: false,
      lines: [
        { accountId: acct.exp, debit: 10 },
        { accountId: acct.clr, credit: 10 },
      ],
    });
    expect(ok.status).toBe(201);
    await asSuper('delete', `/financials/journal-entries/${ok.body.id}`);
  });

  it('T5(f): APC, class, number and useful life of FA-00001 cannot be changed (B6)', async () => {
    const apc = await api('put', `/financials/fixed-assets/${fa1}`, { acquisitionCost: 1 });
    expect(apc.status).toBe(400);
    const cls = await prisma.assetClass.findFirstOrThrow({ where: { companyId, code: 'IT36' } });
    expect((await api('put', `/financials/fixed-assets/${fa1}`, { assetClassId: cls.id })).status).toBe(409);
    expect((await api('put', `/financials/fixed-assets/${fa1}`, { code: 'FA-99999' })).status).toBe(409);
    const life = await api('put', `/financials/fixed-assets/${fa1}`, { areas: [{ areaId: mainAreaId, usefulLifeMonths: 48 }] });
    expect(life.status).toBe(409);
    expect(msg(life)).toMatch(/depreciation parameters in area MAIN are locked/);
    // Free text still saves.
    expect((await api('put', `/financials/fixed-assets/${fa1}`, { serialNumber: 'DL7440-001' })).status).toBe(200);
    expect(num(main(await asset(fa1)).acquisitionCost)).toBe(120000);
  });

  it('a deactivated asset leaves the document pickers and stays in Find (FA-D10)', async () => {
    expect((await api('put', `/financials/fixed-assets/${fa1}`, { isActive: false })).status).toBe(200);
    for (const kind of ['CAPITALIZATION', 'CREDIT_MEMO']) {
      const lk = (await api('get', `/financials/asset-capitalizations/lookups?kind=${kind}`)).body;
      expect(lk.assets.some((x: any) => x.id === fa1)).toBe(false);
    }
    expect((await api('get', '/financials/fixed-assets?search=FA-00001')).body).toHaveLength(1);
    expect((await api('put', `/financials/fixed-assets/${fa1}`, { isActive: true })).status).toBe(200);
  });

  it('retirement is refused rather than half-done (B10)', async () => {
    const r = await api('post', `/financials/fixed-assets/${fa1}/retire`, {});
    expect(r.status).toBe(409);
    expect(msg(r)).toMatch(/Retirement is not available yet/);
  });
});

// ─── More document rules ──────────────────────────────────────────────────────
describe('capitalization and credit memo rules', () => {
  it('a statistical area alone values the asset without a journal entry', async () => {
    const a = (await newAsset()).body;
    const before = await bal('1510');
    const res = await capitalize({ postingDate: '2026-10-06', depreciationAreaId: taxAreaId, lines: [{ assetId: a.id, amount: 400 }] });
    expect(res.status).toBe(201);
    expect(res.body.journalEntry).toBeNull();
    expect(await bal('1510')).toBe(before);
    const after = await asset(a.id);
    expect(after.areaValues.map((v: any) => [v.area.code, num(v.acquisitionCost)])).toEqual([
      ['MAIN', 0],
      ['TAX', 400],
    ]);
  });

  it('credit memo limits, and back to New when value and quantity reach zero (FA-D6, FA-D15)', async () => {
    const a = (await newAsset()).body;
    const first0 = await capitalize({ postingDate: '2026-10-06', lines: [{ assetId: a.id, amount: 500, quantity: 0 }] });
    expect(first0.status).toBe(400);
    expect(msg(first0)).toMatch(/first capitalization .* at least 1/);

    const cap = await capitalize({ postingDate: '2026-10-06', assetValueDate: '2026-10-01', lines: [{ assetId: a.id, amount: 500, quantity: 2 }] });
    expect(cap.status).toBe(201);
    const tooMuch = await capitalize({ kind: 'CREDIT_MEMO', postingDate: '2026-10-07', lines: [{ assetId: a.id, amount: 500.01 }] });
    expect(tooMuch.status).toBe(409);
    expect(msg(tooMuch)).toMatch(/exceeds the acquisition cost/);
    const tooMany = await capitalize({ kind: 'CREDIT_MEMO', postingDate: '2026-10-07', lines: [{ assetId: a.id, amount: 10, quantity: 3 }] });
    expect(tooMany.status).toBe(409);

    const based = await capitalize({
      kind: 'CREDIT_MEMO',
      baseCapitalizationId: cap.body.id,
      postingDate: '2026-10-07',
      lines: [{ assetId: a.id, amount: 500, quantity: 2 }],
    });
    expect(based.status).toBe(201);
    const back = await asset(a.id);
    expect([back.status, back.capitalizedAt, back.quantity, main(back).depreciationStartDate]).toEqual(['NEW', null, 0, null]);

    // The capitalization is refused while a credit memo is based on it…
    const blocked = await api('post', `/financials/asset-capitalizations/${cap.body.id}/cancel`, {});
    expect(blocked.status).toBe(409);
    expect(msg(blocked)).toMatch(/based on it/);
    // …and cancels once the memo is cancelled.
    expect((await api('post', `/financials/asset-capitalizations/${based.body.id}/cancel`, {})).status).toBe(201);
    // In service again from its original date, so depreciation has a start.
    const restored = await asset(a.id);
    expect([restored.status, restored.capitalizedAt.slice(0, 10), restored.quantity, main(restored).depreciationStartDate.slice(0, 10)]).toEqual([
      'CAPITALIZED',
      '2026-10-01',
      2,
      '2026-10-01',
    ]);
    expect((await api('post', `/financials/asset-capitalizations/${cap.body.id}/cancel`, {})).status).toBe(201);
    const undone = await asset(a.id);
    expect([undone.status, undone.quantity, num(main(undone).acquisitionCost)]).toEqual(['NEW', 0, 0]);
    expect((await api('post', `/financials/asset-capitalizations/${cap.body.id}/cancel`, {})).status).toBe(409);
  });

  it('refuses a repeated asset, an empty document and an inactive asset', async () => {
    const a = (await newAsset()).body;
    expect((await capitalize({ postingDate: '2026-10-06', lines: [{ assetId: a.id, amount: 1 }, { assetId: a.id, amount: 2 }] })).status).toBe(400);
    expect((await capitalize({ postingDate: '2026-10-06', lines: [] })).status).toBe(400);
    const off = (await newAsset({ isActive: false })).body;
    expect((await capitalize({ postingDate: '2026-10-06', lines: [{ assetId: off.id, amount: 1 }] })).status).toBe(409);
  });

  it('the Accounting tab’s journal remark becomes the JE description', async () => {
    const a = (await newAsset()).body;
    const res = await capitalize({
      postingDate: '2026-10-06',
      journalRemark: 'Laptops for finance — اکاؤنٹس',
      remarks: 'ریمارکس 🚀',
      lines: [{ assetId: a.id, amount: 10, remarks: 'سطر' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.remarks).toBe('ریمارکس 🚀');
    expect(res.body.lines[0].remarks).toBe('سطر');
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.body.journalEntry.id } });
    expect(je.description).toBe('Laptops for finance — اکاؤنٹس');
  });
});

// ─── T6: concurrency and idempotency ─────────────────────────────────────────
describe('T6 concurrency', () => {
  it('two parallel capitalizations of 100.00 give two documents with consecutive numbers and APC 200.00', async () => {
    const a = (await newAsset()).body;
    const [r1, r2] = await Promise.all([
      capitalize({ postingDate: '2026-10-08', lines: [{ assetId: a.id, amount: 100 }] }),
      capitalize({ postingDate: '2026-10-08', lines: [{ assetId: a.id, amount: 100 }] }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const nums = [r1.body.number, r2.body.number].map((n: string) => Number(n.replace('CAP-', ''))).sort((x, y) => x - y);
    expect(nums[1] - nums[0]).toBe(1);
    expect(r1.body.journalEntry.id).not.toBe(r2.body.journalEntry.id);
    const after = await asset(a.id);
    expect([num(main(after).acquisitionCost), after.quantity]).toEqual([200, 1]);
  });

  it('the same Idempotency-Key twice gives one document', async () => {
    const a = (await newAsset()).body;
    const body = { postingDate: '2026-10-08', lines: [{ assetId: a.id, amount: 300 }] };
    const key = { 'Idempotency-Key': `idem-${stamp}` };
    const first = await capitalize(body, key);
    const again = await capitalize(body, key);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.assetCapitalization.count({ where: { companyId, lines: { some: { assetId: a.id } } } })).toBe(1);
  });
});

// ─── T7: the database's own refusals ─────────────────────────────────────────
describe('T7 integrity at the database level', () => {
  it('refuses a zero or negative line amount', async () => {
    const line = await prisma.assetCapitalizationLine.findFirstOrThrow({ where: { capitalizationId: t1Id } });
    for (const amount of [0, -5]) {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO asset_capitalization_lines (id, "companyId", "capitalizationId", "assetId", amount, quantity, ordering)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 0, 9)`,
          companyId,
          t1Id,
          line.assetId,
          amount,
        ),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it('refuses a second journal entry for the same document', async () => {
    const t1 = await prisma.assetCapitalization.findUniqueOrThrow({ where: { id: t1Id } });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO journal_entries (id, "companyId", "periodId", number, date, "docDate", currency, source, "sourceId", status, "totalDebit", "totalCredit", "updatedAt")
         SELECT gen_random_uuid()::text, "companyId", "periodId", number || '-B', date, "docDate", currency, source, "sourceId", 'DRAFT', 0, 0, now()
         FROM journal_entries WHERE id = $1`,
        t1.journalEntryId,
      ),
    ).rejects.toThrow(/23505[\s\S]*fixed_asset_capitalization[\s\S]*already exists/);
  });

  it('refuses changing a posted line or document, and deleting asset history', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE asset_capitalization_lines SET amount = 1 WHERE "capitalizationId" = $1`, t1Id),
    ).rejects.toThrow(/ERP_RULE: The lines of a posted capitalization document cannot be changed/);
    await expect(prisma.$executeRawUnsafe(`UPDATE asset_capitalizations SET total = 1 WHERE id = $1`, t1Id)).rejects.toThrow(
      /ERP_RULE: Capitalization document CAP-00001 is posted and cannot be changed/,
    );
    await expect(prisma.$executeRawUnsafe(`DELETE FROM fixed_asset_transactions WHERE "assetId" = $1`, fa1)).rejects.toThrow(
      /ERP_RULE: Asset history cannot be changed or deleted/,
    );
    // B5: the history keeps the asset (RESTRICT, not CASCADE).
    await expect(prisma.fixedAsset.delete({ where: { id: fa1 } })).rejects.toThrow(/Foreign key constraint/);
  });
});

// ─── T8: input matrix ────────────────────────────────────────────────────────
describe('T8 input matrix', () => {
  let fresh = '';
  beforeAll(async () => {
    fresh = (await newAsset()).body.id;
  });
  const docCount = () => prisma.assetCapitalization.count({ where: { companyId } });

  it('amounts and quantities that are not whole, positive, 2-decimal numbers are refused, and nothing is written', async () => {
    const before = await docCount();
    for (const amount of ['abc', '1,2,3', -5, 0, 10.999, 1e16, null]) {
      const r = await capitalize({ postingDate: '2026-10-09', lines: [{ assetId: fresh, amount }] });
      expect([amount, r.status]).toEqual([amount, 400]);
    }
    for (const quantity of [1.5, -1, 'two']) {
      const r = await capitalize({ postingDate: '2026-10-09', lines: [{ assetId: fresh, amount: 10, quantity }] });
      expect([quantity, r.status]).toEqual([quantity, 400]);
    }
    expect((await capitalize({ lines: [{ assetId: fresh, amount: 10 }] })).status).toBe(400);
    expect((await capitalize({ postingDate: '2026-10-09', journalRemark: 'x'.repeat(101), lines: [{ assetId: fresh, amount: 10 }] })).status).toBe(400);
    expect(await docCount()).toBe(before);
  });

  it('a closed period refuses the post and consumes no number', async () => {
    const series = () =>
      prisma.numberingSeries.findFirstOrThrow({ where: { companyId, documentType: 'fixed_asset_capitalization', isDefault: true } });
    const next = (await series()).nextNumber;
    const covering = { companyId, startDate: { lte: new Date('2026-06-15') }, endDate: { gte: new Date('2026-06-15') } };
    await prisma.fiscalPeriod.updateMany({ where: covering, data: { generalStatus: 'LOCKED' } });
    try {
      const r = await capitalize({ postingDate: '2026-06-15', lines: [{ assetId: fresh, amount: 10 }] });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    } finally {
      await prisma.fiscalPeriod.updateMany({ where: covering, data: { generalStatus: 'OPEN' } });
    }
    expect((await series()).nextNumber).toBe(next);
    const ok = await capitalize({ postingDate: '2026-10-09', lines: [{ assetId: fresh, amount: 10 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.number).toBe(`CAP-${String(next).padStart(5, '0')}`);
  });

  it('an asset value date in another fiscal year is refused (FA-D7)', async () => {
    const a = (await newAsset()).body;
    const r = await capitalize({ postingDate: '2026-10-05', assetValueDate: '2025-12-31', lines: [{ assetId: a.id, amount: 10 }] });
    expect(r.status).toBe(400);
    expect(msg(r)).toBe('The asset value date 31.12.2025 must be in the same fiscal year as the posting date 05.10.2026.');
  });

  it('a class whose account can no longer post is named with its window (B2)', async () => {
    const cls = await api('post', '/financials/asset-classes', {
      code: 'IT3',
      name: 'Clearing goes inactive',
      assetAccountId: acct.apc,
      accumulatedDepreciationAccountId: acct.acc,
      depreciationExpenseAccountId: acct.exp,
      clearingAccountId: acct.clr3,
    });
    expect(cls.status).toBe(201);
    const a = (await newAsset({ assetClassId: cls.body.id })).body;
    await prisma.account.update({ where: { id: acct.clr3 }, data: { isActive: false } });
    try {
      const r = await capitalize({ postingDate: '2026-10-09', lines: [{ assetId: a.id, amount: 10 }] });
      expect(r.status).toBe(400);
      expect(msg(r)).toMatch(/Asset FA-\d+: Acquisition clearing account of asset class IT3 \(Administration → Setup → Financials → Fixed Assets → Asset Classes\): 2193 .* is inactive/);
    } finally {
      await prisma.account.update({ where: { id: acct.clr3 }, data: { isActive: true } });
    }
  });
});

// ─── T10: tenant and role ─────────────────────────────────────────────────────
describe('T10 tenant and role', () => {
  it('a super admin who chose the company sees only its assets', async () => {
    const r = await call(superToken, 'get', '/financials/fixed-assets', undefined, { 'x-company-id': companyId });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(new Set(r.body.map((a: any) => a.companyId))).toEqual(new Set([companyId]));
  });

  it('another company’s admin gets 404 for this company’s asset and document', async () => {
    expect((await call(otherAdminToken, 'get', `/financials/fixed-assets/${fa1}`)).status).toBe(404);
    expect((await call(otherAdminToken, 'get', `/financials/asset-capitalizations/${t1Id}`)).status).toBe(404);
    const post = await call(otherAdminToken, 'post', '/financials/asset-capitalizations', {
      postingDate: '2026-10-09',
      lines: [{ assetId: fa1, amount: 10 }],
    });
    expect(post.status).toBe(404);
  });

  it('a user without fixed_asset_document.create can look but not post (403)', async () => {
    const role = await prisma.role.create({ data: { companyId, name: `FA viewer ${stamp}` } });
    const perms = await prisma.permission.findMany({
      where: { key: { in: ['financials.fixed_asset.view', 'financials.fixed_asset_document.view'] } },
    });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const email = `fa.viewer.${stamp}@example.com`;
    const user = await prisma.user.create({
      data: { companyId, name: 'FA Viewer', email, passwordHash: await bcrypt.hash(PASSWORD, 10), passwordChangedAt: new Date() },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const financials = await prisma.systemModule.findFirstOrThrow({ where: { slug: 'financials' } });
    await prisma.userModule.create({ data: { userId: user.id, moduleId: financials.id } });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const token = await login(email, company.slug);
    expect((await call(token, 'get', `/financials/asset-capitalizations/${t1Id}`)).status).toBe(200);
    const post = await call(token, 'post', '/financials/asset-capitalizations', { postingDate: '2026-10-09', lines: [{ assetId: fa1, amount: 10 }] });
    expect(post.status).toBe(403);
    expect((await call(token, 'post', '/financials/fixed-assets/depreciation-run', { postingDate: '2026-10-31', dryRun: true })).status).toBe(403);
  });

  it('a company without the Financials module gets 403', async () => {
    const financials = await prisma.systemModule.findFirstOrThrow({ where: { slug: 'financials' } });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    await prisma.companyModule.updateMany({ where: { companyId, moduleId: financials.id }, data: { isEnabled: false } });
    try {
      const token = await login(`admin.${company.slug}@example.com`, company.slug);
      expect((await call(token, 'get', '/financials/fixed-assets')).status).toBe(403);
      expect((await call(token, 'get', '/financials/asset-capitalizations')).status).toBe(403);
    } finally {
      await prisma.companyModule.updateMany({ where: { companyId, moduleId: financials.id }, data: { isEnabled: true } });
    }
  });
});

// ─── Origin A/P invoice (kept: the owner's doc asks for it; see the report) ──
describe('capitalization from an A/P invoice', () => {
  let billId = '';
  let clearingLineId = '';
  let expenseLineId = '';

  beforeAll(async () => {
    const bill = await asSuper('post', '/financials/ap-bills', {
      bpId: vendorId,
      number: `FA-BILL-${stamp}`,
      issueDate: '2026-10-02',
      lines: [
        { description: 'Laser cutter', unitPrice: 5000, accountId: acct.clr },
        { description: 'Delivery', unitPrice: 100, accountId: acct.exp },
      ],
    });
    expect(bill.status).toBe(201);
    billId = bill.body.id;
    expect((await asSuper('post', `/financials/ap-bills/${billId}/post`)).status).toBeLessThan(300);
    const lines = await prisma.aPBillLine.findMany({ where: { billId } });
    clearingLineId = lines.find((l) => l.accountId === acct.clr)!.id;
    expenseLineId = lines.find((l) => l.accountId === acct.exp)!.id;
  });

  it('offers only the line booked to a clearing account and refuses another', async () => {
    const lk = (await api('get', '/financials/asset-capitalizations/lookups?kind=CAPITALIZATION')).body;
    expect(lk.apBills.find((b: any) => b.id === billId).lines.map((l: any) => l.id)).toEqual([clearingLineId]);
    const a = (await newAsset()).body;
    const r = await capitalize({ origin: 'AP_INVOICE', apBillId: billId, postingDate: '2026-10-03', lines: [{ assetId: a.id, amount: 100, apBillLineId: expenseLineId }] });
    expect(r.status).toBe(400);
  });

  it('moves the amount from clearing to APC, never more than the line, even concurrently', async () => {
    const a = (await newAsset()).body;
    const before = { apc: await bal('1510'), clr: await bal('2190') };
    const r = await capitalize({ origin: 'AP_INVOICE', apBillId: billId, postingDate: '2026-10-03', lines: [{ assetId: a.id, amount: 3000, apBillLineId: clearingLineId }] });
    expect(r.status).toBe(201);
    expect(await bal('1510')).toBe(before.apc + 3000);
    // A liability: the credit raises its natural balance.
    expect(await bal('2190')).toBe(before.clr + 3000);

    const [b, c] = await Promise.all([
      capitalize({ origin: 'AP_INVOICE', apBillId: billId, postingDate: '2026-10-04', lines: [{ assetId: (await newAsset()).body.id, amount: 1500, apBillLineId: clearingLineId }] }),
      capitalize({ origin: 'AP_INVOICE', apBillId: billId, postingDate: '2026-10-04', lines: [{ assetId: (await newAsset()).body.id, amount: 1500, apBillLineId: clearingLineId }] }),
    ]);
    expect([b.status, c.status].sort()).toEqual([201, 409]);
    const net = await prisma.assetCapitalizationLine.aggregate({
      where: { apBillLineId: clearingLineId, capitalization: { status: 'POSTED', kind: 'CAPITALIZATION' } },
      _sum: { amount: true },
    });
    expect(num(net._sum.amount)).toBe(4500);
  });

  it('keeps the invoice from being voided while part of it sits in an asset', async () => {
    const r = await asSuper('post', `/financials/ap-bills/${billId}/void`, {});
    expect(r.status).toBe(409);
    expect(msg(r)).toMatch(/capitalized into fixed assets/);
  });

  it('an A/P invoice line straight to the APC account is refused (FA-D9)', async () => {
    const bill = await asSuper('post', '/financials/ap-bills', {
      bpId: vendorId,
      number: `FA-BILL-APC-${stamp}`,
      issueDate: '2026-10-02',
      lines: [{ description: 'Printer', unitPrice: 900, accountId: acct.apc }],
    });
    expect(bill.status).toBe(201);
    const posted = await asSuper('post', `/financials/ap-bills/${bill.body.id}/post`);
    expect(posted.status).toBe(400);
    expect(msg(posted)).toMatch(/Account 1510 is maintained by Fixed Assets/);
  });
});

// ─── Setup rules once values exist ───────────────────────────────────────────
describe('setup rules once values exist', () => {
  it('the APC and accumulated accounts of a class in use are locked; its expense account is not (FA-D4)', async () => {
    const apc = await api('put', `/financials/asset-classes/${classId}`, { accumulatedDepreciationAccountId: acct.clr3 });
    expect(apc.status).toBe(409);
    expect(msg(apc)).toMatch(/would strand the existing balance\. Use Transfer \(FA-2\)/);
    const expense = await api('put', `/financials/asset-classes/${classId}`, { depreciationExpenseAccountId: acct.exp2 });
    expect(expense.status).toBe(200);
    expect(expense.body.depreciationExpenseAccount.code).toBe('6111');
    expect((await api('put', `/financials/asset-classes/${classId}`, { depreciationExpenseAccountId: acct.exp })).status).toBe(200);
    expect((await api('delete', `/financials/asset-classes/${classId}`)).status).toBe(409);
  });

  it('MAIN cannot stop posting once it holds values; a new area reaches New assets only', async () => {
    expect((await api('put', `/financials/depreciation-areas/${mainAreaId}`, { postsToGl: false })).status).toBe(409);
    const extra = await api('post', '/financials/depreciation-areas', { code: 'STAT', name: 'Statistical', postsToGl: false });
    expect(extra.status).toBe(201);
    const fresh = await prisma.fixedAsset.findFirstOrThrow({ where: { companyId, status: 'NEW' }, include: { areaValues: true } });
    expect(fresh.areaValues.some((v) => v.areaId === extra.body.id)).toBe(true);
    const capitalized = await prisma.fixedAssetAreaValue.count({ where: { assetId: fa1, areaId: extra.body.id } });
    expect(capitalized).toBe(0);
    expect((await api('delete', `/financials/depreciation-areas/${extra.body.id}`)).status).toBe(200);
  });
});
