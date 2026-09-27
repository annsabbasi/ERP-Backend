import { ibanProblem, maskTail, normalizeAccountNo, normalizeIban } from './bank-account';

describe('employee bank account rules', () => {
  it('accepts published example IBANs', () => {
    for (const iban of ['PK36SCBL0000001123456702', 'GB82WEST12345698765432', 'DE89370400440532013000']) {
      expect(ibanProblem(iban)).toBeNull();
    }
  });

  it('catches a single mistyped digit through the mod-97 check', () => {
    expect(ibanProblem('PK36SCBL0000001123456703')).toMatch(/check digits/);
  });

  it('holds a PK IBAN to 24 characters', () => {
    expect(ibanProblem('PK36SCBL000000112345670')).toMatch(/24 characters; this one has 23/);
  });

  it('refuses anything not shaped like an IBAN', () => {
    expect(ibanProblem('1234567890')).toMatch(/2 letters/);
  });

  it('normalizes what people type', () => {
    expect(normalizeIban('pk36 scbl-0000 0011 2345 6702')).toBe('PK36SCBL0000001123456702');
    expect(normalizeAccountNo('0012 3456-7890')).toBe('00123456-7890');
  });

  it('masks all but the last four characters', () => {
    expect(maskTail('PK36SCBL0000001123456702')).toBe('********************6702');
    expect(maskTail('123')).toBe('***');
    expect(maskTail(null)).toBeNull();
  });
});
