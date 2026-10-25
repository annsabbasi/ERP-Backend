import type { Page } from '@erp/contracts';
import { ProblemException } from './problem';

// Cursor pagination (Part 11 §11.9): ?limit=50&cursor=… returns { data, next_cursor }.
// The cursor is opaque to clients: base64url of the sort key of the last row returned.

export type CursorKey = Record<string, string | number>;

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorKey {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('not an object');
    for (const v of Object.values(value)) {
      if (typeof v !== 'string' && typeof v !== 'number') throw new Error('not a key');
    }
    return value as CursorKey;
  } catch {
    throw new ProblemException('validation_failed', 'The cursor is not valid', {
      errors: [{ field: 'cursor', message: 'Use the next_cursor value of the previous page' }],
    });
  }
}

/**
 * Turns `limit + 1` rows read from the database into a page: the extra row only tells
 * whether another page exists.
 */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => CursorKey): Page<T> {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return {
    data,
    next_cursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}
