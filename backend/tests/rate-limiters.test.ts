import { getRateLimiterStoreKind } from '../src/middleware/rateLimiters';

describe('rate limiter store selection', () => {
  it('uses memory store in test mode even with redis configured', () => {
    expect(getRateLimiterStoreKind({
      NODE_ENV: 'test',
      RATE_LIMIT_REDIS_URL: 'redis://redis:6379/0'
    })).toBe('memory');
  });

  it('uses memory store when redis url is empty', () => {
    expect(getRateLimiterStoreKind({
      NODE_ENV: 'production',
      RATE_LIMIT_REDIS_URL: ''
    })).toBe('memory');
  });

  it('uses redis store when configured outside tests', () => {
    expect(getRateLimiterStoreKind({
      NODE_ENV: 'production',
      RATE_LIMIT_REDIS_URL: 'redis://redis:6379/0'
    })).toBe('redis');
  });
});
