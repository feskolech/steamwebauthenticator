import type { SteamSessionState } from './mafile';
import { decryptForUser, encryptForUser } from './crypto';

const base64Pattern = /^[A-Za-z0-9+/=]+$/;

function isLikelyEncryptedSession(payload: string): boolean {
  if (!payload || payload.trim().startsWith('{')) {
    return false;
  }

  const parts = payload.split(':');
  if (parts.length !== 3) {
    return false;
  }

  return parts.every((part) => part.length > 0 && base64Pattern.test(part));
}

export function encodeAccountSession(
  session: SteamSessionState,
  passwordHash: string,
  userId: number
): string {
  return encryptForUser(JSON.stringify(session), passwordHash, userId);
}

export function decodeAccountSession(
  storedValue: string,
  passwordHash: string,
  userId: number
): SteamSessionState | null {
  if (!storedValue || storedValue.trim().length === 0) {
    return null;
  }

  const parseJson = (value: string): SteamSessionState | null => {
    const parsed = JSON.parse(value) as SteamSessionState;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  };

  if (isLikelyEncryptedSession(storedValue)) {
    try {
      return parseJson(decryptForUser(storedValue, passwordHash, userId));
    } catch {
      // Fall through to plaintext parser for backward compatibility.
    }
  }

  try {
    return parseJson(storedValue);
  } catch {
    return null;
  }
}
