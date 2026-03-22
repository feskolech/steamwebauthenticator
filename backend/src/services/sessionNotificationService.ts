import { execute } from '../db/pool';

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

export async function clearSessionExpiredNotifications(userId: number, accountId: number): Promise<void> {
  await execute(
    `DELETE FROM notifications
     WHERE user_id = ?
       AND type = 'steam_session_expired'
       AND JSON_EXTRACT(payload, '$.accountId') = ?`,
    [userId, accountId]
  );
}
