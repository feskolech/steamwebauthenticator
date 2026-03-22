import { createOpaqueCode, hashApiKey } from '../utils/crypto';

export function normalizeRecoveryCodeInput(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
}

function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes = new Set<string>();

  while (codes.size < count) {
    const raw = createOpaqueCode(4).toUpperCase();
    codes.add(formatRecoveryCode(raw));
  }

  return Array.from(codes);
}

export function hashRecoveryCode(value: string): string {
  return hashApiKey(normalizeRecoveryCodeInput(value));
}
