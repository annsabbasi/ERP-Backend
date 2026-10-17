import {
  COA_CODE_MAX_LEVEL,
  computeNextChildCode,
  validateChildCodePrefix,
  validateHierarchicalCode,
} from './coa-code.util';
import { BadRequestException } from '@nestjs/common';

describe('coa-code.util — Pure Numeric 2-Digit Hierarchy', () => {
  describe('validateHierarchicalCode', () => {
    it('accepts valid 2-digit pure numeric codes from 1 to 7 levels (2 to 14 digits)', () => {
      expect(() => validateHierarchicalCode('10')).not.toThrow();
      expect(() => validateHierarchicalCode('1001')).not.toThrow();
      expect(() => validateHierarchicalCode('100102')).not.toThrow();
      expect(() => validateHierarchicalCode('10010203')).not.toThrow();
      expect(() => validateHierarchicalCode('1001020304')).not.toThrow();
      expect(() => validateHierarchicalCode('100102030405')).not.toThrow();
      expect(() => validateHierarchicalCode('10010203040506')).not.toThrow();
    });

    it('rejects level 8 codes (16 digits)', () => {
      expect(() => validateHierarchicalCode('1001020304050607')).toThrow(BadRequestException);
    });

    it('rejects odd digit counts or invalid lengths', () => {
      expect(() => validateHierarchicalCode('1')).toThrow(BadRequestException);
      expect(() => validateHierarchicalCode('100')).toThrow(BadRequestException);
      expect(() => validateHierarchicalCode('10001')).toThrow(BadRequestException);
    });

    it('rejects letters, hyphens and special characters', () => {
      expect(() => validateHierarchicalCode('10-01')).toThrow(BadRequestException);
      expect(() => validateHierarchicalCode('10AB')).toThrow(BadRequestException);
      expect(() => validateHierarchicalCode('10.01')).toThrow(BadRequestException);
      expect(() => validateHierarchicalCode('10_01')).toThrow(BadRequestException);
    });
  });

  describe('validateChildCodePrefix', () => {
    it('accepts direct children that prefix parent code with 2 digits', () => {
      // 30 (Level 1) -> 3010 (Level 2)
      expect(() => validateChildCodePrefix('3010', '30')).not.toThrow();
      // 3010 (Level 2) -> 301001 (Level 3)
      expect(() => validateChildCodePrefix('301001', '3010')).not.toThrow();
      // 301001 (Level 3) -> 30100105 (Level 4)
      expect(() => validateChildCodePrefix('30100105', '301001')).not.toThrow();
    });

    it('rejects children that do not match parent code', () => {
      expect(() => validateChildCodePrefix('2001', '10')).toThrow(BadRequestException);
      expect(() => validateChildCodePrefix('302001', '3010')).toThrow(BadRequestException);
    });

    it('rejects multiple level jumps or single digit extensions', () => {
      expect(() => validateChildCodePrefix('30100101', '3010')).toThrow(BadRequestException);
      expect(() => validateChildCodePrefix('30101', '3010')).toThrow(BadRequestException);
    });
  });

  describe('computeNextChildCode', () => {
    it('generates 01 for the first child under a parent', () => {
      const code = computeNextChildCode('3010', []);
      expect(code).toBe('301001');
    });

    it('finds next available sequence when siblings exist', () => {
      const code = computeNextChildCode('3010', ['301001', '301002']);
      expect(code).toBe('301003');
    });

    it('fills gaps if earlier numbers are deleted or retired', () => {
      const code = computeNextChildCode('3010', ['301002', '301003']);
      expect(code).toBe('301001');
    });

    it('rejects generating child for level 7 parent', () => {
      expect(() =>
        computeNextChildCode('10010203040506', []),
      ).toThrow(BadRequestException);
    });

    it('generates dynamic root codes without type bias', () => {
      expect(computeNextChildCode(null, [])).toBe('01');
      expect(computeNextChildCode(null, ['01'])).toBe('02');
      expect(computeNextChildCode(null, ['01', '02'])).toBe('03');
    });
  });
});
