import { config } from 'dotenv';
import { z } from 'zod';

config();

const PROD_BLOCKED_SECRET_PATTERNS = [/^change_me/i, /^test_/i];
const PROD_BLOCKED_SECRET_VALUES = new Set([
  'change_me_super_secret_jwt',
  'change_me_super_secret_cookie',
  'change_me_32_bytes_minimum'
]);

export function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
}

const envBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:3001'),
  DB_HOST: z.string().default('mysql'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  COOKIE_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(16),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().default('admin@admin.com'),
  ADMIN_PASSWORD: z.string().min(6).default('admin123'),
  STEAM_POLL_INTERVAL_SEC: z.coerce.number().default(20),
  FORCE_HTTPS: envBoolean.default(true),
  OPENAPI_ENABLED: envBoolean.optional(),
  RATE_LIMIT_REDIS_URL: z.string().default('').refine((value) => value === '' || isRedisUrl(value), {
    message: 'RATE_LIMIT_REDIS_URL must be a valid redis:// or rediss:// URL'
  }),
  RATE_LIMIT_REDIS_PREFIX: z.string().default(''),
  TURNSTILE_ENABLED: envBoolean.default(false),
  TURNSTILE_SECRET_KEY: z.string().optional().default(''),
  TURNSTILE_SITE_KEY: z.string().optional().default('')
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  OPENAPI_ENABLED: parsedEnv.OPENAPI_ENABLED ?? parsedEnv.NODE_ENV !== 'production',
  RATE_LIMIT_REDIS_PREFIX: parsedEnv.RATE_LIMIT_REDIS_PREFIX.trim() || `steamguard:${parsedEnv.NODE_ENV}`
};
export const isProd = env.NODE_ENV === 'production';

function isBlockedProductionSecret(value: string): boolean {
  return PROD_BLOCKED_SECRET_VALUES.has(value)
    || PROD_BLOCKED_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function isWeakProductionSecret(value: string): boolean {
  return value.length < 32;
}

export function validateProductionEnvSecurity(config: Pick<
  typeof env,
  'NODE_ENV' | 'ADMIN_PASSWORD' | 'JWT_SECRET' | 'COOKIE_SECRET' | 'ENCRYPTION_KEY'
>): void {
  if (config.NODE_ENV !== 'production') {
    return;
  }

  const insecureKeys: string[] = [];
  if (config.ADMIN_PASSWORD === 'admin123') {
    insecureKeys.push('ADMIN_PASSWORD');
  }

  for (const [key, value] of Object.entries({
    JWT_SECRET: config.JWT_SECRET,
    COOKIE_SECRET: config.COOKIE_SECRET,
    ENCRYPTION_KEY: config.ENCRYPTION_KEY
  })) {
    if (isBlockedProductionSecret(value) || isWeakProductionSecret(value)) {
      insecureKeys.push(key);
    }
  }

  const uniqueSecrets = new Set([
    config.JWT_SECRET,
    config.COOKIE_SECRET,
    config.ENCRYPTION_KEY
  ]);
  if (uniqueSecrets.size !== 3) {
    insecureKeys.push('JWT_SECRET/COOKIE_SECRET/ENCRYPTION_KEY');
  }

  if (insecureKeys.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure default secrets: ${insecureKeys.join(', ')}`
    );
  }
}
