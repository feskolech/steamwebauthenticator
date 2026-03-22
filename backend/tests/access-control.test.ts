import { buildApp } from '../src/app';
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

describe('route access control', () => {
  it('blocks unauthenticated admin access', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/admin/overview' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Unauthorized' });

    await app.close();
  });

  it('blocks non-admin users from admin routes', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: {
        cookie: sessionCookie({ id: 10, email: 'user@example.com', role: 'user' })
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ message: 'Forbidden' });

    await app.close();
  });

  it('requires sensitive re-auth for account deletion', async () => {
    const app = await buildApp();
    const csrf = await csrfContext(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/accounts/123',
      headers: {
        cookie: `${sessionCookie({ id: 42, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toEqual({
      code: 'SENSITIVE_AUTH_REQUIRED',
      message: 'Sensitive action requires password confirmation.'
    });

    await app.close();
  });

  it('requires sensitive re-auth for admin user deletion', async () => {
    const app = await buildApp();
    const csrf = await csrfContext(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/users/77',
      headers: {
        cookie: `${sessionCookie({ id: 1, email: 'admin@example.com', role: 'admin' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toEqual({
      code: 'SENSITIVE_AUTH_REQUIRED',
      message: 'Sensitive action requires password confirmation.'
    });

    await app.close();
  });

  it('requires sensitive re-auth for recovery code regeneration', async () => {
    const app = await buildApp();
    const csrf = await csrfContext(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/recovery-codes/regenerate',
      headers: {
        cookie: `${sessionCookie({ id: 42, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      }
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toEqual({
      code: 'SENSITIVE_AUTH_REQUIRED',
      message: 'Sensitive action requires password confirmation.'
    });

    await app.close();
  });

  it('blocks telegram bot endpoints without bot token', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/telegram/bot/profile/12345'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Invalid bot token' });

    await app.close();
  });

  it('blocks telegram bot endpoints with duplicated bot token headers', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/telegram/bot/profile/12345',
      headers: {
        'x-telegram-bot-token': ['token-a', 'token-b'] as unknown as string
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Invalid bot token' });

    await app.close();
  });
});
