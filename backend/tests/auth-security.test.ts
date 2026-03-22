import { buildApp } from '../src/app';

describe('auth security', () => {
  it('rejects telegram oauth polling token in query string', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/telegram/oauth/poll/test-code?token=legacy-query-token'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Missing poll token' });

    await app.close();
  });

  it('sends no-store headers for api responses', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/auth/csrf' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.pragma).toBe('no-cache');

    await app.close();
  });
});
