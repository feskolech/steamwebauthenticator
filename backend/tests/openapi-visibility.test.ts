export {};

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = ['NODE_ENV', 'OPENAPI_ENABLED'] as const;

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

async function buildAppWithOpenApi(nodeEnv: 'development' | 'production', openapiEnabled?: 'true' | 'false') {
  process.env.NODE_ENV = nodeEnv;
  if (openapiEnabled === undefined) {
    delete process.env.OPENAPI_ENABLED;
  } else {
    process.env.OPENAPI_ENABLED = openapiEnabled;
  }
  jest.resetModules();

  const { buildApp } = await import('../src/app');
  return buildApp();
}

describe('OpenAPI visibility', () => {
  const originalEnv = snapshotEnv();

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.resetModules();
  });

  it('disables OpenAPI docs by default in production', async () => {
    const app = await buildAppWithOpenApi('production');

    const response = await app.inject({
      method: 'GET',
      url: '/api-docs/openapi.json',
      headers: {
        host: 'steam.example.test',
        'x-forwarded-proto': 'https'
      }
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('allows OpenAPI docs in production when explicitly enabled', async () => {
    const app = await buildAppWithOpenApi('production', 'true');

    const response = await app.inject({
      method: 'GET',
      url: '/api-docs/openapi.json',
      headers: {
        host: 'steam.example.test',
        'x-forwarded-proto': 'https'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('openapi');

    await app.close();
  });
});
