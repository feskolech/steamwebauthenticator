jest.mock('../src/db/pool', () => ({
  queryRows: jest.fn(),
  execute: jest.fn(),
  db: {
    getConnection: jest.fn()
  }
}));

jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    env: {
      ...actual.env,
      TELEGRAM_BOT_TOKEN: 'test-bot-token'
    }
  };
});

jest.mock('../src/services/steamService', () => {
  const actual = jest.requireActual('../src/services/steamService');
  return {
    ...actual,
    respondToConfirmationWithSessionRecovery: jest.fn()
  };
});

jest.mock('../src/services/wsHub', () => ({
  wsHub: {
    sendToUser: jest.fn()
  }
}));

import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import { execute, queryRows } from '../src/db/pool';
import { encryptForUser } from '../src/utils/crypto';
import { respondToConfirmationWithSessionRecovery } from '../src/services/steamService';
import { wsHub } from '../src/services/wsHub';

const USER_ID = 7;
const PASSWORD_HASH = '$2a$10$123456789012345678901u4u56DxsYjQbTkM1Y5AcQq5VULh1l9Km';
const SHARED_SECRET = Buffer.from('steamguard-test-shared-secret').toString('base64');
const IDENTITY_SECRET = Buffer.from('steamguard-test-identity-secret').toString('base64');

const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
const executeMock = execute as jest.MockedFunction<typeof execute>;
const respondMock = respondToConfirmationWithSessionRecovery as jest.MockedFunction<
  typeof respondToConfirmationWithSessionRecovery
>;
const wsHubMock = wsHub.sendToUser as jest.MockedFunction<typeof wsHub.sendToUser>;

function botHeaders() {
  return { 'x-telegram-bot-token': env.TELEGRAM_BOT_TOKEN };
}

function encryptedMa(): string {
  return encryptForUser(
    JSON.stringify({
      account_name: 'main',
      shared_secret: SHARED_SECRET,
      identity_secret: IDENTITY_SECRET,
      steamid: '76561198000000001'
    }),
    PASSWORD_HASH,
    USER_ID
  );
}

describe('telegram bot internal API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryRowsMock.mockReset();
    executeMock.mockReset();
    respondMock.mockReset();
  });

  it('links Telegram users with valid /add codes', async () => {
    queryRowsMock
      .mockResolvedValueOnce([{ id: 99, user_id: USER_ID }] as never)
      .mockResolvedValueOnce([{ language: 'ru' }] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/telegram/bot/link',
      headers: botHeaders(),
      payload: { code: 'LINK42', telegramUserId: '12345', username: 'tester' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, userId: USER_ID, language: 'ru' });
    expect(executeMock).toHaveBeenNthCalledWith(1, expect.stringContaining('UPDATE users SET telegram_user_id'), [
      '12345',
      'tester',
      USER_ID
    ]);
    expect(executeMock).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE telegram_link_codes'), [99]);

    await app.close();
  });

  it('approves Telegram OAuth deep-link codes', async () => {
    executeMock.mockResolvedValueOnce({ affectedRows: 1 } as never);
    queryRowsMock.mockResolvedValueOnce([{ language: 'en' }] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/telegram/bot/oauth',
      headers: botHeaders(),
      payload: { code: 'LOGIN42', telegramUserId: '12345', username: 'tester' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, language: 'en' });
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE telegram_oauth_codes'), [
      '12345',
      'tester',
      'LOGIN42'
    ]);

    await app.close();
  });

  it('returns account lists for linked Telegram users', async () => {
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID }] as never)
      .mockResolvedValueOnce([{ id: 11, alias: 'main', account_name: 'main', steamid: '76561198000000001' }] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/telegram/bot/accounts/12345',
      headers: botHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ id: 11, alias: 'main' });

    await app.close();
  });

  it('generates Steam Guard codes for linked Telegram users', async () => {
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH }] as never)
      .mockResolvedValueOnce([{ id: 11, alias: 'main', encrypted_ma: encryptedMa() }] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/telegram/bot/codes/12345',
      headers: botHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ accountId: 11, alias: 'main', code: expect.any(String) });
    expect(response.json().items[0].code).toHaveLength(5);

    await app.close();
  });

  it('lists pending confirmations for linked Telegram users', async () => {
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID }] as never)
      .mockResolvedValueOnce([
        {
          account_id: 11,
          alias: 'main',
          confirmation_id: '9001',
          nonce: 'nonce-1',
          kind: 'trade',
          headline: 'Selling item',
          summary: 'MP9',
          status: 'pending'
        }
      ] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/telegram/bot/confirms/12345',
      headers: botHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ account_id: 11, confirmation_id: '9001' });

    await app.close();
  });

  it('confirms trade ids from /confirm and marks cache confirmed', async () => {
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH, language: 'en' }] as never)
      .mockResolvedValueOnce([{ id: 11, encrypted_ma: encryptedMa() }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ nonce: 'nonce-1' }] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);
    respondMock.mockResolvedValueOnce({ success: true, session: null, refreshed: false });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/telegram/bot/confirm',
      headers: botHeaders(),
      payload: {
        telegramUserId: '12345',
        accountId: 11,
        confirmationId: '9001'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, language: 'en' });
    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmationId: '9001', nonce: 'nonce-1', accept: true })
    );
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'confirmed'"),
      [11, '9001']
    );

    await app.close();
  });

  it('responds to inline confirmations and emits user events', async () => {
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH, language: 'ru' }] as never)
      .mockResolvedValueOnce([
        {
          account_id: 11,
          confirmation_id: 'auth:1',
          nonce: 'nonce-1',
          kind: 'login',
          encrypted_ma: encryptedMa(),
          status: 'pending'
        }
      ] as never)
      .mockResolvedValueOnce([] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);
    respondMock.mockResolvedValueOnce({ success: true, session: null, refreshed: false });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/telegram/bot/respond',
      headers: botHeaders(),
      payload: { telegramUserId: '12345', cacheId: 44, accept: false }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      kind: 'login',
      accountId: 11,
      confirmationId: 'auth:1',
      status: 'rejected',
      language: 'ru'
    });
    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmationId: 'auth:1', nonce: 'nonce-1', accept: false })
    );
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE confirmations_cache SET status = ?'), [
      'rejected',
      44
    ]);
    expect(wsHubMock).toHaveBeenCalledWith(USER_ID, 'login:rejected', {
      accountId: 11,
      confirmationId: 'auth:1'
    });

    await app.close();
  });
});
