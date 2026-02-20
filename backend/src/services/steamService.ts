import { createHmac } from 'crypto';
import axios from 'axios';
import SteamTotp from 'steam-totp';
import type { MaFile, SteamSessionState } from '../utils/mafile';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HttpClient } = require('steam-session/node_modules/@doctormckay/stdlib/http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AuthenticationClient = require('steam-session/dist/AuthenticationClient').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebApiTransport = require('steam-session/dist/transports/WebApiTransport').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EAuthTokenPlatformType = require('steam-session/dist/enums-steam/EAuthTokenPlatformType').default;

const AUTH_SESSION_ID_PREFIX = 'auth:';
const AUTH_SESSION_NONCE_PREFIX = 'authsession:';

export type SteamConfirmation = {
  id: string;
  nonce: string;
  type: 'trade' | 'login' | 'other';
  creatorId?: string;
  headline: string;
  summary: string;
};

function steamIdFromCookieToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{17})\|\|/);
  return match?.[1];
}

function steamIdFromJwt(token: string | undefined): string | undefined {
  if (!token || token.split('.').length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload?.sub === 'string' && /^\d{17}$/.test(payload.sub)) {
      return payload.sub;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function accessTokenFromCookieToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const separatorIndex = value.indexOf('||');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 2) {
    return undefined;
  }

  const token = value.slice(separatorIndex + 2);
  return token.split('.').length >= 2 ? token : undefined;
}

function resolveSteamId(ma: MaFile, session: SteamSessionState | null): string {
  const sessionTokenId =
    steamIdFromJwt(session?.oauthToken) ?? steamIdFromCookieToken(session?.steamLoginSecure);
  const maTokenId =
    steamIdFromJwt(ma.Session?.OAuthToken ?? ma.Session?.AccessToken) ??
    steamIdFromCookieToken(ma.Session?.SteamLoginSecure);

  const steamid = sessionTokenId ?? maTokenId ?? session?.steamid ?? ma.Session?.SteamID ?? ma.steamid;
  if (!steamid) {
    throw new Error('steamid is missing in .maFile/session');
  }
  return steamid;
}

function resolveAccessToken(ma: MaFile, session: SteamSessionState | null): string | undefined {
  return (
    session?.oauthToken ??
    accessTokenFromCookieToken(session?.steamLoginSecure) ??
    ma.Session?.OAuthToken ??
    ma.Session?.AccessToken ??
    accessTokenFromCookieToken(ma.Session?.SteamLoginSecure)
  );
}

function buildCookieHeader(session: SteamSessionState | null, steamid: string): string {
  const parts: string[] = [
    `steamid=${steamid}`,
    'mobileClient=android',
    'mobileClientVersion=777777 3.10.3',
    'Steam_Language=english'
  ];

  if (session?.steamLoginSecure) {
    parts.push(`steamLoginSecure=${encodeURIComponent(session.steamLoginSecure)}`);
  }
  if (session?.sessionid) {
    parts.push(`sessionid=${session.sessionid}`);
  }

  return parts.join('; ');
}

function normalizeLegacyKind(rawItem: any): 'trade' | 'login' | 'other' {
  const rawType = Number(rawItem?.type ?? 0);
  if (rawType === 2) {
    return 'trade';
  }
  if (rawType === 3) {
    return 'login';
  }

  const clue = `${rawItem?.type_name ?? ''} ${rawItem?.headline ?? ''}`.toLowerCase();
  if (clue.includes('sign in') || clue.includes('signin') || clue.includes('login')) {
    return 'login';
  }

  return 'other';
}

function normalizeLegacySummary(rawSummary: unknown): string {
  if (Array.isArray(rawSummary)) {
    return rawSummary
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join(' | ');
  }

  return String(rawSummary ?? '');
}

function encodeAuthSessionNonce(clientId: string, version: number): string {
  return `${AUTH_SESSION_NONCE_PREFIX}${clientId}:${version}`;
}

