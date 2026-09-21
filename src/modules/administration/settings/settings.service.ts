import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCompanyDetailsDto, UpsertSettingsDto } from '../administration.dto';

/**
 * Defaults for the General Settings window.
 *
 * The window has a few hundred controls; storing a column per control would be
 * unmaintainable, so settings live as (group, key) → JSON rows and are merged
 * over these defaults on read. That means a brand-new company answers every
 * settings read correctly without a seeding step, and adding a control later
 * needs no migration.
 */
export const SETTINGS_DEFAULTS: Record<string, Record<string, unknown>> = {
  general: {
    companyName: '',
    defaultCurrency: 'USD',
    systemCurrency: 'USD',
    localCurrency: 'USD',
    useSegmentationAccounts: false,
    useNegativeAmountsInJournals: false,
    multiLanguageSupport: false,
    defaultLanguage: 'en',
    dateFormat: 'dd.MM.yy',
    timeFormat: '24H',
    decimalSeparator: '.',
    thousandsSeparator: ',',
    displayCurrencySymbol: true,
  },
  display: {
    decimalsAmounts: 2,
    decimalsPrices: 2,
    decimalsRates: 6,
    decimalsQuantities: 3,
    decimalsPercent: 2,
    decimalsUnits: 3,
    showDiscountColumn: true,
    hidePriceZero: false,
  },
  bp: {
    defaultCustomerGroup: null,
    defaultVendorGroup: null,
    defaultPaymentTermsId: null,
    creditLimitCheck: true,
    blockOnCreditLimit: false,
    commitmentLimitCheck: false,
    defaultCustomerPriceList: null,
  },
  budget: {
    budgetInitialization: false,
    blockDeviationFromBudget: 'warning', // 'off' | 'warning' | 'block'
    calculateBudgetOn: 'annual',
    budgetPercentageDeviation: 0,
  },
  services: {
    defaultQueue: null,
    defaultResponseTimeHours: 24,
    defaultResolutionTimeHours: 72,
  },
  inventory: {
    defaultWarehouse: null,
    manageItemsBy: 'warehouse',
    setGlAccountsBy: 'warehouse',
    allowNegativeStock: false,
    autoAddAllWarehouses: true,
  },
  purchasing: {
    defaultPurchasingWarehouse: null,
    calculateTaxOnFreight: false,
    allowPartialDelivery: true,
  },
  pricing: {
    baseCurrencyForPriceLists: 'USD',
    updatePricesGlobally: false,
  },
  path: {
    attachmentsFolder: '',
    picturesFolder: '',
    excelDocsFolder: '',
    wordDocsFolder: '',
  },
  cash_flow: {
    enableCashFlow: false,
    defaultCashFlowRelevantAccount: null,
  },
  font_background: {
    fontName: 'Segoe UI',
    fontSize: 11,
    backgroundColor: '#ececec',
  },
  // The remaining General Settings tabs. Their full control list lives in the
  // client's field schema; the keys other server code reads are declared here so
  // a server-side `get()` has a sane fallback instead of undefined.
  resources: {
    defaultResourceWarehouse: '',
    autoAddWarehousesToResources: true,
  },
  cockpit: {
    cockpitStyle: 'fiori',
    kpiRefreshSeconds: 300,
  },
  cost_accounting: {
    useMultidimensions: false,
    displayDistributionRules: 'unified',
    // 'block' would stop a posting that is otherwise valid, so the shipped
    // default warns instead; a company that wants the harder rule opts in.
    missingRuleBehaviour: 'warning',
  },
  hide_functions: {},
  qr_codes: {
    enableQrCodes: false,
    qrCodeContent: 'documentNumber',
    qrCodeSizePx: 120,
  },
  security: {
    passwordMinLength: 8,
    passwordRequireUppercase: true,
    passwordRequireNumber: true,
    passwordRequireSymbol: false,
    passwordExpiryDays: 0,
    passwordHistoryCount: 3,
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
    sessionIdleMinutes: 0,
    requireMfaForAdmins: false,
    auditSensitiveReads: false,
  },
  // Print Preferences — the General tab plus the per-document overrides the
  // Print Preferences window writes.
  print_preferences: {
    maxRowsPerPage: 99,
    printWithVerticalCompression: 100,
    topMarginCm: 0,
    bottomMarginCm: 0,
    maxRowsPerPageInExport: 10,
    printingLayoutSerialNo: 'serial_no',
    printTextAsPicture: false,
    printOnLetterPaper: false,
    printGenerationMessagePld: true,
    printGenerationMessageCrystal: true,
    printDraftWatermark: true,
    generatePdfWhenPrinting: false,
    printCancelledWatermark: true,
    useSystemPrintPreference: false,
    useAttachmentsFolderForExport: false,
    attachExportedPdfsToDocuments: false,
  },
};

/**
 * Settings group holding the Company Details window's SAP-shaped fields.
 *
 * Named here rather than in the client so the server and the window cannot
 * disagree about where those values live.
 */
