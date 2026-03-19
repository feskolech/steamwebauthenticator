import axios from 'axios';
import { env } from '../config/env';

type TurnstileVerificationResponse = {
  success: boolean;
  hostname?: string;
  action?: string;
  ['error-codes']?: string[];
};

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!env.TURNSTILE_ENABLED) {
    return { ok: true };
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, message: 'Turnstile is enabled but not configured on the server.' };
  }

  if (!token) {
    return { ok: false, message: 'Complete the anti-bot check and try again.' };
  }

  try {
    const body = new URLSearchParams();
    body.set('secret', env.TURNSTILE_SECRET_KEY);
    body.set('response', token);
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }

    const response = await axios.post<TurnstileVerificationResponse>(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      body,
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        timeout: 5000
      }
    );

    if (!response.data.success) {
      return { ok: false, message: 'Anti-bot verification failed. Please try again.' };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: 'Anti-bot verification is temporarily unavailable. Please try again.' };
  }
}
