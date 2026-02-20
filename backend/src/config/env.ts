import { config } from 'dotenv';
import { z } from 'zod';

config();

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
  STEAM_POLL_INTERVAL_SEC: z.coerce.number().default(20)
});

export const env = envSchema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
