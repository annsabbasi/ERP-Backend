import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AccountSubtype,
  AccountType,
  FixedAssetStatus,
  Prisma,
} from '@prisma/client';

export const D = (v: unknown) =>
  new Prisma.Decimal((v as number | string | Prisma.Decimal) ?? 0);
export const ZERO = new Prisma.Decimal(0);
export const money = (d: Prisma.Decimal) => Number(d.toFixed(2));

type Db = Prisma.TransactionClient;

/**
 * The company's base currency, which must exist in its own currency master:
 * journal_entries.currency is a foreign key onto currencies(companyId, code).
 * Refusing here is better than falling back to USD, which would book a PKR
 * company's assets as dollars.
 */
export async function companyCurrency(
  db: Db,
  companyId: string,
): Promise<string> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { currency: true },
  });
  const code = company?.currency?.trim();
  if (!code) {
    throw new BadRequestException(
      'This company has no base currency. Set it under Administration → System Initialization → Company Details.',
    );
  }
  const master = await db.currency.findFirst({
    where: { companyId, code },
    select: { id: true },
  });
  if (!master) {
    throw new BadRequestException(
      `The company currency ${code} is not in this company's currency master. ` +
        'Add it under Administration → Setup → Financials → Currencies.',
    );
  }
  return code;
}

/**
 * A postable account of this company that an asset class may point at:
 * active, not a Title account (the ledger refuses those), not a control
 * account (those need a business partner on every line), of one of the
 * expected types.
 */
export async function requireClassAccount(
  db: Db,
  companyId: string,
  accountId: string,
  label: string,
  types: AccountType[],
  subtype?: AccountSubtype,
) {
  const account = await db.account.findFirst({
    where: { id: accountId, companyId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isTitle: true,
      isActive: true,
      isControl: true,
      subtype: true,
    },
  });
  if (!account)
    throw new BadRequestException(
      `${label}: the account does not exist in this company.`,
    );
  if (account.isTitle) {
    throw new BadRequestException(
      `${label}: ${account.code} ${account.name} is a Title account and cannot be posted to.`,
    );
  }
  if (!account.isActive)
    throw new BadRequestException(
      `${label}: ${account.code} ${account.name} is inactive.`,
    );
  if (account.isControl) {
    throw new BadRequestException(
      `${label}: ${account.code} ${account.name} is a control account (it needs a business partner on every line).`,
    );
  }
  if (!types.includes(account.type)) {
    throw new BadRequestException(
      `${label}: ${account.code} ${account.name} is a ${account.type.toLowerCase()} account; ` +
        `expected ${types.map((t) => t.toLowerCase()).join(' or ')}.`,
    );
  }
  if (subtype && account.subtype !== subtype) {
    throw new BadRequestException(
      `${label}: ${account.code} ${account.name} must be an account of subtype ${subtype} ` +
        `(it is ${account.subtype ?? 'unclassified'}). Set the subtype under Edit Chart of Accounts.`,
    );
  }
  return account;
}

/**
 * The fiscal year a date falls in, given the company's first fiscal month
 * (1-12): the calendar year in which that fiscal year starts.
 */
export function fiscalYearOf(
  date: Date,
  fiscalYearStart: number | null | undefined,
): number {
  const start = Math.min(Math.max(fiscalYearStart ?? 1, 1), 12);
  return date.getUTCMonth() + 1 >= start
    ? date.getUTCFullYear()
    : date.getUTCFullYear() - 1;
}

/** The last day of a depreciation life that starts on `start`. */
export function lifeEndDate(start: Date, lifeMonths: number): Date {
  const end = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + lifeMonths,
      start.getUTCDate(),
    ),
  );
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

/** Status follows the values: an asset with cost in any area is capitalized. */
export function statusFromValues(
  values: { acquisitionCost: Prisma.Decimal }[],
): FixedAssetStatus {
  return values.some((v) => v.acquisitionCost.gt(ZERO))
    ? FixedAssetStatus.CAPITALIZED
    : FixedAssetStatus.NEW;
}

/**
 * Row locks on the given fixed assets, in id order so two transactions that
 * touch overlapping assets always lock them in the same order (no deadlock).
 * Every write to an asset's values goes through here first, so two documents
 * posting against one asset at once are serialised, not interleaved.
 */
export async function lockAssets(
  tx: Db,
  companyId: string,
  assetIds: string[],
) {
  const ids = [...new Set(assetIds)].sort();
  if (!ids.length) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "fixed_assets"
    WHERE "companyId" = ${companyId} AND "id" = ANY(${ids}::text[])
    ORDER BY "id" FOR UPDATE`;
  if (rows.length !== ids.length) {
    throw new NotFoundException(
      'One or more fixed assets on this document do not exist in this company.',
    );
  }
}

/**
 * Whole months from `from` to `to`, counting a month once its day-of-month has
 * been reached (from the 15th, the first month completes on the 15th).
 */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() >= from.getUTCDate() ? months : months - 1;
}
