import { queryRows } from '../db/pool';

type UserRow = {
  id: number;
  email: string;
  role: 'user' | 'admin';
  language: string;
  theme: 'light' | 'dark';
  telegram_user_id: string | null;
  telegram_username: string | null;
  twofa_method: 'none' | 'telegram' | 'webauthn' | 'totp';
  encrypted_totp_secret?: string | null;
  api_key_last4: string | null;
  is_active: number;
  password_hash: string;
};

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await queryRows<UserRow[]>(
    'SELECT * FROM users WHERE email = ? LIMIT 1',
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const rows = await queryRows<UserRow[]>(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] ?? null;
}

export function sanitizeUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    language: user.language,
    theme: user.theme,
    telegramLinked: Boolean(user.telegram_user_id),
    telegramUsername: user.telegram_username,
    twofaMethod: user.twofa_method,
    hasTotpSecret: Boolean(user.encrypted_totp_secret),
    hasApiKey: Boolean(user.api_key_last4),
    apiKeyLast4: user.api_key_last4,
    isActive: Boolean(user.is_active)
  };
}
