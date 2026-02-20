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

export function parseMaFile(raw: Buffer | string | Record<string, unknown>): MaFile {
  const parsed =
    typeof raw === 'string'
      ? JSON.parse(raw)
      : Buffer.isBuffer(raw)
        ? JSON.parse(raw.toString('utf8'))
        : raw;

  return maSchema.parse(parsed);
}

export function extractSessionFromMa(ma: MaFile): SteamSessionState | null {
  const session = ma.Session;
  const steamid = ma.steamid ?? session?.SteamID;
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
