import { JournalEntryStatus, Prisma } from '@prisma/client';

/**
 * Statuses whose journal lines count as real ledger movement.
 *
 * A reversed entry is NOT removed from the ledger. Reversing posts a mirror
 * entry that neutralizes the original; both rows stay, and their effects cancel.
 * Filtering on `status: 'POSTED'` alone drops the original while keeping its
 * reversal, so every balance shifts by the reversal amount in the wrong
 * direction — the pair stops netting to zero and reports still claim to
 * balance, because both sides are wrong by the same amount.
 *
 * Only DRAFT is excluded: a draft has not been posted and must not affect
 * anything.
 */
export const LEDGER_STATUSES: JournalEntryStatus[] = [
  JournalEntryStatus.POSTED,
  JournalEntryStatus.REVERSED,
];

/**
 * Status clause for any query that aggregates journal lines.
 *
 * @param includeUnposted include DRAFT entries too (preview / what-if reads)
 */
export function ledgerStatusWhere(
  includeUnposted?: boolean,
): Pick<Prisma.JournalEntryWhereInput, 'status'> {
  return includeUnposted ? {} : { status: { in: LEDGER_STATUSES } };
}
