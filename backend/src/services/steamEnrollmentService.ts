import { randomUUID } from 'crypto';
import SteamTotp from 'steam-totp';
import SteamUser from 'steam-user';
import type { MaFile, SteamSessionState } from '../utils/mafile';

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 40_000;
const WEB_SESSION_TIMEOUT_MS = 12_000;

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

const pendingById = new Map<string, PendingSteamEnrollment>();

function closeClient(client: any): void {
  try {
    client.logOff();
  } catch {
    // ignore
  }

  try {
    client.removeAllListeners();
  } catch {
    // ignore
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

function buildSessionFromWebSession(
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

async function waitForWebSession(
  client: any,
  steamid: string,
  timeoutMs: number
): Promise<SteamSessionState | null> {
  return new Promise((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.removeListener('webSession', onWebSession);
        resolve(null);
      }
    }, timeoutMs);

    const onWebSession = (sessionid: string, cookies: string[]) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      resolve(buildSessionFromWebSession(steamid, sessionid, cookies));
    };

    client.once('webSession', onWebSession);

    try {
      client.webLogOn();
    } catch {
      // ignore
    }
  });
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
}): Promise<any> {
  const client = new SteamUser({
    autoRelogin: false,
    dataDirectory: null
  });

  const guardCode = params.guardCode?.trim();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error('Steam login timed out'));
    }, LOGIN_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      client.removeListener('loggedOn', onLoggedOn);
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

    const pass = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const onLoggedOn = () => {
      pass();
    };

    const onSteamGuard = (
      domain: string | null,
      callback: (code: string) => void,
      lastCodeWrong: boolean
    ) => {
      if (!guardCode) {
        const guardKind: GuardCodeKind = domain ? 'email' : 'totp';
        fail(
          new Error(
            guardKind === 'email'
              ? 'Steam Guard email code required'
              : 'Steam Guard mobile code required'
          )
        );
        return;
      }

      if (lastCodeWrong) {
        fail(new Error('Steam Guard code is invalid or expired'));
        return;
      }

      callback(guardCode);
    };

    const onError = (error: any) => {
      fail(new Error(error?.message || 'Steam login failed'));
    };

    const onDisconnected = (_eresult: any, message: string) => {
      if (!settled) {
        fail(new Error(message ? `Steam disconnected: ${message}` : 'Steam disconnected'));
      }
    };

    client.once('loggedOn', onLoggedOn);
    client.on('steamGuard', onSteamGuard);
    client.once('error', onError);
    client.once('disconnected', onDisconnected);

    client.logOn({
      accountName: params.accountName,
      password: params.password
    });
  });

  return client;
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

  const client = await loginToSteam({
    accountName: params.accountName,
    password: params.password,
    guardCode: params.guardCode
  });

  const steamid = client?.steamID?.getSteamID64?.();
  if (!steamid) {
    closeClient(client);
    throw new Error('Steam login succeeded, but steamid is unavailable');
  }

  try {
    const enrollResponse = await client.enableTwoFactor();
    const status = Number(enrollResponse?.status ?? 1);
    if (status !== 1) {
      throw new Error(`Steam rejected mobile authenticator setup (status ${status})`);
    }

    if (!enrollResponse?.shared_secret || !enrollResponse?.identity_secret) {
      throw new Error('Steam did not return shared_secret/identity_secret');
    }

    const webSession = await waitForWebSession(client, steamid, WEB_SESSION_TIMEOUT_MS);

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
      session: webSession
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
    await pending.client.finalizeTwoFactor(Buffer.from(pending.sharedSecret, 'base64'), activationCode);
  } catch (error: any) {
    throw new Error(error?.message || 'Failed to finalize mobile authenticator');
  }

  const refreshedSession =
    (await waitForWebSession(pending.client, pending.steamid, WEB_SESSION_TIMEOUT_MS)) ?? pending.session;

  const session = refreshedSession ?? null;

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

