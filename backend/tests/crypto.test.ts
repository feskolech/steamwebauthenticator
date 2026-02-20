import { decryptForUser, encryptForUser } from '../src/utils/crypto';

describe('MA file crypto', () => {
  it('encrypts and decrypts payload for one user key', () => {
    const payload = JSON.stringify({ account_name: 'test', shared_secret: 'secret' });
    const passwordHash = '$2a$12$abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc';
    const encrypted = encryptForUser(payload, passwordHash, 42);

    const decrypted = decryptForUser(encrypted, passwordHash, 42);
    expect(decrypted).toEqual(payload);
  });

  it('fails decryption with different user key', () => {
    const payload = JSON.stringify({ value: 1 });
    const passwordHash = '$2a$12$abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc';
    const encrypted = encryptForUser(payload, passwordHash, 42);

    expect(() => decryptForUser(encrypted, passwordHash, 43)).toThrow();
  });
});
