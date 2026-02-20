import axios from 'axios';
import SteamTotp from 'steam-totp';
import type { MaFile, SteamSessionState } from '../utils/mafile';

export type SteamConfirmation = {
  id: string;
  nonce: string;
  type: 'trade' | 'login' | 'other';
  creatorId?: string;
  headline: string;
  summary: string;
};

function resolveSteamId(ma: MaFile, session: SteamSessionState | null): string {
  const steamid = ma.steamid ?? ma.Session?.SteamID ?? session?.steamid;
  if (!steamid) {
    throw new Error('steamid is missing in .maFile/session');
  }
  return steamid;
}

function buildCookieHeader(session: SteamSessionState | null, steamid: string): string {
  const parts: string[] = [`steamid=${steamid}`];

  if (session?.steamLoginSecure) {
    parts.push(`steamLoginSecure=${encodeURIComponent(session.steamLoginSecure)}`);
  }
  if (session?.sessionid) {
    parts.push(`sessionid=${session.sessionid}`);
  }

  return parts.join('; ');
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
      m: 'android',
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

export function generateSteamCode(sharedSecret: string): string {
  return SteamTotp.generateAuthCode(sharedSecret);
}

export async function listConfirmations(
  ma: MaFile,
  session: SteamSessionState | null
): Promise<SteamConfirmation[]> {
  const response = await mobileConfRequest<any>({
    ma,
    session,
    endpoint: '/mobileconf/getlist',
    tag: 'conf'
  });

  if (!response.success) {
    if (response.needauth) {
      throw new Error('Steam session expired. Refresh account session and try again.');
    }
    throw new Error('Steam confirmations request failed.');
  }

  const items = Array.isArray(response.conf) ? response.conf : [];

  return items.map((item: any) => ({
    id: String(item.id),
    nonce: String(item.nonce),
    type: item.type === 2 ? 'trade' : item.type === 3 ? 'login' : 'other',
    creatorId: item.creator_id ? String(item.creator_id) : undefined,
    headline: String(item.headline ?? ''),
    summary: String(item.summary ?? '')
  }));
}

export async function respondToConfirmation(params: {
  ma: MaFile;
  session: SteamSessionState | null;
  confirmationId: string;
  nonce: string;
  accept: boolean;
}): Promise<boolean> {
  const response = await mobileConfRequest<any>({
    ma: params.ma,
    session: params.session,
    endpoint: '/mobileconf/ajaxop',
    tag: 'conf',
    extra: {
      op: params.accept ? 'allow' : 'cancel',
      cid: params.confirmationId,
      ck: params.nonce
    }
  });

  return Boolean(response.success);
}
