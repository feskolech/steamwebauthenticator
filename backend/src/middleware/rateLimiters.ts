import { RateLimiterMemory } from 'rate-limiter-flexible';

const loginLimiter = new RateLimiterMemory({
  keyPrefix: 'login_fail_ip',
  points: 10,
  duration: 60,
  blockDuration: 300
});

const writeLimiter = new RateLimiterMemory({
  keyPrefix: 'write_ip',
  points: 120,
  duration: 60,
  blockDuration: 60
});

async function consumeOrThrow(limiter: RateLimiterMemory, key: string): Promise<void> {
  try {
    await limiter.consume(key);
  } catch {
    throw new Error('Too many requests. Please try again later.');
  }
}

export async function guardLoginByIp(ip: string): Promise<void> {
  await consumeOrThrow(loginLimiter, ip);
}

export async function guardWriteByIp(ip: string): Promise<void> {
  await consumeOrThrow(writeLimiter, ip);
}
