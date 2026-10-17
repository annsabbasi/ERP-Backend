import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** The five canonical AccountType values — order is the default display order. */
export const ALL_ACCOUNT_TYPES: AccountType[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
];

/** Default labels used when a company has not yet customised the drawers. */
const DEFAULT_LABELS: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Turnover',
  EXPENSE: 'Cost of Sales',
};

/** Default 2-digit codes assigned to canonical drawers upon company initialization. */
export const DEFAULT_DRAWER_CODES: Record<AccountType, string> = {
  ASSET: '10',
  LIABILITY: '20',
  EQUITY: '30',
  INCOME: '40',
  EXPENSE: '50',
};

export interface CoaDrawerConfig {
  type: AccountType;
  /** 2-digit top-level code (e.g. 10, 20, 30). Once set, it is locked and immutable. */
  code: string;
  label: string;
  visible: boolean;
  /** 0-based display order — lower = further left. */
  order: number;
}

const SETTING_GROUP = 'financials';
const SETTING_KEY = 'coa_drawers';

@Injectable()
export class CoaDrawersService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Read ────────────────────────────────────────────────────────────────────

  /**
   * Returns the drawer configuration for the company.
   * Missing / partial config falls back to the built-in defaults so the
   * Chart of Accounts window is never blank on first use.
   */
  async get(companyId: string): Promise<CoaDrawerConfig[]> {
    const row = await this.prisma.companySetting.findUnique({
      where: { companyId_group_key: { companyId, group: SETTING_GROUP, key: SETTING_KEY } },
    });

    const saved = (row?.value ?? []) as Partial<CoaDrawerConfig>[];
    return this.mergeWithDefaults(saved);
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  /**
   * Persists the drawer configuration for the company.
   *
   * Rules enforced here:
   *   - Only the five canonical AccountType values are accepted.
   *   - Codes must be exactly 2 numeric digits (01-99).
   *   - Each drawer code must be unique within the company.
   *   - IMMUTABILITY: Once a code has been saved for a drawer type, it can NEVER be changed.
   *   - Labels must be non-empty strings of at most 40 characters.
   *   - Each type may appear at most once.
   *   - At least one drawer must remain visible.
   */
  async set(
    companyId: string,
    drawers: { type: AccountType; code: string; label: string; visible: boolean; order: number }[],
    updatedById?: string,
  ): Promise<CoaDrawerConfig[]> {
    // Fetch currently saved config to enforce code immutability
    const existingRow = await this.prisma.companySetting.findUnique({
      where: { companyId_group_key: { companyId, group: SETTING_GROUP, key: SETTING_KEY } },
    });
    const existingList = (existingRow?.value ?? []) as Partial<CoaDrawerConfig>[];
    const existingCodeByType = new Map<AccountType, string>();
    for (const item of existingList) {
      if (item.type && item.code) {
        existingCodeByType.set(item.type, item.code.trim());
      }
    }

    // --- validation ---
    const seenTypes = new Set<AccountType>();
    const seenCodes = new Set<string>();

    for (const d of drawers) {
      if (!ALL_ACCOUNT_TYPES.includes(d.type)) {
        throw new BadRequestException(`Unknown account type "${d.type}".`);
      }
      if (seenTypes.has(d.type)) {
        throw new BadRequestException(`Duplicate drawer entry for type "${d.type}".`);
      }
      seenTypes.add(d.type);

      const code = (d.code ?? '').trim();
      if (!/^\d{2}$/.test(code)) {
        throw new BadRequestException(
          `Drawer code for type "${d.type}" must be exactly two numeric digits (e.g. 10, 20, 30), got "${code}".`,
        );
      }
      if (seenCodes.has(code)) {
        throw new BadRequestException(
          `Duplicate drawer code "${code}". Every drawer must have a unique 2-digit code.`,
        );
      }
      seenCodes.add(code);

      // IMMUTABILITY: Once a code is saved for this drawer type, it is locked forever
      const existingCode = existingCodeByType.get(d.type);
      if (existingCode && existingCode !== code) {
        throw new BadRequestException(
          `Drawer code for "${d.type}" is permanently locked and cannot be changed from "${existingCode}" to "${code}".`,
        );
      }

      const label = (d.label ?? '').trim();
      if (!label) {
        throw new BadRequestException(`Drawer label for type "${d.type}" must not be empty.`);
      }
      if (label.length > 40) {
        throw new BadRequestException(
          `Drawer label for type "${d.type}" exceeds 40 characters.`,
        );
      }
    }

    // Must keep at least one visible drawer so the CoA window is not empty.
    const visibleCount = drawers.filter((d) => d.visible).length;
    if (visibleCount === 0) {
      throw new BadRequestException('At least one account type drawer must remain visible.');
    }

    // Ensure all five types are present — add missing ones as invisible with defaults.
    const merged = this.mergeWithDefaults(drawers);

    await this.prisma.companySetting.upsert({
      where: { companyId_group_key: { companyId, group: SETTING_GROUP, key: SETTING_KEY } },
      create: {
        companyId,
        group: SETTING_GROUP,
        key: SETTING_KEY,
        value: merged as unknown as object[],
        ...(updatedById ? { updatedById } : {}),
      },
      update: {
        value: merged as unknown as object[],
        ...(updatedById ? { updatedById } : {}),
      },
    });

    return merged;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  /**
   * Merges saved (possibly incomplete) drawer config with the built-in defaults.
   * Types missing from saved config are appended as visible with the default label and code.
   * Final result is sorted by `order`, then by the canonical type position.
   */
  private mergeWithDefaults(saved: Partial<CoaDrawerConfig>[]): CoaDrawerConfig[] {
    const byType = new Map<AccountType, Partial<CoaDrawerConfig>>();
    for (const d of saved) {
      if (d.type && ALL_ACCOUNT_TYPES.includes(d.type)) {
        byType.set(d.type, d);
      }
    }

    const result: CoaDrawerConfig[] = ALL_ACCOUNT_TYPES.map((type, idx) => {
      const s = byType.get(type);
      return {
        type,
        code: (s?.code ?? DEFAULT_DRAWER_CODES[type]).trim() || DEFAULT_DRAWER_CODES[type],
        label: (s?.label ?? DEFAULT_LABELS[type]).trim() || DEFAULT_LABELS[type],
        visible: s?.visible ?? true,
        order: s?.order ?? idx,
      };
    });

    result.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return ALL_ACCOUNT_TYPES.indexOf(a.type) - ALL_ACCOUNT_TYPES.indexOf(b.type);
    });

    return result;
  }
}
