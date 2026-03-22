import { sanitizeUser } from '../src/services/userService';

describe('sanitizeUser', () => {
  it('does not expose legacy Steam user id field', () => {
    const sanitized = sanitizeUser({
      id: 1,
      email: 'user@example.com',
      role: 'user',
      language: 'en',
      theme: 'dark',
      telegram_user_id: null,
      telegram_username: null,
      twofa_method: 'none',
      api_key_last4: null,
      is_active: 1,
      password_hash: 'hash'
    });

    expect(sanitized).not.toHaveProperty('steamUserId');
  });
});