function parseAuthSessionMeta(confirmationId: string, nonce: string): { clientId: string; version: number } | null {
  if (nonce?.startsWith(AUTH_SESSION_NONCE_PREFIX)) {
    const raw = nonce.slice(AUTH_SESSION_NONCE_PREFIX.length);
    const parts = raw.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[0])) {
      const parsedVersion = Number(parts[1]);
      return {
        clientId: parts[0],
        version: Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1
      };
    }
  }

  if (confirmationId?.startsWith(AUTH_SESSION_ID_PREFIX)) {
    const clientId = confirmationId.slice(AUTH_SESSION_ID_PREFIX.length);
    if (/^\d+$/.test(clientId)) {
      return { clientId, version: 1 };
    }
  }

  return null;
}

function sharedSecretToBuffer(sharedSecret: string): Buffer {
  if (/^[0-9a-f]{40}$/i.test(sharedSecret)) {
    return Buffer.from(sharedSecret, 'hex');
  }
  return Buffer.from(sharedSecret, 'base64');
}

function createAuthClient(): any {
  const webClient = new HttpClient({});
  return new AuthenticationClient({
    platformType: EAuthTokenPlatformType.MobileApp,
    transport: new WebApiTransport(webClient),
    webClient,
    webUserAgent: 'okhttp/4.9.2'
  });
}

function createAuthSessionSummary(info: any): string {
  const parts: string[] = [];

  if (info?.ip) {
    parts.push(`IP: ${String(info.ip)}`);
  }

  const location = [info?.city, info?.state, info?.geoloc]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(', ');

  if (location) {
    parts.push(`Location: ${location}`);
  }

  if (info?.platformType !== undefined && info?.platformType !== null) {
    parts.push(`Platform: ${String(info.platformType)}`);
  }

  return parts.join(' | ');
}

async function mobileConfRequest<T>(params: {
  ma: MaFile;
  session: SteamSessionState | null;
  endpoint: '/mobileconf/getlist' | '/mobileconf/ajaxop';
  tag: string;
  extra?: Record<string, string>;
}): Promise<T> {
  const steamid = resolveSteamId(params.ma, params.session);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = SteamTotp.getConfirmationKey(params.ma.identity_secret, timestamp, params.tag);
  const deviceId = SteamTotp.getDeviceID(steamid);

  const response = await axios.get<T>(`https://steamcommunity.com${params.endpoint}`, {
    params: {
      p: deviceId,
      a: steamid,
      k: key,
      t: timestamp,
      m: 'react',
      tag: params.tag,
      ...(params.extra ?? {})
    },
    headers: {
      Cookie: buildCookieHeader(params.session, steamid)
    },
    timeout: 15000
  });

  return response.data;
}

