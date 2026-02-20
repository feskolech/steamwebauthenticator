import { randomUUID } from 'crypto';
import SteamTotp from 'steam-totp';
import type { MaFile, SteamSessionState } from '../utils/mafile';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SteamCommunity = require('steamcommunity') as new (...args: any[]) => any;

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 40_000;

type PendingSteamEnrollment = {
  id: string;
  userId: number;
  accountName: string;
  steamid: string;
  sharedSecret: string;
  identitySecret: string;
  revocationCode: string | null;
  serialNumber: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  client: any;
  session: SteamSessionState | null;
};

type GuardCodeKind = 'email' | 'totp';
type SteamCommunityLoginError = Error & { emaildomain?: string };
type AddAuthenticatorResponse = {
  status?: number;
  shared_secret?: string;
  identity_secret?: string;
  revocation_code?: string;
  serial_number?: string;
  server_time?: number;
  [key: string]: unknown;
};

export class SteamEnrollmentError extends Error {
  code: string;
  guardType?: GuardCodeKind;
  guardDomain?: string | null;
  status?: number;
  details?: Record<string, unknown>;

  constructor(params: {
    code: string;
    message: string;
    guardType?: GuardCodeKind;
    guardDomain?: string | null;
    status?: number;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.code = params.code;
    this.guardType = params.guardType;
    this.guardDomain = params.guardDomain;
    this.status = params.status;
    this.details = params.details;
  }
}

const pendingById = new Map<string, PendingSteamEnrollment>();

function closeClient(client: any): void {
  if (typeof client?.logOff === 'function') {
    try {
      client.logOff();
    } catch {
      // ignore
    }
  }

  if (typeof client?.removeAllListeners === 'function') {
    try {
      client.removeAllListeners();
    } catch {
      // ignore
    }
  }
}

function parseCookieValue(cookies: string[], name: string): string | undefined {
  const normalizedName = `${name}=`;
  for (const cookie of cookies) {
    const firstPart = cookie.split(';')[0]?.trim();
    if (!firstPart || !firstPart.startsWith(normalizedName)) {
      continue;
    }
    return decodeURIComponent(firstPart.slice(normalizedName.length));
  }
  return undefined;
}

function buildSessionFromCookies(
  steamid: string,
  sessionid: string,
  cookies: string[]
): SteamSessionState | null {
  const steamLoginSecure = parseCookieValue(cookies, 'steamLoginSecure');

  if (!steamid && !steamLoginSecure && !sessionid) {
    return null;
  }

  return {
    steamid,
    steamLoginSecure,
    sessionid
  };
}

function cleanupExpiredEnrollments(): void {
  const now = Date.now();
  for (const [id, pending] of pendingById.entries()) {
    if (pending.expiresAtMs <= now) {
      closeClient(pending.client);
      pendingById.delete(id);
    }
  }
}

setInterval(() => {
  cleanupExpiredEnrollments();
}, 60_000).unref();

async function loginToSteam(params: {
  accountName: string;
  password: string;
  guardCode?: string;
}): Promise<{ client: any; steamid: string; session: SteamSessionState | null }> {
  const client = new SteamCommunity();
  const guardCode = params.guardCode?.trim();

  return await new Promise<{ client: any; steamid: string; session: SteamSessionState | null }>(
    (resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new Error('Steam login timed out'));
      }, LOGIN_TIMEOUT_MS);

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        closeClient(client);
        reject(error);
      };

      const done = (result: { client: any; steamid: string; session: SteamSessionState | null }) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const details: Record<string, unknown> = {
        accountName: params.accountName,
        password: params.password,
        disableMobile: false
      };

      if (guardCode) {
        details.authCode = guardCode;
        details.twoFactorCode = guardCode;
      }

      client.login(
        details,
        (error: SteamCommunityLoginError | null, sessionid?: string, cookies?: string[]) => {
          if (error) {
            if (error.message === 'SteamGuard') {
              fail(
                new SteamEnrollmentError({
                  code: 'STEAM_GUARD_REQUIRED',
                  message: 'Steam Guard email code required',
                  guardType: 'email',
                  guardDomain: error.emaildomain ?? null
                })
              );
              return;
            }

            if (error.message === 'SteamGuardMobile') {
              fail(
                new SteamEnrollmentError({
                  code: 'STEAM_GUARD_REQUIRED',
                  message: 'Steam Guard mobile code required',
                  guardType: 'totp'
                })
              );
              return;
            }

            const message = error.message || 'Steam login failed';
            if (
              guardCode &&
              (message.toLowerCase().includes('guard') || message.toLowerCase().includes('auth code'))
            ) {
              fail(
                new SteamEnrollmentError({
                  code: 'STEAM_GUARD_INVALID',
                  message: 'Steam Guard code is invalid or expired'
                })
              );
              return;
            }

            fail(new Error(message));
            return;
          }

          if (!Array.isArray(cookies) || !sessionid) {
            fail(new Error('Steam login succeeded, but session cookies are unavailable'));
            return;
          }

          const steamid = client?.steamID?.getSteamID64?.();
          if (!steamid) {
            fail(new Error('Steam login succeeded, but steamid is unavailable'));
            return;
          }

          done({
            client,
            steamid,
            session: buildSessionFromCookies(steamid, sessionid, cookies)
          });
        }
      );
    }
  );
}

