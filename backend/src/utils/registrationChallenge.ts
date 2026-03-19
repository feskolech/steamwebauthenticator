import crypto from 'crypto';
import { env } from '../config/env';

const REGISTRATION_CHALLENGE_TTL_MS = 30 * 60 * 1000;
const REGISTRATION_MIN_FILL_MS = 3 * 1000;

type RegistrationChallengePayload = {
  issuedAt: number;
  nonce: string;
};

function signPayload(payload: RegistrationChallengePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function parsePayload(token: string): RegistrationChallengePayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as RegistrationChallengePayload;
    if (
      typeof payload.issuedAt !== 'number' ||
      !Number.isFinite(payload.issuedAt) ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length < 16
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createRegistrationChallenge(): { token: string; minFillMs: number; expiresInSec: number } {
  return {
    token: signPayload({
      issuedAt: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    }),
    minFillMs: REGISTRATION_MIN_FILL_MS,
    expiresInSec: Math.floor(REGISTRATION_CHALLENGE_TTL_MS / 1000)
  };
}

export function validateRegistrationChallenge(token?: string): { ok: true } | { ok: false; message: string } {
  if (!token) {
    return { ok: false, message: 'Registration challenge is missing. Reload the page and try again.' };
  }

  const payload = parsePayload(token);
  if (!payload) {
    return { ok: false, message: 'Registration challenge is invalid. Reload the page and try again.' };
  }

  const ageMs = Date.now() - payload.issuedAt;
  if (ageMs < REGISTRATION_MIN_FILL_MS) {
    return { ok: false, message: 'Registration submitted too quickly. Please wait a moment and try again.' };
  }

  if (ageMs > REGISTRATION_CHALLENGE_TTL_MS) {
    return { ok: false, message: 'Registration challenge expired. Reload the page and try again.' };
  }

  return { ok: true };
}
