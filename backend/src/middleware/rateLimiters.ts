import Redis from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { env } from '../config/env';

type RateLimiterOptions = {
  keyPrefix: string;
  points: number;
  duration: number;
  blockDuration: number;
};

type RateLimiterLike = {
  consume: (key: string) => Promise<unknown>;
};

let redisClient: Redis | null = null;
let redisErrorLogged = false;

export function getRateLimiterStoreKind(config: Pick<typeof env, 'NODE_ENV' | 'RATE_LIMIT_REDIS_URL'> = env): 'memory' | 'redis' {
  if (config.NODE_ENV === 'test') {
    return 'memory';
  }

  return config.RATE_LIMIT_REDIS_URL.trim() ? 'redis' : 'memory';
}

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.RATE_LIMIT_REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false
    });

    redisClient.on('error', (error) => {
      if (!redisErrorLogged) {
        redisErrorLogged = true;
        console.error('Redis rate limiter unavailable, falling back to in-memory insurance limiter.', error);
      }
    });
  }

  return redisClient;
}

function createMemoryLimiter(options: RateLimiterOptions): RateLimiterMemory {
  return new RateLimiterMemory(options);
}

function createLimiter(options: RateLimiterOptions): RateLimiterLike {
  if (getRateLimiterStoreKind() === 'memory') {
    return createMemoryLimiter(options);
  }

  return new RateLimiterRedis({
    ...options,
    keyPrefix: `${env.RATE_LIMIT_REDIS_PREFIX}:${options.keyPrefix}`,
    storeClient: getRedisClient(),
    insuranceLimiter: createMemoryLimiter(options)
  });
}

const loginLimiter = createLimiter({
  keyPrefix: 'login_fail_ip',
  points: 10,
  duration: 60,
  blockDuration: 300
});

const login2faLimiter = createLimiter({
  keyPrefix: 'login_2fa_ip',
  points: 8,
  duration: 60,
  blockDuration: 300
});

const writeLimiter = createLimiter({
  keyPrefix: 'write_ip',
  points: 120,
  duration: 60,
  blockDuration: 60
});

const registerLimiter = createLimiter({
  keyPrefix: 'register_ip',
  points: 4,
  duration: 60 * 60,
  blockDuration: 60 * 60
});

async function consumeOrThrow(limiter: RateLimiterLike, key: string): Promise<void> {
  try {
    await limiter.consume(key);
  } catch {
    throw new Error('Too many requests. Please try again later.');
  }
}

export async function guardLoginByIp(ip: string): Promise<void> {
  await consumeOrThrow(loginLimiter, ip);
}

export async function guardLogin2faByIp(ip: string): Promise<void> {
  await consumeOrThrow(login2faLimiter, ip);
}

export async function guardWriteByIp(ip: string): Promise<void> {
  await consumeOrThrow(writeLimiter, ip);
}

export async function guardRegisterByIp(ip: string): Promise<void> {
  await consumeOrThrow(registerLimiter, ip);
}