export const COMPANY_DETAILS_GROUP = 'company_details';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** All groups, defaults merged with whatever the company has overridden. */
  async getAll(companyId: string) {
    const rows = await this.prisma.companySetting.findMany({ where: { companyId } });

    const merged: Record<string, Record<string, unknown>> = {};
    for (const [group, defaults] of Object.entries(SETTINGS_DEFAULTS)) {
      merged[group] = { ...defaults };
    }
    for (const r of rows) {
      // A group the defaults do not know about is still returned — modules can
      // store their own settings without registering a default block first.
      merged[r.group] ??= {};
      merged[r.group][r.key] = r.value;
    }
    return merged;
  }

  async getGroup(companyId: string, group: string) {
    const rows = await this.prisma.companySetting.findMany({ where: { companyId, group } });
    const out: Record<string, unknown> = { ...(SETTINGS_DEFAULTS[group] ?? {}) };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /**
   * Merges the supplied keys into a group. Keys not present are left alone, so
   * a tab can save itself without clobbering settings owned by another tab.
   */
  async upsertGroup(companyId: string, userId: string, dto: UpsertSettingsDto) {
    await this.bulkUpsertSettings(companyId, dto.group, Object.entries(dto.values ?? {}), userId);
    return this.getGroup(companyId, dto.group);
  }

  /**
   * Upserts every (group, key) → value pair in one statement, inside the
   * caller's transaction if one is given.
   *
   * A settings tab can carry anywhere from a handful to (Company Details)
   * several dozen keys. Upserting them with one `tx.companySetting.upsert()`
   * call per key — the previous approach — is a sequential round trip per
   * key inside a single interactive transaction; against a cross-region
   * pooled connection that alone blew through Prisma's 5s transaction budget
   * for Company Details' ~58 keys (P2028). A single parameterized bulk
   * `INSERT … ON CONFLICT DO UPDATE` does the same write in one round trip
   * regardless of how many keys are being saved.
   */
  private async bulkUpsertSettings(
    companyId: string,
    group: string,
    entries: [string, unknown][],
    userId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const defined = entries.filter(([, value]) => value !== undefined);
    if (!defined.length) return;
    const now = new Date();
    const rows = defined.map(
      ([key, value]) =>
        Prisma.sql`(${randomUUID()}, ${companyId}, ${group}, ${key}, ${JSON.stringify(value)}::jsonb, ${userId}, ${now})`,
    );
    await tx.$executeRaw`
      INSERT INTO company_settings (id, "companyId", "group", "key", "value", "updatedById", "updatedAt")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("companyId", "group", "key")
      DO UPDATE SET "value" = EXCLUDED."value", "updatedById" = EXCLUDED."updatedById", "updatedAt" = EXCLUDED."updatedAt"
    `;
  }

  /** Restores a group (or one key) to its shipped default by deleting overrides. */
  async reset(companyId: string, group: string, key?: string) {
    await this.prisma.companySetting.deleteMany({
      where: { companyId, group, ...(key ? { key } : {}) },
    });
    return this.getGroup(companyId, group);
  }

  /** Single value with a fallback, for code that needs one setting. */
  async get<T>(companyId: string, group: string, key: string, fallback: T): Promise<T> {
    const row = await this.prisma.companySetting.findUnique({
      where: { companyId_group_key: { companyId, group, key } },
    });
    if (row) return row.value as T;
    const shipped = SETTINGS_DEFAULTS[group]?.[key];
    return (shipped as T) ?? fallback;
  }

  // ── Company details ────────────────────────────────────────────────────────
  async getCompanyDetails(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        _count: { select: { users: true, employees: true, branches: true } },
        companyModules: { include: { module: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async updateCompanyDetails(companyId: string, dto: UpdateCompanyDetailsDto) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...dto,
        branding: dto.branding as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Saves the Company Details window as one unit.
   *
   * The window's data lives in two places: the `companies` row for the values
   * posting routines read, and the `company_details` settings group for the
   * address, tax registration and initialization fields. Written as two
   * requests, the first could commit and the second fail — leaving the window
   * showing an error over a save that had half happened, with no way for the
   * user to tell which half.
   *
   * One transaction, so the window's report and the database agree.
   */
  async saveCompanyDetails(
    companyId: string,
    userId: string,
    dto: { company?: UpdateCompanyDetailsDto; details?: Record<string, unknown> },
  ) {
    const detailEntries = Object.entries(dto.details ?? {});

    await this.prisma.$transaction(
      async (tx) => {
        if (dto.company && Object.keys(dto.company).length) {
          await tx.company.update({
            where: { id: companyId },
            data: {
              ...dto.company,
              branding: dto.company.branding as Prisma.InputJsonValue | undefined,
            },
          });
        }

        await this.bulkUpsertSettings(companyId, COMPANY_DETAILS_GROUP, detailEntries, userId, tx);
      },
      { timeout: 15_000, maxWait: 10_000 },
    );

    return {
      company: await this.getCompanyDetails(companyId),
      details: await this.getGroup(companyId, COMPANY_DETAILS_GROUP),
    };
  }

  // ── Document settings ──────────────────────────────────────────────────────
  async getDocumentSettings(companyId: string, documentType?: string) {
    const row = await this.prisma.documentSetting.findFirst({
      where: { companyId, documentType: documentType ?? null },
    });
    return row?.settings ?? {};
  }

  async listDocumentSettings(companyId: string) {
    return this.prisma.documentSetting.findMany({
      where: { companyId },
      orderBy: { documentType: 'asc' },
    });
  }

  async upsertDocumentSettings(
    companyId: string,
    dto: { documentType?: string; settings: Record<string, unknown> },
  ) {
    const documentType = dto.documentType ?? null;
    const existing = await this.prisma.documentSetting.findFirst({
      where: { companyId, documentType },
    });

    // Merge rather than replace, matching how the settings groups behave.
    const merged = { ...((existing?.settings as object) ?? {}), ...dto.settings };

    if (existing) {
      return this.prisma.documentSetting.update({
        where: { id: existing.id },
        data: { settings: merged as Prisma.InputJsonValue },
      });
    }
    return this.prisma.documentSetting.create({
      data: { companyId, documentType, settings: merged as Prisma.InputJsonValue },
    });
  }
}