async function listLegacyMobileConfirmations(
  ma: MaFile,
  session: SteamSessionState | null
): Promise<SteamConfirmation[]> {
  let lastError: Error | null = null;
  const candidateTags = ['list', 'conf'];

  for (const tag of candidateTags) {
    try {
      const response = await mobileConfRequest<any>({
        ma,
        session,
        endpoint: '/mobileconf/getlist',
        tag
      });

      if (!response.success) {
        if (response.needauth) {
          throw new Error('Steam session expired. Refresh account session and try again.');
        }

        lastError = new Error('Steam confirmations request failed.');
        continue;
      }

      const items = Array.isArray(response.conf) ? response.conf : [];

      return items.map((item: any) => ({
        id: String(item.id),
        nonce: String(item.nonce),
        type: normalizeLegacyKind(item),
        creatorId: item.creator_id ? String(item.creator_id) : undefined,
        headline: String(item.headline ?? item.type_name ?? ''),
        summary: normalizeLegacySummary(item.summary)
      }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.toLowerCase().includes('session expired')) {
        throw lastError;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function listAuthSessionConfirmations(
  ma: MaFile,
  session: SteamSessionState | null
): Promise<SteamConfirmation[]> {
  const accessToken = resolveAccessToken(ma, session);
  if (!accessToken) {
    return [];
  }

  const listResponse = await axios.get<any>(
    'https://api.steampowered.com/IAuthenticationService/GetAuthSessionsForAccount/v1/',
    {
      params: {
        access_token: accessToken
      },
      timeout: 15000
    }
  );

  const rawClientIds = Array.isArray(listResponse.data?.response?.client_ids)
    ? listResponse.data.response.client_ids
    : [];

  if (rawClientIds.length === 0) {
    return [];
  }

  const confirmations: SteamConfirmation[] = [];
  const authClient = createAuthClient();

  try {
    for (const rawClientId of rawClientIds) {
      const clientId = String(rawClientId);
      if (!/^\d+$/.test(clientId)) {
        continue;
      }

      let info: any;
      try {
        info = await authClient.getAuthSessionInfo(accessToken, { clientId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('FileNotFound')) {
          continue;
        }
        throw error;
      }

      const versionRaw = Number(info?.version ?? 1);
      const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
      const deviceName = String(info?.deviceFriendlyName ?? '').trim();

      confirmations.push({
        id: `${AUTH_SESSION_ID_PREFIX}${clientId}`,
        nonce: encodeAuthSessionNonce(clientId, version),
        type: 'login',
        creatorId: clientId,
        headline: deviceName ? `Steam sign-in request from ${deviceName}` : 'Steam sign-in request',
        summary: createAuthSessionSummary(info)
      });
    }
  } finally {
    if (typeof authClient?.close === 'function') {
      authClient.close();
    }
  }

  return confirmations;
}

async function respondToAuthSessionConfirmation(params: {
  ma: MaFile;
  session: SteamSessionState | null;
  confirmationId: string;
  nonce: string;
  accept: boolean;
}): Promise<boolean> {
  const meta = parseAuthSessionMeta(params.confirmationId, params.nonce);
  if (!meta) {
    throw new Error('Invalid auth-session confirmation payload');
  }

  const accessToken = resolveAccessToken(params.ma, params.session);
  if (!accessToken) {
    throw new Error('Steam session is missing access token. Refresh account session and try again.');
  }

  const steamid = resolveSteamId(params.ma, params.session);

  const signatureData = Buffer.alloc(2 + 8 + 8);
  signatureData.writeUInt16LE(meta.version, 0);
  signatureData.writeBigUInt64LE(BigInt(meta.clientId), 2);
  signatureData.writeBigUInt64LE(BigInt(steamid), 10);

  const signature = createHmac('sha256', sharedSecretToBuffer(params.ma.shared_secret))
    .update(signatureData)
    .digest();

  const authClient = createAuthClient();

  try {
    await authClient.submitMobileConfirmation(accessToken, {
      version: meta.version,
      clientId: meta.clientId,
      steamId: steamid,
      signature,
      confirm: params.accept,
      persistence: 1
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('DuplicateRequest') || message.includes('FileNotFound')) {
      return true;
    }

    throw error;
  } finally {
    if (typeof authClient?.close === 'function') {
      authClient.close();
    }
  }
}

export function generateSteamCode(sharedSecret: string): string {
  return SteamTotp.generateAuthCode(sharedSecret);
}

export async function listConfirmations(
  ma: MaFile,
  session: SteamSessionState | null
): Promise<SteamConfirmation[]> {
  let legacyItems: SteamConfirmation[] = [];
  let legacyError: Error | null = null;

  try {
    legacyItems = await listLegacyMobileConfirmations(ma, session);
  } catch (error) {
    legacyError = error instanceof Error ? error : new Error(String(error));
  }

  let authSessionItems: SteamConfirmation[] = [];
  try {
    authSessionItems = await listAuthSessionConfirmations(ma, session);
  } catch (error) {
    if (!legacyError) {
      throw error;
    }
  }

  if (legacyError && authSessionItems.length === 0) {
    throw legacyError;
  }

  const merged = new Map<string, SteamConfirmation>();
  for (const item of [...legacyItems, ...authSessionItems]) {
    merged.set(item.id, item);
  }

  return Array.from(merged.values());
}

export async function respondToConfirmation(params: {
  ma: MaFile;
  session: SteamSessionState | null;
  confirmationId: string;
  nonce: string;
  accept: boolean;
}): Promise<boolean> {
  const authSessionMeta = parseAuthSessionMeta(params.confirmationId, params.nonce);
  if (authSessionMeta) {
    return await respondToAuthSessionConfirmation(params);
  }

  const response = await mobileConfRequest<any>({
    ma: params.ma,
    session: params.session,
    endpoint: '/mobileconf/ajaxop',
    tag: params.accept ? 'allow' : 'cancel',
    extra: {
      op: params.accept ? 'allow' : 'cancel',
      cid: params.confirmationId,
      ck: params.nonce
    }
  });

  return Boolean(response.success);
}
