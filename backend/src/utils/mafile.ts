import { z } from 'zod';

const maSchema = z.object({
  account_name: z.string().min(1),
  shared_secret: z.string().min(1),
  identity_secret: z.string().min(1),
  steamid: z.string().optional(),
  Session: z
    .object({
      SteamID: z.string().optional(),
      SteamLoginSecure: z.string().optional(),
      SessionID: z.string().optional(),
      OAuthToken: z.string().optional()
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

export function parseMaFile(raw: Buffer | string): MaFile {
  const input = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  const parsed = JSON.parse(input);
  return maSchema.parse(parsed);
}

export function extractSessionFromMa(ma: MaFile): SteamSessionState | null {
  const session = ma.Session;
  const steamid = ma.steamid ?? session?.SteamID;
  const steamLoginSecure = session?.SteamLoginSecure;
  const sessionid = session?.SessionID;
  const oauthToken = session?.OAuthToken;

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
