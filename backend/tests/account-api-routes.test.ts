jest.mock('../src/db/pool', () => ({
  queryRows: jest.fn(),
  execute: jest.fn(),
  db: {
    getConnection: jest.fn()
  }
}));

jest.mock('../src/middleware/rateLimiters', () => ({
  guardLoginByIp: jest.fn().mockResolvedValue(undefined),
  guardLogin2faByIp: jest.fn().mockResolvedValue(undefined),
  guardRegisterByIp: jest.fn().mockResolvedValue(undefined),
  guardWriteByIp: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/services/accountOrganizationService', () => ({
  listAccountTagsByAccountIds: jest.fn().mockImplementation(async (_userId: number, accountIds: number[]) => {
    const map = new Map<number, Array<{ id: number; name: string; createdAt: Date }>>();
    for (const accountId of accountIds) {
      map.set(accountId, [{ id: 3, name: 'main', createdAt: new Date('2026-06-22T07:00:00Z') }]);
    }
    return map;
  }),
  listFoldersByUser: jest.fn().mockResolvedValue([]),
  listTagsByUser: jest.fn().mockResolvedValue([])
}));

jest.mock('../src/services/steamService', () => {
  const actual = jest.requireActual('../src/services/steamService');
  return {
    ...actual,
    respondToConfirmationWithSessionRecovery: jest.fn()
  };
});

import { buildApp } from '../src/app';
import { execute, queryRows } from '../src/db/pool';
import { env } from '../src/config/env';
import { encryptForUser } from '../src/utils/crypto';
import { signSessionToken } from '../src/utils/jwt';
import jwt from 'jsonwebtoken';
import { respondToConfirmationWithSessionRecovery } from '../src/services/steamService';

const USER_ID = 7;
const PASSWORD_HASH = '$2a$10$123456789012345678901u4u56DxsYjQbTkM1Y5AcQq5VULh1l9Km';
const SHARED_SECRET = 'Z9EP1Aw3Cby0FssEl2+hU2yetyI=';
const respondToConfirmationMock =
  respondToConfirmationWithSessionRecovery as jest.MockedFunction<typeof respondToConfirmationWithSessionRecovery>;

function sessionCookie(payload: { id: number; email: string; role: 'user' | 'admin' }): string {
  return `sg_token=${signSessionToken(payload)}`;
}

function sensitiveCookie(userId = USER_ID): string {
  const token = jwt.sign(
    {
      id: userId,
      purpose: 'sensitive'
    },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '10m',
      issuer: 'steamguard-web',
      audience: 'steamguard-web-sensitive',
      subject: String(userId)
    }
  );

  return `sg_sensitive=${token}`;
}

async function csrfContext(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfToken = response.json<{ csrfToken: string }>().csrfToken;
  const csrfCookie = response.cookies.find((cookie) => cookie.name === '_csrf');

  if (!csrfCookie) {
    throw new Error('CSRF cookie was not issued');
  }

  return {
    csrfToken,
    csrfCookie: `_csrf=${csrfCookie.value}`
  };
}

function encryptedMa(accountName = 'main'): string {
  return encryptForUser(
    JSON.stringify({
      account_name: accountName,
      shared_secret: SHARED_SECRET,
      identity_secret: 'Ckykb8vAApDbTW9pZXuLfqK/7Y0=',
      steamid: '76561198000000001'
    }),
    PASSWORD_HASH,
    USER_ID
  );
}

function accountRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 11,
    user_id: USER_ID,
    password_hash: PASSWORD_HASH,
    alias: 'Main',
    account_name: 'main',
    steamid: '76561198000000001',
    encrypted_ma: encryptedMa(),
    encrypted_revocation_code: null,
    source: 'mafile',
    auto_confirm: 0,
    auto_confirm_trades: 0,
    auto_confirm_trade_mode: 'all',
    auto_confirm_logins: 0,
    auto_confirm_delay_sec: 0,
    last_code: null,
    last_active: null,
    folder_id: null,
    folder_name: null,
    created_at: new Date('2026-06-22T07:00:00Z'),
    ...overrides
  };
}

