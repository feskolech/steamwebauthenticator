import bcrypt from 'bcryptjs';
import { env } from '../config/env';
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
}

export async function ensureBootstrapData(): Promise<void> {
  await ensureSchemaUpgrades();

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
