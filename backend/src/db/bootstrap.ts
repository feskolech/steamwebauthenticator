import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { encryptForUser } from '../utils/crypto';
import { execute, queryRows } from './pool';

type UserRow = {
  id: number;
};

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const rows = await queryRows<{ cnt: number }[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function getColumnType(tableName: string, columnName: string): Promise<string | null> {
  const rows = await queryRows<{ column_type: string }[]>(
    `SELECT COLUMN_TYPE AS column_type
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows[0]?.column_type ?? null;
}

async function ensureSchemaUpgrades(): Promise<void> {
  if (!(await hasColumn('user_accounts', 'encrypted_revocation_code'))) {
    await execute(
      'ALTER TABLE user_accounts ADD COLUMN encrypted_revocation_code LONGTEXT NULL AFTER encrypted_ma'
    );
  }

  if (!(await hasColumn('user_accounts', 'source'))) {
    await execute(
      "ALTER TABLE user_accounts ADD COLUMN source ENUM('mafile', 'credentials') NOT NULL DEFAULT 'mafile' AFTER encrypted_revocation_code"
    );
  }

  const hasLegacyAutoConfirm = await hasColumn('user_accounts', 'auto_confirm');
  const hasAutoConfirmTrades = await hasColumn('user_accounts', 'auto_confirm_trades');
  const hasAutoConfirmLogins = await hasColumn('user_accounts', 'auto_confirm_logins');

  if (!hasAutoConfirmTrades) {
    await execute(
      'ALTER TABLE user_accounts ADD COLUMN auto_confirm_trades BOOLEAN NOT NULL DEFAULT FALSE AFTER auto_confirm'
    );
  }

  if (!hasAutoConfirmLogins) {
    await execute(
      'ALTER TABLE user_accounts ADD COLUMN auto_confirm_logins BOOLEAN NOT NULL DEFAULT FALSE AFTER auto_confirm_trades'
    );
  }

  if (hasLegacyAutoConfirm && !hasAutoConfirmTrades) {
    await execute(
      `UPDATE user_accounts
       SET auto_confirm_trades = auto_confirm
       WHERE auto_confirm = TRUE`
    );
  }

  if (!(await hasColumn('users', 'telegram_notify_login_codes'))) {
    await execute(
      'ALTER TABLE users ADD COLUMN telegram_notify_login_codes BOOLEAN NOT NULL DEFAULT FALSE AFTER telegram_username'
    );
  }

  if (!(await hasColumn('telegram_oauth_codes', 'poll_secret_hash'))) {
    await execute(
      "ALTER TABLE telegram_oauth_codes ADD COLUMN poll_secret_hash VARCHAR(128) NOT NULL DEFAULT '' AFTER code"
    );
  }

  if (!(await hasColumn('telegram_oauth_codes', 'consumed_at'))) {
    await execute(
      'ALTER TABLE telegram_oauth_codes ADD COLUMN consumed_at DATETIME NULL AFTER approved'
    );
  }

  const confirmationStatusType = await getColumnType('confirmations_cache', 'status');
  if (confirmationStatusType && !confirmationStatusType.includes("'expired'")) {
    await execute(
      "ALTER TABLE confirmations_cache MODIFY COLUMN status ENUM('pending', 'confirmed', 'rejected', 'expired') NOT NULL DEFAULT 'pending'"
    );
  }
}

async function migrateLegacyAccountSessions(): Promise<void> {
  const rows = await queryRows<
    {
      id: number;
      session_json: string;
      user_id: number;
      password_hash: string;
    }[]
  >(
    `SELECT s.id, s.session_json, a.user_id, u.password_hash
     FROM account_sessions s
     JOIN user_accounts a ON a.id = s.account_id
     JOIN users u ON u.id = a.user_id`
  );

  for (const row of rows) {
    const raw = row.session_json?.trim();
    if (!raw || !raw.startsWith('{')) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const encrypted = encryptForUser(JSON.stringify(parsed), row.password_hash, Number(row.user_id));
    await execute('UPDATE account_sessions SET session_json = ? WHERE id = ?', [encrypted, row.id]);
  }
}

async function invalidateLegacyTelegramOauthCodes(): Promise<void> {
  if (!(await hasColumn('telegram_oauth_codes', 'poll_secret_hash'))) {
    return;
  }

  await execute(
    `UPDATE telegram_oauth_codes
     SET expires_at = UTC_TIMESTAMP()
     WHERE poll_secret_hash = ''`
  );
}

export async function ensureBootstrapData(): Promise<void> {
  await ensureSchemaUpgrades();
  await migrateLegacyAccountSessions();
  await invalidateLegacyTelegramOauthCodes();

  await execute(
    'INSERT INTO global_settings (id, registration_enabled) VALUES (1, TRUE) ON DUPLICATE KEY UPDATE id = id'
  );

  const adminUsers = await queryRows<UserRow[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [env.ADMIN_EMAIL.toLowerCase()]
  );

  if (adminUsers.length === 0) {
    const hash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
    await execute(
      `INSERT INTO users (email, password_hash, role, language, theme, twofa_method)
       VALUES (?, ?, 'admin', 'en', 'dark', 'none')`,
      [env.ADMIN_EMAIL.toLowerCase(), hash]
    );
  }
}
