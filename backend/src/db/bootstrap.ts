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

async function isColumnNullable(tableName: string, columnName: string): Promise<boolean | null> {
  const rows = await queryRows<{ is_nullable: string }[]>(
    `SELECT IS_NULLABLE AS is_nullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows[0] ? rows[0].is_nullable === 'YES' : null;
}

async function hasConstraint(tableName: string, constraintName: string): Promise<boolean> {
  const rows = await queryRows<{ cnt: number }[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?`,
    [tableName, constraintName]
  );

  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function ensureSchemaUpgrades(): Promise<void> {
  await execute(
    `CREATE TABLE IF NOT EXISTS account_folders (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(48) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_account_folders_user_name (user_id, name),
      CONSTRAINT fk_account_folders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS account_tags (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(48) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_account_tags_user_name (user_id, name),
      CONSTRAINT fk_account_tags_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS account_tag_assignments (
      account_id BIGINT UNSIGNED NOT NULL,
      tag_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, tag_id),
      CONSTRAINT fk_account_tag_assignments_account FOREIGN KEY (account_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
      CONSTRAINT fk_account_tag_assignments_tag FOREIGN KEY (tag_id) REFERENCES account_tags(id) ON DELETE CASCADE
    )`
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS user_webhooks (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(120) NOT NULL,
      target_type ENUM('generic', 'discord') NOT NULL,
      url TEXT NOT NULL,
      event_types JSON NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_success_at DATETIME NULL,
      last_failure_at DATETIME NULL,
      last_error VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_webhooks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      webhook_id BIGINT UNSIGNED NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      request_body JSON NOT NULL,
      response_status INT NULL,
      response_body TEXT NULL,
      error_message VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_webhook_deliveries_webhook FOREIGN KEY (webhook_id) REFERENCES user_webhooks(id) ON DELETE CASCADE
    )`
  );

  if (!(await hasColumn('global_settings', 'registration_mode'))) {
    await execute(
      "ALTER TABLE global_settings ADD COLUMN registration_mode ENUM('open', 'disabled', 'domain_allowlist', 'invite_only') NOT NULL DEFAULT 'open' AFTER registration_enabled"
    );
  }

  if (!(await hasColumn('global_settings', 'allowed_email_domains'))) {
    await execute(
      'ALTER TABLE global_settings ADD COLUMN allowed_email_domains TEXT NULL AFTER registration_mode'
    );
  }

  const registrationModeType = await getColumnType('global_settings', 'registration_mode');
  if (registrationModeType && !registrationModeType.includes("'invite_only'")) {
    await execute(
      "ALTER TABLE global_settings MODIFY COLUMN registration_mode ENUM('open', 'disabled', 'domain_allowlist', 'invite_only') NOT NULL DEFAULT 'open'"
    );
  }

  if (await hasColumn('users', 'steam_userid')) {
    await execute('ALTER TABLE users DROP COLUMN steam_userid');
  }

  if (!(await hasColumn('users', 'encrypted_totp_secret'))) {
    await execute('ALTER TABLE users ADD COLUMN encrypted_totp_secret LONGTEXT NULL AFTER twofa_method');
  }

  const userTwofaMethodType = await getColumnType('users', 'twofa_method');
  if (userTwofaMethodType && !userTwofaMethodType.includes("'totp'")) {
    await execute(
      "ALTER TABLE users MODIFY COLUMN twofa_method ENUM('none', 'telegram', 'webauthn', 'totp') NOT NULL DEFAULT 'none'"
    );
  }

  await execute(
    `CREATE TABLE IF NOT EXISTS registration_invites (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      note VARCHAR(255) NULL,
      created_by_user_id BIGINT UNSIGNED NOT NULL,
      used_by_user_id BIGINT UNSIGNED NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_registration_invites_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_registration_invites_used_by FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS pending_totp_setups (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      encrypted_secret LONGTEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_pending_totp_setups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await execute(
    `CREATE TABLE IF NOT EXISTS user_recovery_codes (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      code_hash VARCHAR(128) NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_recovery_codes_hash (code_hash),
      CONSTRAINT fk_user_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  const webauthnChallengeUserNullable = await isColumnNullable('webauthn_challenges', 'user_id');
  if (webauthnChallengeUserNullable === false) {
    await execute('ALTER TABLE webauthn_challenges MODIFY COLUMN user_id BIGINT UNSIGNED NULL');
  }

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

  if (!(await hasColumn('user_accounts', 'folder_id'))) {
    await execute('ALTER TABLE user_accounts ADD COLUMN folder_id BIGINT UNSIGNED NULL AFTER steamid');
  }

  if (!(await hasConstraint('user_accounts', 'fk_user_accounts_folder'))) {
    await execute(
      'ALTER TABLE user_accounts ADD CONSTRAINT fk_user_accounts_folder FOREIGN KEY (folder_id) REFERENCES account_folders(id) ON DELETE SET NULL'
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