describe('account and bot API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (queryRows as jest.MockedFunction<typeof queryRows>).mockReset();
    (execute as jest.MockedFunction<typeof execute>).mockReset();
    respondToConfirmationMock.mockReset();
  });

  it('lists owned accounts with organization metadata', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock.mockResolvedValueOnce([
      {
        id: 11,
        alias: 'Main',
        account_name: 'main',
        steamid: '76561198000000001',
        source: 'mafile',
        auto_confirm: 0,
        auto_confirm_trades: 1,
        auto_confirm_trade_mode: 'incoming_only',
        auto_confirm_logins: 0,
        auto_confirm_delay_sec: 5,
        last_code: 'ABC12',
        last_active: new Date('2026-06-22T07:00:00Z'),
        folder_id: 2,
        folder_name: 'Farm',
        created_at: new Date('2026-06-21T07:00:00Z'),
        has_recovery_code: 1
      }
    ] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: {
        cookie: sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queryRowsMock).toHaveBeenCalledWith(expect.stringContaining('WHERE a.user_id = ?'), [USER_ID]);
    expect(response.json().items[0]).toMatchObject({
      id: 11,
      alias: 'Main',
      accountName: 'main',
      source: 'mafile',
      autoConfirmTrades: true,
      autoConfirmTradeMode: 'incoming_only',
      autoConfirmLogins: false,
      folderName: 'Farm',
      hasRecoveryCode: true,
      tags: [{ id: 3, name: 'main', createdAt: expect.any(String) }]
    });

    await app.close();
  });

  it('generates live Steam Guard codes for owned accounts', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH }] as never)
      .mockResolvedValueOnce([{ id: 11, encrypted_ma: encryptedMa() }] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts/live-codes',
      headers: {
        cookie: sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      validForSec: expect.any(Number),
      items: [{ accountId: 11, code: expect.any(String) }]
    });
    expect(response.json().items[0].code).toHaveLength(5);

    await app.close();
  });

  it('imports JSON maFile payloads and stores extracted sessions', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock.mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH }] as never);
    executeMock
      .mockResolvedValueOnce({ insertId: 44 } as never)
      .mockResolvedValueOnce({ affectedRows: 1 } as never)
      .mockResolvedValueOnce({ affectedRows: 1 } as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/import',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: {
        alias: 'Imported',
        ma: {
          account_name: 'imported',
          shared_secret: SHARED_SECRET,
          identity_secret: 'Ckykb8vAApDbTW9pZXuLfqK/7Y0=',
          Revocation_code: 'R12345',
          Session: {
            SteamID: '76561198000000002',
            SteamLoginSecure: '76561198000000002||token',
            SessionID: 'sessionid',
            AccessToken: 'access-token',
            RefreshToken: 'refresh-token'
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 44,
      alias: 'Imported',
      accountName: 'imported',
      steamid: '76561198000000002',
      source: 'mafile',
      hasRecoveryCode: true
    });
    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO user_accounts'),
      expect.arrayContaining([USER_ID, 'Imported', 'imported', '76561198000000002'])
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO account_sessions'),
      expect.arrayContaining([44, expect.any(String)])
    );

    await app.close();
  });

  it('updates account alias and separate trade/login auto-confirm settings', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock.mockResolvedValueOnce([
      {
        id: 11,
        user_id: USER_ID,
        alias: 'Old',
        account_name: 'main',
        steamid: '76561198000000001',
        encrypted_ma: encryptedMa(),
        encrypted_revocation_code: null,
        source: 'mafile',
        auto_confirm: 0,
        auto_confirm_trades: 0,
        auto_confirm_trade_mode: 'all',
        auto_confirm_logins: 0,
        auto_confirm_delay_sec: 0,
        last_code: null,
        last_active: null,
        folder_id: null,
        folder_name: null,
        created_at: new Date('2026-06-22T07:00:00Z')
      }
    ] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/accounts/11',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: {
        alias: 'New Alias',
        autoConfirmTrades: true,
        autoConfirmTradeMode: 'incoming_only',
        autoConfirmLogins: false,
        autoConfirmDelaySec: 120
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('auto_confirm_trades = ?'),
      ['New Alias', 1, 'incoming_only', 0, 60, 11, USER_ID]
    );

    await app.close();
  });

  it('serves bot API account list and fresh code routes with ownership checks', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock
      .mockResolvedValueOnce([
        {
          id: 11,
          alias: 'Main',
          account_name: 'main',
          steamid: '76561198000000001',
          auto_confirm: 0,
          auto_confirm_trades: 1,
          auto_confirm_trade_mode: 'all',
          auto_confirm_logins: 0,
          auto_confirm_delay_sec: 5,
          last_code: null,
          last_active: null,
          folder_id: null,
          folder_name: null
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 11,
          user_id: USER_ID,
          encrypted_ma: encryptedMa(),
          password_hash: PASSWORD_HASH
        }
      ] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);

    const app = await buildApp();
    const cookie = sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' });

    const accountsResponse = await app.inject({
      method: 'GET',
      url: '/api/user/accounts',
      headers: { cookie }
    });
    expect(accountsResponse.statusCode).toBe(200);
    expect(accountsResponse.json().items[0]).toMatchObject({
      id: 11,
      alias: 'Main',
      autoConfirmTrades: true,
      autoConfirmTradeMode: 'all',
      autoConfirmLogins: false
    });

    const codeResponse = await app.inject({
      method: 'GET',
      url: '/api/account/11/code',
      headers: { cookie }
    });
    expect(codeResponse.statusCode).toBe(200);
    expect(codeResponse.json().code).toHaveLength(5);
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE user_accounts SET last_code = ?'), [
      expect.any(String),
      11
    ]);

    await app.close();
  });

  it('confirms a trade through the user bot API route using cached nonce', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock
      .mockResolvedValueOnce([accountRow()] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ nonce: 'nonce-123' }] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);
    respondToConfirmationMock.mockResolvedValueOnce({ success: true, session: null, refreshed: false });

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/11/confirm/trade/offer-1',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(respondToConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationId: 'offer-1',
        nonce: 'nonce-123',
        accept: true
      })
    );
    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining("SET status = 'confirmed'"), [11, 'offer-1']);

    await app.close();
  });

  it('rejects user bot API trade confirmation when nonce is unavailable', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock
      .mockResolvedValueOnce([accountRow()] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([] as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/11/confirm/trade/offer-1',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Missing nonce. Fetch trade queue first.' });
    expect(respondToConfirmationMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('stores refreshed sessions after user bot API trade confirmation recovery', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock
      .mockResolvedValueOnce([accountRow()] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ nonce: 'nonce-123' }] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);
    respondToConfirmationMock.mockResolvedValueOnce({
      success: true,
      refreshed: true,
      session: {
        steamid: '76561198000000001',
        steamLoginSecure: '76561198000000001||fresh',
        sessionid: 'fresh-session',
        refreshToken: 'fresh-refresh'
      }
    });

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/11/confirm/trade/offer-1',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO account_sessions'),
      [11, expect.any(String)]
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("type = 'steam_session_expired'"),
      [USER_ID, 11]
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("SET status = 'confirmed'"),
      [11, 'offer-1']
    );

    await app.close();
  });

  it('exports decrypted maFile only after sensitive auth', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock
      .mockResolvedValueOnce([accountRow({ alias: 'Main Account' })] as never)
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH }] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts/11/export',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${sensitiveCookie()}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain('Main Account.maFile');
    expect(JSON.parse(response.body)).toMatchObject({
      account_name: 'main',
      shared_secret: SHARED_SECRET,
      identity_secret: 'Ckykb8vAApDbTW9pZXuLfqK/7Y0='
    });

    await app.close();
  });

  it('returns decrypted recovery code only after sensitive auth', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock
      .mockResolvedValueOnce([
        accountRow({
          encrypted_revocation_code: encryptForUser('R12345', PASSWORD_HASH, USER_ID)
        })
      ] as never)
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH }] as never);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts/11/recovery-code',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${sensitiveCookie()}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ recoveryCode: 'R12345' });

    await app.close();
  });

  it('stores manually supplied Steam session data and clears stale session warnings', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;
    queryRowsMock
      .mockResolvedValueOnce([{ id: USER_ID, password_hash: PASSWORD_HASH }] as never)
      .mockResolvedValueOnce([accountRow()] as never);
    executeMock.mockResolvedValue({ affectedRows: 1 } as never);

    const app = await buildApp();
    const csrf = await csrfContext(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/11/session',
      headers: {
        cookie: `${sessionCookie({ id: USER_ID, email: 'user@example.com', role: 'user' })}; ${sensitiveCookie()}; ${csrf.csrfCookie}`,
        'csrf-token': csrf.csrfToken
      },
      payload: {
        steamid: '76561198000000001',
        steamLoginSecure: '76561198000000001||secure-token',
        sessionid: 'session-id',
        refreshToken: 'refresh-token'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO account_sessions'),
      [11, expect.any(String)]
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("type = 'steam_session_expired'"),
      [USER_ID, 11]
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('session_updated'),
      [USER_ID, 11]
    );

    await app.close();
  });
});
