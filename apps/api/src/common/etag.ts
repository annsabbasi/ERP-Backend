import { ProblemException } from './problem';

// Optimistic concurrency (Part 10 §10.4 rule 7, Part 11 §11.9): reads send an ETag built
// from the row's version; updates send it back in If-Match, and a mismatch answers 412.

export function etagFor(version: number): string {
  return `W/"${version}"`;
}

/** The version an If-Match header names, or undefined when it is missing or malformed. */
export function versionFromIfMatch(header: string | undefined): number | undefined {
  const match = header?.trim().match(/^(?:W\/)?"(\d+)"$/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Throws 412 precondition_failed when If-Match does not name the current version, so a client
 * never overwrites a change it has not seen, and 428 precondition_required without it. `*`
 * matches any version.
 */
export function assertIfMatch(header: string | undefined, currentVersion: number): void {
  if (header?.trim() === '*') return;
  const given = versionFromIfMatch(header);
  if (given === undefined) {
    throw new ProblemException(
      'precondition_required',
      'Send the ETag of the record you read in If-Match',
    );
  }
  if (given !== currentVersion) {
    throw new ProblemException(
      'precondition_failed',
      'The record was changed by someone else; reload it',
    );
  }
}
