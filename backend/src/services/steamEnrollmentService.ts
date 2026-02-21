import { randomUUID } from 'crypto';
import SteamTotp from 'steam-totp';
import SteamUser from 'steam-user';
import type { MaFile, SteamSessionState } from '../utils/mafile';

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
  const client = new (SteamUser as any)({
    autoRelogin: false,
    renewRefreshTokens: true
  });
  const guardCode = params.guardCode?.trim();

  return await new Promise<{ client: any; steamid: string; session: SteamSessionState | null }>(
    (resolve, reject) => {
      let settled = false;
      let guardSubmitted = false;
      let steamid: string | null = null;
      let pendingSessionId: string | null = null;
      let pendingCookies: string[] | null = null;

      const timeout = setTimeout(() => {
        fail(new Error('Steam login timed out'));
      }, LOGIN_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        client.removeListener('loggedOn', onLoggedOn);
        client.removeListener('webSession', onWebSession);
        client.removeListener('steamGuard', onSteamGuard);
        client.removeListener('error', onError);
        client.removeListener('disconnected', onDisconnected);
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        closeClient(client);
        reject(error);
      };

      const tryComplete = () => {
        if (settled || !steamid || !pendingSessionId || !pendingCookies) {
          return;
        }

        const session = buildSessionFromCookies(steamid, pendingSessionId, pendingCookies);
        if (!session) {
          fail(new Error('Steam login succeeded, but required web session cookies are unavailable'));
          return;
        }

        settled = true;
        cleanup();
        resolve({
          client,
          steamid,
          session
        });
      };

      const onLoggedOn = () => {
        const currentSteamId = client?.steamID?.getSteamID64?.();
        if (!currentSteamId) {
          fail(new Error('Steam login succeeded, but steamid is unavailable'));
          return;
        }

        steamid = currentSteamId;

        try {
          client.webLogOn();
        } catch {
          // no-op; we'll still wait for webSession event
        }

        tryComplete();
      };

      const onWebSession = (sessionId: string, cookies: string[]) => {
        if (!sessionId || !Array.isArray(cookies) || cookies.length === 0) {
          fail(new Error('Steam login succeeded, but session cookies are unavailable'));
          return;
        }

        pendingSessionId = sessionId;
        pendingCookies = cookies;
        tryComplete();
      };

      const onSteamGuard = (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
        if (!guardCode) {
          fail(
            new SteamEnrollmentError({
              code: 'STEAM_GUARD_REQUIRED',
              message: domain ? 'Steam Guard email code required' : 'Steam Guard mobile code required',
              guardType: domain ? 'email' : 'totp',
              guardDomain: domain ?? null
            })
          );
          return;
        }

        if (lastCodeWrong || guardSubmitted) {
          fail(
            new SteamEnrollmentError({
              code: 'STEAM_GUARD_INVALID',
              message: 'Steam Guard code is invalid or expired'
            })
          );
          return;
        }

        guardSubmitted = true;
        callback(guardCode);
      };

      const onError = (error: any) => {
        const message = error?.message || 'Steam login failed';
        fail(new Error(message));
      };

      const onDisconnected = (_eresult: number, message?: string) => {
        if (!settled) {
          fail(new Error(message || 'Steam connection closed'));
        }
      };

      client.once('loggedOn', onLoggedOn);
      client.once('webSession', onWebSession);
      client.on('steamGuard', onSteamGuard);
      client.once('error', onError);
      client.once('disconnected', onDisconnected);

      client.logOn({
        accountName: params.accountName,
        password: params.password
      });
    }
  );
}

async function addAuthenticator(client: any): Promise<AddAuthenticatorResponse> {
  return await new Promise<AddAuthenticatorResponse>((resolve, reject) => {
    client.enableTwoFactor((error: Error | null, response: AddAuthenticatorResponse | undefined) => {
      if (error) {
        reject(error);
        return;
      }

      if (!response || typeof response !== 'object') {
        reject(new Error('Malformed Steam response'));
        return;
      }

      resolve(response);
    });
  });
}

async function finalizeAuthenticator(client: any, sharedSecret: string, activationCode: string): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    client.finalizeTwoFactor(Buffer.from(sharedSecret, 'base64'), activationCode, (error: Error | null) => {
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
    const enrollResponse = await addAuthenticator(client);
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
