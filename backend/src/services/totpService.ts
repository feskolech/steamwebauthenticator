import { authenticator } from 'otplib';
import QRCode from 'qrcode';

const TOTP_ISSUER = 'SteamGuard Web';

export async function buildTotpSetup(email: string): Promise<{
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}> {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, TOTP_ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return {
    secret,
    otpauthUrl,
    qrCodeDataUrl
  };
}

export function verifyTotpCode(secret: string, token: string): boolean {
  return authenticator.check(token.trim(), secret);
}
