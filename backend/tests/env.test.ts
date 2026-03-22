import { isRedisUrl, validateProductionEnvSecurity } from '../src/config/env';

describe('validateProductionEnvSecurity', () => {
  it('allows test configuration outside production', () => {
    expect(() => validateProductionEnvSecurity({
      NODE_ENV: 'test',
      ADMIN_PASSWORD: 'admin123',
      JWT_SECRET: 'change_me_super_secret_jwt',
      COOKIE_SECRET: 'change_me_super_secret_cookie',
      ENCRYPTION_KEY: 'change_me_32_bytes_minimum'
    })).not.toThrow();
  });

  it('rejects default production secrets', () => {
    expect(() => validateProductionEnvSecurity({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'admin123',
      JWT_SECRET: 'change_me_super_secret_jwt',
      COOKIE_SECRET: 'real_cookie_secret_123456',
      ENCRYPTION_KEY: 'real_encryption_key_123456'
    })).toThrow(/ADMIN_PASSWORD, JWT_SECRET/);
  });

  it('accepts non-default production secrets', () => {
    expect(() => validateProductionEnvSecurity({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'very-strong-admin-password',
      JWT_SECRET: 'real_jwt_secret_1234567890_abcdef',
      COOKIE_SECRET: 'real_cookie_secret_1234567890_abcdef',
      ENCRYPTION_KEY: 'real_encryption_key_1234567890_abcdef'
    })).not.toThrow();
  });

  it('rejects short or reused production secrets', () => {
    expect(() => validateProductionEnvSecurity({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'very-strong-admin-password',
      JWT_SECRET: 'short-secret',
      COOKIE_SECRET: 'short-secret',
      ENCRYPTION_KEY: 'another-short-secret'
    })).toThrow(/JWT_SECRET, COOKIE_SECRET, ENCRYPTION_KEY, JWT_SECRET\/COOKIE_SECRET\/ENCRYPTION_KEY/);
  });

  it('validates redis urls', () => {
    expect(isRedisUrl('redis://redis:6379/0')).toBe(true);
    expect(isRedisUrl('rediss://cache.example.com:6380/1')).toBe(true);
    expect(isRedisUrl('http://redis:6379')).toBe(false);
    expect(isRedisUrl('not-a-url')).toBe(false);
  });
});
