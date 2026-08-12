jest.mock('../src/db/pool', () => ({
  queryRows: jest.fn(),
  execute: jest.fn(),
  db: {
    getConnection: jest.fn()
  }
}));

import { buildApp } from '../src/app';
import { db, execute, queryRows } from '../src/db/pool';
import { signSessionToken } from '../src/utils/jwt';

function sessionCookie(payload: { id: number; email: string; role: 'user' | 'admin' }): string {
  return `sg_token=${signSessionToken(payload)}`;
}

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

describe('user-facing API routes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('logs out by clearing the session cookie', async () => {
    const app = await buildApp();
    const csrf = await csrfContext(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: `${sessionCookie({ id: 7, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(response.cookies.some((cookie) => cookie.name === 'sg_token' && cookie.value === '')).toBe(true);

    await app.close();
  });

  it('lists and marks web notifications scoped to the current user', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock.mockResolvedValueOnce([
      {
        id: 9,
        channel: 'web',
        type: 'login',
        payload: JSON.stringify({ accountAlias: 'main' }),
        read_at: null,
        created_at: new Date('2026-06-22T07:00:00Z')
      }
    ] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);

    const app = await buildApp();
    const cookie = sessionCookie({ id: 7, email: 'user@example.com', role: 'user' });
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: { cookie }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(queryRowsMock).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = ?'), [7]);
    expect(listResponse.json().items[0]).toMatchObject({
      id: 9,
      channel: 'web',
      type: 'login',
      payload: { accountAlias: 'main' },
      readAt: null
    });

    const csrf = await csrfContext(app);
    const markResponse = await app.inject({
      method: 'POST',
      url: '/api/notifications/9/read',
      headers: {
        cookie: `${cookie}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(markResponse.statusCode).toBe(200);
    expect(markResponse.json()).toEqual({ success: true });
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ? AND user_id = ?'), [9, 7]);

    await app.close();
  });

  it('loads settings metadata and validates Telegram-dependent settings', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock
      .mockResolvedValueOnce([
        {
          language: 'ru',
          theme: 'dark',
          twofa_method: 'none',
          encrypted_totp_secret: null,
          telegram_user_id: null,
          telegram_username: null,
          telegram_notify_login_codes: 0,
          api_key_last4: 'ABCD'
        }
      ] as never)
      .mockResolvedValueOnce([{ total: 2 }] as never)
      .mockResolvedValueOnce([{ total: 1 }] as never)
      .mockResolvedValueOnce([{ telegram_user_id: null }] as never);

    const app = await buildApp();
    const cookie = sessionCookie({ id: 7, email: 'user@example.com', role: 'user' });

    const settingsResponse = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie }
    });

    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.json()).toMatchObject({
      language: 'ru',
      theme: 'dark',
      twofaMethod: 'none',
      hasPasskeys: true,
      hasRecoveryCodes: true,
      telegramLinked: false,
      telegramNotifyLoginCodes: false,
      apiKeyLast4: 'ABCD'
    });

    const csrf = await csrfContext(app);
    const invalidResponse = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: {
        cookie: `${cookie}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: { telegramNotifyLoginCodes: true }
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toEqual({ message: 'Link Telegram first' });

    await app.close();
  });

  it('updates basic settings, creates Telegram link codes, unlinks Telegram and regenerates API keys', async () => {
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const cookie = `${sessionCookie({ id: 7, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`;
    const headers = { cookie, 'csrf-token': csrf.csrfToken };

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers,
      payload: { language: 'en', theme: 'dark' }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toEqual({ success: true });
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET language = ?, theme = ? WHERE id = ?'), [
      'en',
      'dark',
      7
    ]);

    const linkResponse = await app.inject({
      method: 'POST',
      url: '/api/settings/telegram/link-code',
      headers
    });
    expect(linkResponse.statusCode).toBe(200);
    expect(linkResponse.json()).toMatchObject({ expiresInSec: 900 });
    expect(linkResponse.json().command).toMatch(/^\/add=[A-F0-9]{8}$/);

    const unlinkResponse = await app.inject({
      method: 'DELETE',
      url: '/api/settings/telegram',
      headers
    });
    expect(unlinkResponse.statusCode).toBe(200);
    expect(unlinkResponse.json()).toEqual({ success: true });

    const apiKeyResponse = await app.inject({
      method: 'POST',
      url: '/api/settings/api-key',
      headers
    });
    expect(apiKeyResponse.statusCode).toBe(200);
    expect(apiKeyResponse.json().apiKey).toMatch(/^[a-f0-9]{48}$/);
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET api_key_hash = ?, api_key_last4 = ? WHERE id = ?'), [
      expect.any(String),
      expect.any(String),
      7
    ]);

    await app.close();
  });

  it('serves admin overview, user list, invite list and invite creation for admins', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn()
        .mockResolvedValueOnce([{ insertId: 12 }])
        .mockResolvedValueOnce([{}]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn()
    };
    (db.getConnection as jest.Mock).mockResolvedValue(connection);
    queryRowsMock
      .mockResolvedValueOnce([{ total: 3 }] as never)
      .mockResolvedValueOnce([{ total: 5 }] as never)
      .mockResolvedValueOnce([
        {
          id: 8,
          email: 'user@example.com',
          role: 'user',
          language: 'en',
          theme: 'light',
          telegram_user_id: null,
          twofa_method: 'none',
          created_at: new Date('2026-06-22T07:00:00Z')
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 4,
          code: 'INVITE',
          note: 'friend',
          expires_at: new Date('2026-07-01T00:00:00Z'),
          used_at: null,
          created_at: new Date('2026-06-22T07:00:00Z'),
          created_by_email: 'admin@example.com',
          used_by_email: null
        }
      ] as never);

    const app = await buildApp();
    const adminCookie = sessionCookie({ id: 1, email: 'admin@example.com', role: 'admin' });

    const overviewResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { cookie: adminCookie }
    });
    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json()).toEqual({ users: 3, accounts: 5 });

    const usersResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/users?limit=10',
      headers: { cookie: adminCookie }
    });
    expect(usersResponse.statusCode).toBe(200);
    expect(usersResponse.json().items[0]).toMatchObject({
      id: 8,
      email: 'user@example.com',
      telegramLinked: false
    });

    const invitesResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/invites?limit=10',
      headers: { cookie: adminCookie }
    });
    expect(invitesResponse.statusCode).toBe(200);
    expect(invitesResponse.json().items[0]).toMatchObject({
      id: 4,
      code: 'INVITE',
      createdByEmail: 'admin@example.com'
    });

    const csrf = await csrfContext(app);
    const createInviteResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/invites',
      headers: {
        cookie: `${adminCookie}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: { note: 'friend', expiresInDays: 7 }
    });
    expect(createInviteResponse.statusCode).toBe(200);
    expect(createInviteResponse.json().invite).toMatchObject({
      id: 12,
      note: 'friend',
      expiresInDays: 7
    });
    expect(createInviteResponse.json().invite.code).toMatch(/^[A-F0-9]{12}$/);

    await app.close();
  });
});
