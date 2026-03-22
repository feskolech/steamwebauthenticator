jest.mock('../src/db/pool', () => ({
  queryRows: jest.fn(),
  execute: jest.fn(),
  db: {
    getConnection: jest.fn()
  }
}));

jest.mock('../src/services/passkeyService', () => ({
  createRegistrationOptions: jest.fn(),
  verifyRegistration: jest.fn(),
  createAuthenticationOptions: jest.fn(),
  verifyAuthentication: jest.fn()
}));

import { buildApp } from '../src/app';
import { execute, queryRows } from '../src/db/pool';
import { createAuthenticationOptions, verifyAuthentication } from '../src/services/passkeyService';

async function csrfContext(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfToken = response.json<{ csrfToken: string }>().csrfToken;
  const csrfCookie = response.cookies.find((cookie) => cookie.name === '_csrf');

  if (!csrfCookie) {
    throw new Error('CSRF cookie was not issued');
  }

  return {
    csrfToken,
    csrfCookie: `_csrf=${csrfCookie.value}`
  };
}

describe('usernameless passkey login', () => {
  it('creates discoverable login options without requiring email', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    const createAuthenticationOptionsMock = createAuthenticationOptions as jest.MockedFunction<typeof createAuthenticationOptions>;

    createAuthenticationOptionsMock.mockResolvedValue({ challenge: 'discoverable-challenge' } as never);
    executeMock.mockResolvedValue({ affectedRows: 1, insertId: 1 } as never);
    queryRowsMock.mockResolvedValue([] as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/webauthn/login/options',
      payload: {},
      headers: {
        cookie: csrf.csrfCookie,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(200);
    expect(createAuthenticationOptionsMock).toHaveBeenCalledWith([]);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, 'login'"),
      [null, 'discoverable-challenge']
    );

    await app.close();
  });

  it('verifies discoverable passkey login without email', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    const verifyAuthenticationMock = verifyAuthentication as jest.MockedFunction<typeof verifyAuthentication>;

    queryRowsMock
      .mockResolvedValueOnce([
        {
          id: 8,
          email: 'user@example.com',
          role: 'user',
          language: 'en',
          theme: 'light',
          telegram_user_id: null,
          telegram_username: null,
          twofa_method: 'webauthn',
          encrypted_totp_secret: null,
          api_key_last4: null,
          is_active: 1,
          password_hash: 'hash',
          credential_id: 'cred-1',
          public_key: Buffer.from('public-key').toString('base64'),
          counter: 4,
          transports: 'internal'
        }
      ] as never)
      .mockResolvedValueOnce([
        { id: 99, challenge: 'discoverable-challenge' }
      ] as never);

    executeMock.mockResolvedValue({ affectedRows: 1 } as never);
    verifyAuthenticationMock.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 }
    } as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/webauthn/login/verify',
      payload: {
        challenge: 'discoverable-challenge',
        response: {
          id: 'cred-1',
          rawId: 'cred-1',
          response: {}
        }
      },
      headers: {
        cookie: csrf.csrfCookie,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queryRowsMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM user_passkeys p'),
      ['cred-1']
    );
    expect(queryRowsMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('challenge = ?'),
      [8, 'discoverable-challenge']
    );
    expect(response.json()).toHaveProperty('user.email', 'user@example.com');

    await app.close();
  });
});