async function addAuthenticator(client: any, steamid: string): Promise<AddAuthenticatorResponse> {
  return await new Promise<AddAuthenticatorResponse>((resolve, reject) => {
    if (!client?.mobileAccessToken) {
      reject(new Error('No mobile access token available. Steam mobile login token is required for enrollment.'));
      return;
    }

    client.httpRequestPost(
      {
        uri: `https://api.steampowered.com/ITwoFactorService/AddAuthenticator/v1/?access_token=${client.mobileAccessToken}`,
        form: {
          steamid,
          authenticator_type: 1,
          device_identifier: SteamTotp.getDeviceID(steamid),
          sms_phone_id: '1',
          version: 2
        },
        json: true
      },
      (error: Error | null, _response: unknown, body: { response?: AddAuthenticatorResponse }) => {
        if (error) {
          reject(error);
          return;
        }

        if (!body?.response) {
          reject(new Error('Malformed Steam response'));
          return;
        }

        resolve(body.response);
      },
      'steamcommunity'
    );
  });
}

async function finalizeAuthenticator(client: any, sharedSecret: string, activationCode: string): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    client.finalizeTwoFactor(sharedSecret, activationCode, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function formatEnrollmentHint(status: number): string {
  if (status === 2) {
    return 'Steam-side restriction (cooldown after removal, already-active mobile auth, or phone/account hold).';
  }

  if (status === 89) {
    return 'Steam rejected activation code.';
  }

  return 'Steam rejected enrollment request.';
}

function sanitizeEnrollDetails(response: AddAuthenticatorResponse): Record<string, unknown> {
  const allowedKeys = ['status', 'server_time', 'status_detail', 'phone_number_hint', 'want_more'];
  const details: Record<string, unknown> = {};

  for (const key of allowedKeys) {
    if (response[key] !== undefined) {
      details[key] = response[key];
    }
  }

  return details;
}

export async function startSteamEnrollment(params: {
  userId: number;
  accountName: string;
  password: string;
  guardCode?: string;
}): Promise<{
  pendingId: string;
  accountName: string;
  steamid: string;
  expiresInSec: number;
}> {
  cleanupExpiredEnrollments();

  for (const [id, pending] of pendingById.entries()) {
    if (pending.userId === params.userId) {
      closeClient(pending.client);
      pendingById.delete(id);
    }
  }

  const { client, steamid, session } = await loginToSteam({
    accountName: params.accountName,
    password: params.password,
    guardCode: params.guardCode
  });

  try {
    const enrollResponse = await addAuthenticator(client, steamid);
    const status = Number(enrollResponse?.status ?? 1);

    if (status !== 1) {
      throw new SteamEnrollmentError({
        code: 'STEAM_ENROLL_STATUS',
        status,
        message: `Steam rejected mobile authenticator setup (status ${status}). ${formatEnrollmentHint(status)}`,
        details: sanitizeEnrollDetails(enrollResponse)
      });
    }

    if (!enrollResponse?.shared_secret || !enrollResponse?.identity_secret) {
      throw new Error('Steam did not return shared_secret/identity_secret');
    }

    const pendingId = randomUUID();
    const now = Date.now();
    const expiresAtMs = now + ENROLLMENT_TTL_MS;

    pendingById.set(pendingId, {
      id: pendingId,
      userId: params.userId,
      accountName: params.accountName,
      steamid,
      sharedSecret: String(enrollResponse.shared_secret),
      identitySecret: String(enrollResponse.identity_secret),
      revocationCode: enrollResponse.revocation_code ? String(enrollResponse.revocation_code) : null,
      serialNumber: enrollResponse.serial_number ? String(enrollResponse.serial_number) : null,
      createdAtMs: now,
      expiresAtMs,
      client,
      session
    });

    return {
      pendingId,
      accountName: params.accountName,
      steamid,
      expiresInSec: Math.floor(ENROLLMENT_TTL_MS / 1000)
    };
  } catch (error) {
    closeClient(client);
    throw error;
  }
}

export async function finishSteamEnrollment(params: {
  userId: number;
  pendingId: string;
  activationCode: string;
}): Promise<{
  accountName: string;
  steamid: string;
  revocationCode: string | null;
  ma: MaFile;
  session: SteamSessionState | null;
}> {
  cleanupExpiredEnrollments();

  const pending = pendingById.get(params.pendingId);
  if (!pending || pending.userId !== params.userId) {
    throw new Error('Enrollment session not found or expired');
  }

  if (pending.expiresAtMs < Date.now()) {
    closeClient(pending.client);
    pendingById.delete(params.pendingId);
    throw new Error('Enrollment session expired');
  }

  const activationCode = params.activationCode.trim();
  if (!activationCode) {
    throw new Error('Activation code is required');
  }

  try {
    await finalizeAuthenticator(pending.client, pending.sharedSecret, activationCode);
  } catch (error: any) {
    throw new Error(error?.message || 'Failed to finalize mobile authenticator');
  }

  const session = pending.session ?? null;

  const ma: MaFile = {
    account_name: pending.accountName,
    shared_secret: pending.sharedSecret,
    identity_secret: pending.identitySecret,
    steamid: pending.steamid,
    device_id: SteamTotp.getDeviceID(pending.steamid),
    revocation_code: pending.revocationCode ?? undefined,
    serial_number: pending.serialNumber ?? undefined,
    Session: session
      ? {
          SteamID: session.steamid,
          SteamLoginSecure: session.steamLoginSecure,
          SessionID: session.sessionid,
          OAuthToken: session.oauthToken
        }
      : undefined
  };

  closeClient(pending.client);
  pendingById.delete(params.pendingId);

  return {
    accountName: pending.accountName,
    steamid: pending.steamid,
    revocationCode: pending.revocationCode,
    ma,
    session
  };
}
