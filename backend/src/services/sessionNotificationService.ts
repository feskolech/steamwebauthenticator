import { execute, queryRows } from '../db/pool';
import { createUserNotification } from './webhookService';

function isRussianLanguage(language: string | null | undefined): boolean {
  return String(language ?? '').toLowerCase() === 'ru';
}

export function buildSessionExpiredMessage(
  hasAutomaticRecovery: boolean,
  language?: string | null
): string {
  if (isRussianLanguage(language)) {
    if (hasAutomaticRecovery) {
      return 'Сессия Steam истекла, и автоматическое восстановление не удалось. Откройте детали аккаунта и обновите сессию.';
    }

    return 'Сессия Steam истекла, и автоматическое восстановление недоступно. Откройте детали аккаунта и обновите сессию.';
  }

  if (hasAutomaticRecovery) {
    return 'Steam session expired and automatic recovery failed. Open account details and refresh session.';
  }

  return 'Steam session expired and automatic recovery is unavailable. Open account details and update session.';
}

export function isSteamSessionRecoveryFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();

  return (
    normalized.includes('steam session expired') ||
    normalized.includes('accessdenied') ||
    normalized.includes('invalid token') ||
    normalized.includes('missing access token')
  );
}

export async function clearSessionExpiredNotifications(userId: number, accountId: number): Promise<void> {
  await execute(
    `DELETE FROM notifications
     WHERE user_id = ?
       AND type = 'steam_session_expired'
       AND JSON_EXTRACT(payload, '$.accountId') = ?`,
    [userId, accountId]
  );
}

export async function replaceSessionExpiredNotification(
  userId: number,
  payload: { accountId: number; accountAlias: string; message: string }
): Promise<void> {
  await clearSessionExpiredNotifications(userId, payload.accountId);
  await createUserNotification(userId, 'steam_session_expired', payload);
}

export async function hasRecentSessionExpiredLog(
  userId: number,
  accountId: number,
  windowMinutes = 60
): Promise<boolean> {
  const rows = await queryRows<{ id: number }[]>(
    `SELECT id
     FROM logs
     WHERE user_id = ?
       AND account_id = ?
       AND type = 'system'
       AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.event')) = 'session_expired'
       AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
     LIMIT 1`,
    [userId, accountId, windowMinutes]
  );

  return rows.length > 0;
}
