import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';
import { decryptForUser, encryptForUser } from '../utils/crypto';
import { encodeAccountSession } from '../utils/accountSession';
import { extractSessionFromMa, parseMaFile } from '../utils/mafile';
import { generateSteamCode } from '../services/steamService';
import { guardWriteByIp } from '../middleware/rateLimiters';
import {
  finishSteamEnrollment,
  startSteamEnrollment,
  SteamEnrollmentError
} from '../services/steamEnrollmentService';

type AccountRow = {
  id: number;
  user_id: number;
  alias: string;
  account_name: string;
  steamid: string | null;
  encrypted_ma: string;
  encrypted_revocation_code: string | null;
  source: 'mafile' | 'credentials';
  auto_confirm: number;
  auto_confirm_trades: number;
  auto_confirm_logins: number;
  auto_confirm_delay_sec: number;
  last_code: string | null;
  last_active: Date | null;
  created_at: Date;
};

type UserSecretRow = {
  id: number;
  password_hash: string;
};

async function getUserSecret(userId: number): Promise<UserSecretRow> {
  const users = await queryRows<UserSecretRow[]>('SELECT id, password_hash FROM users WHERE id = ? LIMIT 1', [
    userId
  ]);

  const user = users[0];
  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

async function getAccountByOwner(userId: number, accountId: number): Promise<AccountRow> {
  const rows = await queryRows<AccountRow[]>(
    `SELECT *
     FROM user_accounts
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [accountId, userId]
  );

  const account = rows[0];
  if (!account) {
    throw new Error('Account not found');
  }

  return account;
}

const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/accounts', { preHandler: app.authenticate }, async (request) => {
    const accounts = await queryRows<any[]>(
      `SELECT id, alias, account_name, steamid, source, auto_confirm, auto_confirm_trades, auto_confirm_logins, auto_confirm_delay_sec,
              last_code, last_active, created_at,
              IF(encrypted_revocation_code IS NULL, FALSE, TRUE) AS has_recovery_code
       FROM user_accounts
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [request.user.id]
    );

    return {
      items: accounts.map((item) => ({
        id: item.id,
        alias: item.alias,
        accountName: item.account_name,
        steamid: item.steamid,
        source: item.source,
        autoConfirm: Boolean(item.auto_confirm ?? item.auto_confirm_trades),
        autoConfirmTrades: Boolean(item.auto_confirm_trades ?? item.auto_confirm),
        autoConfirmLogins: Boolean(item.auto_confirm_logins),
        autoConfirmDelaySec: item.auto_confirm_delay_sec,
        lastCode: item.last_code,
        lastActive: item.last_active,
        createdAt: item.created_at,
        hasRecoveryCode: Boolean(item.has_recovery_code)
      }))
    };
  });

  app.get('/api/accounts/live-codes', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const user = await getUserSecret(request.user.id);
      const accounts = await queryRows<{ id: number; encrypted_ma: string }[]>(
        `SELECT id, encrypted_ma
         FROM user_accounts
         WHERE user_id = ?`,
        [request.user.id]
      );

      const nowSec = Math.floor(Date.now() / 1000);
      const validForSec = 30 - (nowSec % 30) || 30;

      const items = accounts.map((account) => {
        const ma = parseMaFile(decryptForUser(account.encrypted_ma, user.password_hash, user.id));
        const code = generateSteamCode(ma.shared_secret);
        return {
          accountId: account.id,
          code
        };
      });

      return {
        generatedAt: new Date().toISOString(),
        validForSec,
        items
      };
    } catch (error: any) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.get<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const account = await getAccountByOwner(request.user.id, Number(request.params.accountId));

        return {
          id: account.id,
          alias: account.alias,
          accountName: account.account_name,
          steamid: account.steamid,
          source: account.source,
          autoConfirm: Boolean(account.auto_confirm ?? account.auto_confirm_trades),
          autoConfirmTrades: Boolean(account.auto_confirm_trades ?? account.auto_confirm),
          autoConfirmLogins: Boolean(account.auto_confirm_logins),
          autoConfirmDelaySec: account.auto_confirm_delay_sec,
          lastCode: account.last_code,
          lastActive: account.last_active,
          createdAt: account.created_at,
          hasRecoveryCode: Boolean(account.encrypted_revocation_code)
        };
      } catch (error: any) {
        return reply.code(404).send({ message: error.message });
      }
    }
  );

  app.post('/api/accounts/import', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      await guardWriteByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    const user = await getUserSecret(request.user.id);

    try {
      const isMultipart = (request as any).isMultipart?.() ?? false;
      let maSource: Buffer | string | Record<string, unknown>;
      let aliasInput: string | undefined;

      if (isMultipart) {
        const file = await request.file();
        if (!file) {
          return reply.code(400).send({ message: 'No .maFile provided' });
        }

        maSource = await file.toBuffer();
        const aliasField = file.fields.alias as { value?: string } | undefined;
        aliasInput = aliasField?.value?.toString().trim();
      } else {
        const body = (request.body ?? {}) as Record<string, unknown>;
        aliasInput = typeof body.alias === 'string' ? body.alias.trim() : undefined;

        if (body.ma && typeof body.ma === 'object') {
          maSource = body.ma as Record<string, unknown>;
        } else if (body.raw && typeof body.raw === 'object') {
          maSource = body.raw as Record<string, unknown>;
        } else if (body.file && typeof body.file === 'object') {
          maSource = body.file as Record<string, unknown>;
        } else if (body.shared_secret && body.identity_secret && body.account_name) {
          maSource = body;
        } else {
          return reply.code(400).send({
            message:
              'No .maFile payload provided. Use multipart file upload or JSON body with ma/shared_secret.'
          });
        }
      }

      const ma = parseMaFile(maSource);
      const alias = aliasInput || ma.account_name;
      const revocationCode =
        (ma as any).revocation_code ??
        (ma as any).Revocation_code ??
        null;

      const encryptedMa = encryptForUser(JSON.stringify(ma), user.password_hash, user.id);
      const encryptedRecoveryCode = revocationCode
        ? encryptForUser(String(revocationCode), user.password_hash, user.id)
        : null;

      const insertResult = await execute(
        `INSERT INTO user_accounts
          (user_id, alias, account_name, steamid, encrypted_ma, encrypted_revocation_code, source)
         VALUES (?, ?, ?, ?, ?, ?, 'mafile')`,
        [
          user.id,
          alias,
          ma.account_name,
          ma.Session?.SteamID ?? ma.steamid ?? null,
          encryptedMa,
          encryptedRecoveryCode
        ]
      );

      const accountId = Number(insertResult.insertId);

      const extractedSession = extractSessionFromMa(ma);
      if (extractedSession) {
        const encryptedSession = encodeAccountSession(extractedSession, user.password_hash, user.id);
        await execute(
          `INSERT INTO account_sessions (account_id, session_json)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE session_json = VALUES(session_json)`,
          [accountId, encryptedSession]
        );
      }

      await execute(
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'system', JSON_OBJECT('event', 'ma_import'))",
        [user.id, accountId]
      );

      return {
        id: accountId,
        alias,
        accountName: ma.account_name,
        steamid: ma.Session?.SteamID ?? ma.steamid ?? null,
        source: 'mafile',
        hasRecoveryCode: Boolean(revocationCode)
      };
    } catch (error: any) {
      return reply.code(400).send({ message: `Failed to import .maFile: ${error.message}` });
    }
  });

  app.post<{
    Body: { accountName?: string; password?: string; guardCode?: string };
  }>('/api/accounts/enroll/start', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      await guardWriteByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    const accountName = request.body.accountName?.trim();
    const password = request.body.password;
    const guardCode = request.body.guardCode?.trim();

    if (!accountName || !password) {
      return reply.code(400).send({ message: 'accountName and password are required' });
    }

    try {
      const started = await startSteamEnrollment({
        userId: request.user.id,
        accountName,
        password,
        guardCode
      });

      await execute(
        "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'steam_enroll_started', 'accountName', ?, 'steamid', ?))",
        [request.user.id, started.accountName, started.steamid]
      );

      return {
        ...started,
        message: 'Activation code sent by Steam (email/SMS). Enter it to finish setup.'
      };
    } catch (error: any) {
      if (error instanceof SteamEnrollmentError) {
        if (error.code === 'STEAM_GUARD_REQUIRED') {
          return reply.code(428).send({
            code: error.code,
            guardType: error.guardType,
            guardDomain: error.guardDomain ?? null,
            message: error.message
          });
        }

        if (error.code === 'STEAM_GUARD_INVALID') {
          return reply.code(400).send({
            code: error.code,
            message: error.message
          });
        }

        if (error.code === 'STEAM_PHONE_NOT_VERIFIED') {
          return reply.code(409).send({
            code: error.code,
            message: error.message,
            details: error.details ?? null
          });
        }

        if (error.code === 'STEAM_2FA_ALREADY_ENABLED') {
          return reply.code(409).send({
            code: error.code,
            message: error.message,
            details: error.details ?? null
          });
        }

        if (error.code === 'STEAM_ENROLL_STATUS') {
          return reply.code(409).send({
            code: error.code,
            status: error.status ?? null,
            message: error.message,
            details: error.details ?? null
          });
        }
      }

      return reply.code(400).send({ message: error.message || 'Failed to start Steam enrollment' });
    }
  });

  app.post<{
    Body: { pendingId?: string; activationCode?: string; alias?: string };
  }>('/api/accounts/enroll/finish', { preHandler: app.authenticate }, async (request, reply) => {
    const pendingId = request.body.pendingId?.trim();
    const activationCode = request.body.activationCode?.trim();
    const aliasInput = request.body.alias?.trim();

    if (!pendingId || !activationCode) {
      return reply.code(400).send({ message: 'pendingId and activationCode are required' });
    }

    const user = await getUserSecret(request.user.id);

    try {
      const finalized = await finishSteamEnrollment({
        userId: request.user.id,
        pendingId,
        activationCode
      });

      const alias = aliasInput || finalized.accountName;
      const encryptedMa = encryptForUser(JSON.stringify(finalized.ma), user.password_hash, user.id);
      const encryptedRecoveryCode = finalized.revocationCode
        ? encryptForUser(finalized.revocationCode, user.password_hash, user.id)
        : null;

      const insertResult = await execute(
        `INSERT INTO user_accounts
          (user_id, alias, account_name, steamid, encrypted_ma, encrypted_revocation_code, source)
         VALUES (?, ?, ?, ?, ?, ?, 'credentials')`,
        [
          user.id,
          alias,
          finalized.accountName,
          finalized.steamid,
          encryptedMa,
          encryptedRecoveryCode
        ]
      );

      const accountId = Number(insertResult.insertId);

      if (finalized.session) {
        const encryptedSession = encodeAccountSession(finalized.session, user.password_hash, user.id);
        await execute(
          `INSERT INTO account_sessions (account_id, session_json)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE session_json = VALUES(session_json)`,
          [accountId, encryptedSession]
        );
      }

      await execute(
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'system', JSON_OBJECT('event', 'steam_enroll_completed', 'steamid', ?, 'accountName', ?))",
        [request.user.id, accountId, finalized.steamid, finalized.accountName]
      );

      return {
        id: accountId,
        alias,
        accountName: finalized.accountName,
        steamid: finalized.steamid,
        source: 'credentials',
        hasRecoveryCode: Boolean(finalized.revocationCode),
        recoveryCode: finalized.revocationCode
      };
    } catch (error: any) {
      return reply.code(400).send({ message: error.message || 'Failed to finish Steam enrollment' });
    }
  });

  app.patch<{
    Params: { accountId: string };
    Body: {
      alias?: string;
      autoConfirm?: boolean;
      autoConfirmTrades?: boolean;
      autoConfirmLogins?: boolean;
      autoConfirmDelaySec?: number;
    };
  }>('/api/accounts/:accountId', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = Number(request.params.accountId);

    try {
      await getAccountByOwner(request.user.id, accountId);
    } catch (error: any) {
      return reply.code(404).send({ message: error.message });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (typeof request.body.alias === 'string' && request.body.alias.trim().length > 0) {
      updates.push('alias = ?');
      values.push(request.body.alias.trim());
    }

    if (typeof request.body.autoConfirm === 'boolean') {
      updates.push('auto_confirm = ?', 'auto_confirm_trades = ?');
      const enabled = request.body.autoConfirm ? 1 : 0;
      values.push(enabled, enabled);
    }

    if (typeof request.body.autoConfirmTrades === 'boolean') {
      updates.push('auto_confirm_trades = ?');
      values.push(request.body.autoConfirmTrades ? 1 : 0);
    }

    if (typeof request.body.autoConfirmLogins === 'boolean') {
      updates.push('auto_confirm_logins = ?');
      values.push(request.body.autoConfirmLogins ? 1 : 0);
    }

    if (typeof request.body.autoConfirmDelaySec === 'number') {
      const normalized = Math.min(60, Math.max(0, Math.floor(request.body.autoConfirmDelaySec)));
      updates.push('auto_confirm_delay_sec = ?');
      values.push(normalized);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ message: 'No fields to update' });
    }

    values.push(accountId, request.user.id);

    await execute(
      `UPDATE user_accounts
       SET ${updates.join(', ')}
       WHERE id = ? AND user_id = ?`,
      values
    );

    return { success: true };
  });

  app.post<{
    Params: { accountId: string };
    Body: { steamLoginSecure?: string; sessionid?: string; oauthToken?: string; steamid?: string };
  }>('/api/accounts/:accountId/session', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = Number(request.params.accountId);
    const user = await getUserSecret(request.user.id);

    try {
      await getAccountByOwner(request.user.id, accountId);
    } catch (error: any) {
      return reply.code(404).send({ message: error.message });
    }

    const session = {
      steamid: request.body.steamid,
      steamLoginSecure: request.body.steamLoginSecure,
      sessionid: request.body.sessionid,
      oauthToken: request.body.oauthToken
    };

    await execute(
      `INSERT INTO account_sessions (account_id, session_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE session_json = VALUES(session_json)`,
      [accountId, encodeAccountSession(session, user.password_hash, user.id)]
    );

    await execute(
      "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'system', JSON_OBJECT('event', 'session_updated'))",
      [request.user.id, accountId]
    );

    return { success: true };
  });

  app.get<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId/code',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      try {
        const account = await getAccountByOwner(request.user.id, accountId);
        const user = await getUserSecret(request.user.id);
        const ma = parseMaFile(decryptForUser(account.encrypted_ma, user.password_hash, user.id));
        const code = generateSteamCode(ma.shared_secret);

        await execute(
          `UPDATE user_accounts
           SET last_code = ?, last_active = UTC_TIMESTAMP()
           WHERE id = ?`,
          [code, accountId]
        );

        await execute(
          "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'code', JSON_OBJECT('source', 'api'))",
          [request.user.id, accountId]
        );

        return { code, generatedAt: new Date().toISOString() };
      } catch (error: any) {
        return reply.code(400).send({ message: error.message });
      }
    }
  );

  app.get<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId/export',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      try {
        const account = await getAccountByOwner(request.user.id, accountId);
        const user = await getUserSecret(request.user.id);

        const decrypted = decryptForUser(account.encrypted_ma, user.password_hash, user.id);

        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', `attachment; filename="${account.alias}.maFile"`);
        return reply.send(decrypted);
      } catch (error: any) {
        return reply.code(400).send({ message: error.message });
      }
    }
  );

  app.get<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId/recovery-code',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      try {
        const account = await getAccountByOwner(request.user.id, accountId);
        if (!account.encrypted_revocation_code) {
          return reply.code(404).send({ message: 'Recovery code is not available for this account' });
        }

        const user = await getUserSecret(request.user.id);
        const recoveryCode = decryptForUser(
          account.encrypted_revocation_code,
          user.password_hash,
          user.id
        );

        return { recoveryCode };
      } catch (error: any) {
        return reply.code(400).send({ message: error.message });
      }
    }
  );

  app.delete<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      try {
        await getAccountByOwner(request.user.id, accountId);
      } catch (error: any) {
        return reply.code(404).send({ message: error.message });
      }

      await execute('DELETE FROM user_accounts WHERE id = ? AND user_id = ?', [accountId, request.user.id]);

      await execute(
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'system', JSON_OBJECT('event', 'account_deleted'))",
        [request.user.id, accountId]
      );

      return { success: true };
    }
  );
};

export default accountRoutes;
