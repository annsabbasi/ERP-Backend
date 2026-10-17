import { BadRequestException } from '@nestjs/common';

export const COA_CODE_MAX_LEVEL = 7;
export const COA_CODE_SEGMENT_REGEX = /^\d{2}$/;
/** Pure numeric code: 2 to 14 digits, exactly 2 digits per level (e.g. 10, 1010, 101001) */
export const COA_CODE_FULL_REGEX = /^(\d{2}){1,7}$/;

/**
 * Validates whether a hierarchical code conforms to the 2-digit per level pure numeric standard
 * and does not exceed maximum level depth of 7 (14 digits max).
 */
export function validateHierarchicalCode(code: string, expectedLevel?: number): void {
  if (!code || typeof code !== 'string') {
    throw new BadRequestException('Account code must be a non-empty string');
  }

  const trimmed = code.trim();
  if (!COA_CODE_FULL_REGEX.test(trimmed)) {
    throw new BadRequestException(
      `Invalid account code "${code}". Every level must add exactly 2 digits (e.g. 30 for Level 1, 3010 for Level 2, 301001 for Level 3), up to maximum 7 levels (14 digits).`,
    );
  }

  const depth = trimmed.length / 2;

  if (depth > COA_CODE_MAX_LEVEL) {
    throw new BadRequestException(
      `Account code "${code}" has ${depth} levels. The maximum allowed hierarchy depth is ${COA_CODE_MAX_LEVEL} levels (14 digits).`,
    );
  }

  if (expectedLevel !== undefined && depth !== expectedLevel) {
    throw new BadRequestException(
      `Account code "${code}" has ${depth} level(s), but expected level is ${expectedLevel}.`,
    );
  }
}

/**
 * Validates that a child code strictly extends the parent code prefix with exactly 2 digits.
 * E.g., parent "3010" -> child "301001" or "301002".
 */
export function validateChildCodePrefix(childCode: string, parentCode: string): void {
  if (!childCode.startsWith(parentCode)) {
    throw new BadRequestException(
      `Child account code "${childCode}" must strictly begin with parent code prefix "${parentCode}".`,
    );
  }

  const remaining = childCode.slice(parentCode.length);
  if (!COA_CODE_SEGMENT_REGEX.test(remaining)) {
    throw new BadRequestException(
      `Direct child of "${parentCode}" must add exactly two numeric digits (01-99), got "${remaining}".`,
    );
  }
}

/**
 * Computes the next available 2-digit child code under a parent or at top level for a company.
 * @param parentCode The parent's full code (e.g. "30" or "3010"), or null if top level.
 * @param existingCodes All existing codes under this parent or at top level in this company.
 */
export function computeNextChildCode(
  parentCode: string | null,
  existingCodes: string[],
): string {
  if (parentCode) {
    const currentDepth = parentCode.length / 2;
    if (currentDepth >= COA_CODE_MAX_LEVEL) {
      throw new BadRequestException(
        `Cannot generate child code: parent "${parentCode}" is already at maximum level ${COA_CODE_MAX_LEVEL}.`,
      );
    }

    const prefix = parentCode;
    const expectedChildLen = parentCode.length + 2;
    const usedNumbers = new Set<number>();

    for (const code of existingCodes) {
      if (code.startsWith(prefix) && code.length === expectedChildLen) {
        const directChildSeg = code.slice(prefix.length);
        if (COA_CODE_SEGMENT_REGEX.test(directChildSeg)) {
          usedNumbers.add(parseInt(directChildSeg, 10));
        }
      }
    }

    let next = 1;
    while (usedNumbers.has(next) && next <= 99) {
      next++;
    }

    if (next > 99) {
      throw new BadRequestException(
        `Maximum siblings (99) reached under parent account "${parentCode}".`,
      );
    }

    const segStr = next.toString().padStart(2, '0');
    return `${parentCode}${segStr}`;
  } else {
    // Root / Level 1 account: find next available 2-digit number in this company
    const usedNumbers = new Set<number>();
    for (const code of existingCodes) {
      if (code.length === 2 && COA_CODE_SEGMENT_REGEX.test(code)) {
        usedNumbers.add(parseInt(code, 10));
      }
    }

    let next = 1;
    while (usedNumbers.has(next) && next <= 99) {
      next++;
    }

    if (next > 99) {
      throw new BadRequestException('Maximum root-level accounts (99) reached for this company.');
    }

    return next.toString().padStart(2, '0');
  }
}
