import { buildSessionExpiredMessage } from '../src/services/sessionNotificationService';

describe('buildSessionExpiredMessage', () => {
  it('explains when automatic recovery is unavailable', () => {
    expect(buildSessionExpiredMessage(false, 'en')).toBe(
      'Steam session expired and automatic recovery is unavailable. Open account details and update session.'
    );
  });

  it('explains when automatic recovery was attempted but failed', () => {
    expect(buildSessionExpiredMessage(true, 'en')).toBe(
      'Steam session expired and automatic recovery failed. Open account details and refresh session.'
    );
  });

  it('returns Russian text for Russian-language users', () => {
    expect(buildSessionExpiredMessage(false, 'ru')).toBe(
      'Сессия Steam истекла, и автоматическое восстановление недоступно. Откройте детали аккаунта и обновите сессию.'
    );
    expect(buildSessionExpiredMessage(true, 'ru')).toBe(
      'Сессия Steam истекла, и автоматическое восстановление не удалось. Откройте детали аккаунта и обновите сессию.'
    );
  });
});
