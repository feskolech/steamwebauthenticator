import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('returns API health status', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'steamguard-web-api'
    });
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain('https://challenges.cloudflare.com');

    await app.close();
  });
});
