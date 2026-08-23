import { SetMetadata } from '@nestjs/common';

export const KEY_BOUND_WRITE = 'idempotency:key-bound-write';

/**
 * Declares that this route's write is bound to the idempotency key **in the
 * database** — the row it creates stores the key under a unique index, so a
 * duplicate is refused inside the same transaction as the write.
 *
 * This is what makes a stale claim safe to reclaim. When a request dies after
 * committing but before recording its response, the replay record is lost and
 * the retry has no way to know the write happened. Re-running is only
 * acceptable where the database will refuse the second attempt on its own.
 *
 * Without this marker a route is never reclaimed: a stale claim is answered
 * with a 409 telling the caller to use a new key. That is a worse experience
 * and a much better outcome than posting a second invoice, allocating a second
 * document number and writing a second journal entry with nothing to stop any
 * of it.
 *
 * The rule, stated once so it is not re-derived from whichever endpoint is
 * being looked at: **an endpoint may only be reclaimed if its write is bound to
 * the key in the database.** Adding this decorator to a route without also
 * adding that unique index re-opens exactly the hole it exists to close.
 */
export const KeyBoundWrite = () => SetMetadata(KEY_BOUND_WRITE, true);
