jest.mock('../src/db/pool', () => ({
  execute: jest.fn(),
  queryRows: jest.fn()
}));

jest.mock('../src/services/webhookService', () => ({
  createUserNotification: jest.fn()
}));

import {
  buildSessionExpiredMessage,
  hasRecentSessionExpiredLog,
  isSteamSessionRecoveryFailure,
  replaceSessionExpiredNotification
} from '../src/services/sessionNotificationService';
import { execute, queryRows } from '../src/db/pool';
import { createUserNotification } from '../src/services/webhookService';

const executeMock = execute as jest.MockedFunction<typeof execute>;
const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
const createUserNotificationMock = createUserNotification as jest.MockedFunction<typeof createUserNotification>;

beforeEach(() => {
  jest.clearAllMocks();
  executeMock.mockResolvedValue({ affectedRows: 1 } as any);
  queryRowsMock.mockResolvedValue([]);
  createUserNotificationMock.mockResolvedValue(undefined);
});

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

describe('isSteamSessionRecoveryFailure', () => {
  it('recognizes Steam session refresh failures', () => {
    expect(isSteamSessionRecoveryFailure(new Error('Steam session expired. Open account details.'))).toBe(true);
    expect(isSteamSessionRecoveryFailure(new Error('AccessDenied'))).toBe(true);
    expect(isSteamSessionRecoveryFailure(new Error('Invalid token'))).toBe(true);
    expect(isSteamSessionRecoveryFailure(new Error('Missing access token'))).toBe(true);
  });

  it('ignores unrelated Steam polling failures', () => {
    expect(isSteamSessionRecoveryFailure(new Error('Steam confirmations request failed.'))).toBe(false);
  });
});

describe('session-expired notification persistence', () => {
  it('clears old session-expired notifications for the same account before creating the current one', async () => {
    await replaceSessionExpiredNotification(7, {
      accountId: 12,
      accountAlias: 'main',
      message: 'Steam session expired.'
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("type = 'steam_session_expired'"),
      [7, 12]
    );
    expect(createUserNotificationMock).toHaveBeenCalledWith(7, 'steam_session_expired', {
      accountId: 12,
      accountAlias: 'main',
      message: 'Steam session expired.'
    });
  });

  it('detects recent session-expired logs so poller does not spam user-visible history', async () => {
    queryRowsMock.mockResolvedValueOnce([{ id: 44 }] as any);

    await expect(hasRecentSessionExpiredLog(7, 12)).resolves.toBe(true);

    expect(queryRowsMock).toHaveBeenCalledWith(expect.stringContaining('session_expired'), [7, 12, 60]);
  });

  it('allows a new session-expired log when no recent log exists', async () => {
    queryRowsMock.mockResolvedValueOnce([]);

    await expect(hasRecentSessionExpiredLog(7, 12)).resolves.toBe(false);
  });
});
