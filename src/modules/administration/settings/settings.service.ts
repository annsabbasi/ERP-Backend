import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    const entries = Object.entries(dto.values ?? {});
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.companySetting.upsert({
          where: { companyId_group_key: { companyId, group: dto.group, key } },
          create: {
            companyId,
            group: dto.group,
            key,
            value: value as Prisma.InputJsonValue,
            updatedById: userId,
          },
          update: { value: value as Prisma.InputJsonValue, updatedById: userId },
        }),
      ),
    );
    return this.getGroup(companyId, dto.group);
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
