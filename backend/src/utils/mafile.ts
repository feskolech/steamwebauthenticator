import { z } from 'zod';

const optionalString = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().optional());

const maSchema = z.object({
  account_name: z.string().min(1),
  shared_secret: z.string().min(1),
  identity_secret: z.string().min(1),
  steamid: optionalString,
  revocation_code: optionalString,
  Revocation_code: optionalString,
  Session: z
    .object({
      SteamID: optionalString,
      SteamLoginSecure: optionalString,
      SessionID: optionalString,
      OAuthToken: optionalString,
      AccessToken: optionalString
    })
    .passthrough()
    .optional()
}).passthrough();

export type MaFile = z.infer<typeof maSchema>;

export type SteamSessionState = {
  steamid?: string;
  steamLoginSecure?: string;
  sessionid?: string;
  oauthToken?: string;
};

function extractSteamIdFromCookieToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d{17})\|\|/);
  return match?.[1];
}

function extractSteamIdFromJwt(token: string | undefined): string | undefined {
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

export function parseMaFile(raw: Buffer | string | Record<string, unknown>): MaFile {
  const parsed =
    typeof raw === 'string'
      ? JSON.parse(raw)
      : Buffer.isBuffer(raw)
        ? JSON.parse(raw.toString('utf8'))
        : raw;

  if (typeof parsed === 'object' && parsed !== null) {
    const session = (parsed as any).Session;
    const accessToken = session?.OAuthToken ?? session?.AccessToken;
    const tokenSteamId = extractSteamIdFromJwt(typeof accessToken === 'string' ? accessToken : undefined);
    const cookieSteamId = extractSteamIdFromCookieToken(
      typeof session?.SteamLoginSecure === 'string' ? session.SteamLoginSecure : undefined
    );

    if (tokenSteamId && (!session || String(session.SteamID ?? '') !== tokenSteamId)) {
      (parsed as any).Session = {
        ...(session ?? {}),
        SteamID: tokenSteamId
      };
    } else if (cookieSteamId && (!session || String(session.SteamID ?? '') !== cookieSteamId)) {
      (parsed as any).Session = {
        ...(session ?? {}),
        SteamID: cookieSteamId
      };
    }
  }

  return maSchema.parse(parsed);
}

export function extractSessionFromMa(ma: MaFile): SteamSessionState | null {
  const session = ma.Session;
  const tokenSteamId = extractSteamIdFromJwt(session?.OAuthToken ?? session?.AccessToken);
  const cookieSteamId = extractSteamIdFromCookieToken(session?.SteamLoginSecure);
  const steamid = tokenSteamId ?? cookieSteamId ?? session?.SteamID ?? ma.steamid;
  const steamLoginSecure = session?.SteamLoginSecure;
  const sessionid = session?.SessionID;
  const oauthToken = session?.OAuthToken ?? session?.AccessToken;

  if (!steamid && !steamLoginSecure && !sessionid && !oauthToken) {
    return null;
  }

  return {
    steamid,
    steamLoginSecure,
    sessionid,
    oauthToken
  };
}
