import { authenticator } from 'otplib';
import { buildTotpSetup, verifyTotpCode } from '../src/services/totpService';

describe('totp service', () => {
  it('creates setup payload with otpauth url', async () => {
    const setup = await buildTotpSetup('user@example.com');

    expect(setup.secret).toBeTruthy();
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('verifies valid TOTP code', async () => {
    const setup = await buildTotpSetup('user@example.com');
    const token = authenticator.generate(setup.secret);

    expect(verifyTotpCode(setup.secret, token)).toBe(true);
    expect(verifyTotpCode(setup.secret, '000000')).toBe(false);
  });
});
