export {};

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = ['NODE_ENV', 'FORCE_HTTPS'] as const;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function buildProdApp(forceHttps: 'true' | 'false') {
  process.env.NODE_ENV = 'production';
  process.env.FORCE_HTTPS = forceHttps;
  jest.resetModules();

  const { buildApp } = await import('../src/app');
  return buildApp();
}

describe('production HTTPS redirect', () => {
  const originalEnv = snapshotEnv();

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.resetModules();
  });

  it('redirects plain HTTP requests in production when FORCE_HTTPS=true', async () => {
    const app = await buildProdApp('true');

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: 'steam.example.test'
      }
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://steam.example.test/health');

    await app.close();
  });

  it('allows proxied HTTPS requests in production when FORCE_HTTPS=true', async () => {
    const app = await buildProdApp('true');

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: 'steam.example.test',
        'x-forwarded-proto': 'https'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'steamguard-web-api'
    });

    await app.close();
  });

  it('does not redirect when FORCE_HTTPS=false', async () => {
    const app = await buildProdApp('false');

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: 'steam.example.test'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'steamguard-web-api'
    });

    await app.close();
  });
});
