import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCodeInput
} from '../src/services/recoveryCodeService';

describe('recovery code service', () => {
  it('normalizes recovery code input', () => {
    expect(normalizeRecoveryCodeInput(' abcd-1234 ')).toBe('ABCD1234');
  });

  it('generates unique human-readable codes', () => {
    const codes = generateRecoveryCodes(8);

    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((code) => /^[A-F0-9]{4}-[A-F0-9]{4}$/.test(code))).toBe(true);
  });

  it('hashes equivalent recovery codes consistently', () => {
    expect(hashRecoveryCode('ABCD-1234')).toBe(hashRecoveryCode('abcd1234'));
  });
});
