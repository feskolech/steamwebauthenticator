import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';
import { decryptForUser } from '../utils/crypto';
import { parseMaFile, type SteamSessionState } from '../utils/mafile';
import { listConfirmations, respondToConfirmation } from '../services/steamService';
import { wsHub } from '../services/wsHub';

type AccountBundle = {
  id: number;
  user_id: number;
  alias: string;
  encrypted_ma: string;
  password_hash: string;
  telegram_user_id: string | null;
};

async function getAccountBundle(userId: number, accountId: number): Promise<AccountBundle> {
  const rows = await queryRows<AccountBundle[]>(
    `SELECT a.id, a.user_id, a.alias, a.encrypted_ma, u.password_hash, u.telegram_user_id
     FROM user_accounts a
     JOIN users u ON u.id = a.user_id
     WHERE a.id = ? AND a.user_id = ?
     LIMIT 1`,
    [accountId, userId]
  );

  const account = rows[0];
  if (!account) {
    throw new Error('Account not found');
  }

  return account;
}

async function getSession(accountId: number): Promise<SteamSessionState | null> {
  const rows = await queryRows<{ session_json: string }[]>(
    'SELECT session_json FROM account_sessions WHERE account_id = ? LIMIT 1',
    [accountId]
  );

  if (!rows[0]) {
    return null;
  }

  try {
    return JSON.parse(rows[0].session_json) as SteamSessionState;
  } catch {
    return null;
  }
}

const steamRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { accountId: string } }>(
    '/api/steamauth/:accountId/trades',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      try {
        const account = await getAccountBundle(request.user.id, accountId);
        const ma = parseMaFile(decryptForUser(account.encrypted_ma, account.password_hash, account.user_id));
        const session = await getSession(accountId);
        const confirmations = await listConfirmations(ma, session);

        const trades = confirmations.filter((c) => c.type === 'trade');

        for (const conf of trades) {
          const inserted = await execute(
            `INSERT IGNORE INTO confirmations_cache (account_id, confirmation_id, nonce, kind, headline, summary, status)
             VALUES (?, ?, ?, 'trade', ?, ?, 'pending')`,
            [accountId, conf.id, conf.nonce, conf.headline, conf.summary]
          );

          if (inserted.affectedRows === 0) {
            await execute(
              `UPDATE confirmations_cache
               SET nonce = ?, headline = ?, summary = ?, updated_at = UTC_TIMESTAMP()
               WHERE account_id = ? AND confirmation_id = ?`,
              [conf.nonce, conf.headline, conf.summary, accountId, conf.id]
            );
          } else {
            await execute(
              `INSERT INTO logs (user_id, account_id, type, details)
               VALUES (?, ?, 'trade', JSON_OBJECT('action', 'incoming', 'confirmationId', ?, 'headline', ?, 'summary', ?))`,
              [request.user.id, accountId, conf.id, conf.headline, conf.summary]
            );
            wsHub.sendToUser(request.user.id, 'trade:new', {
              accountId,
              confirmationId: conf.id,
              headline: conf.headline,
              summary: conf.summary
            });
          }
        }

        return { items: trades };
      } catch (error: any) {
        return reply.code(400).send({ message: error.message });
      }
    }
  );

  app.get<{ Params: { accountId: string } }>(
    '/api/steamauth/:accountId/logins',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      try {
        const account = await getAccountBundle(request.user.id, accountId);
        const ma = parseMaFile(decryptForUser(account.encrypted_ma, account.password_hash, account.user_id));
        const session = await getSession(accountId);
        const confirmations = await listConfirmations(ma, session);

        const loginConfirms = confirmations.filter((c) => c.type === 'login');

        for (const conf of loginConfirms) {
          const inserted = await execute(
            `INSERT IGNORE INTO confirmations_cache (account_id, confirmation_id, nonce, kind, headline, summary, status)
             VALUES (?, ?, ?, 'login', ?, ?, 'pending')`,
            [accountId, conf.id, conf.nonce, conf.headline, conf.summary]
          );

          if (inserted.affectedRows === 0) {
            await execute(
              `UPDATE confirmations_cache
               SET nonce = ?, headline = ?, summary = ?, updated_at = UTC_TIMESTAMP()
               WHERE account_id = ? AND confirmation_id = ?`,
              [conf.nonce, conf.headline, conf.summary, accountId, conf.id]
            );
          } else {
            await execute(
              `INSERT INTO logs (user_id, account_id, type, details)
               VALUES (?, ?, 'login', JSON_OBJECT('action', 'incoming', 'confirmationId', ?, 'headline', ?, 'summary', ?))`,
              [request.user.id, accountId, conf.id, conf.headline, conf.summary]
            );
            wsHub.sendToUser(request.user.id, 'login:new', {
              accountId,
              confirmationId: conf.id,
              headline: conf.headline,
              summary: conf.summary
            });
          }
        }

        return { items: loginConfirms };
      } catch (error: any) {
        return reply.code(400).send({ message: error.message });
      }
    }
  );

  app.post<{
    Params: { accountId: string; confirmationId: string };
    Body: { nonce?: string };
  }>('/api/steamauth/:accountId/trades/:confirmationId/confirm', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = Number(request.params.accountId);
    const confirmationId = request.params.confirmationId;

    try {
      const account = await getAccountBundle(request.user.id, accountId);
      const ma = parseMaFile(decryptForUser(account.encrypted_ma, account.password_hash, account.user_id));
      const session = await getSession(accountId);

      let nonce = request.body?.nonce;
      if (!nonce) {
        const rows = await queryRows<{ nonce: string }[]>(
          'SELECT nonce FROM confirmations_cache WHERE account_id = ? AND confirmation_id = ? LIMIT 1',
          [accountId, confirmationId]
        );
        nonce = rows[0]?.nonce;
      }

      if (!nonce) {
        return reply.code(400).send({ message: 'Nonce is required for confirmation' });
      }

      const success = await respondToConfirmation({
        ma,
        session,
        confirmationId,
        nonce,
        accept: true
      });

      if (!success) {
        return reply.code(400).send({ message: 'Steam rejected confirmation' });
      }

      await execute(
        `UPDATE confirmations_cache
         SET status = 'confirmed', updated_at = UTC_TIMESTAMP()
         WHERE account_id = ? AND confirmation_id = ?`,
        [accountId, confirmationId]
      );

      await execute(
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'trade', JSON_OBJECT('confirmationId', ?, 'action', 'confirm'))",
        [request.user.id, accountId, confirmationId]
      );

      wsHub.sendToUser(request.user.id, 'trade:confirmed', { accountId, confirmationId });
      return { success: true };
    } catch (error: any) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.post<{
    Params: { accountId: string; confirmationId: string };
    Body: { nonce?: string };
  }>('/api/steamauth/:accountId/trades/:confirmationId/reject', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = Number(request.params.accountId);
    const confirmationId = request.params.confirmationId;

    try {
      const account = await getAccountBundle(request.user.id, accountId);
      const ma = parseMaFile(decryptForUser(account.encrypted_ma, account.password_hash, account.user_id));
      const session = await getSession(accountId);

      let nonce = request.body?.nonce;
      if (!nonce) {
        const rows = await queryRows<{ nonce: string }[]>(
          'SELECT nonce FROM confirmations_cache WHERE account_id = ? AND confirmation_id = ? LIMIT 1',
          [accountId, confirmationId]
        );
        nonce = rows[0]?.nonce;
      }

      if (!nonce) {
        return reply.code(400).send({ message: 'Nonce is required for rejection' });
      }

      const success = await respondToConfirmation({
        ma,
        session,
        confirmationId,
        nonce,
        accept: false
      });

      if (!success) {
        return reply.code(400).send({ message: 'Steam rejected operation' });
      }

      await execute(
        `UPDATE confirmations_cache
         SET status = 'rejected', updated_at = UTC_TIMESTAMP()
         WHERE account_id = ? AND confirmation_id = ?`,
        [accountId, confirmationId]
      );

      await execute(
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'trade', JSON_OBJECT('confirmationId', ?, 'action', 'reject'))",
        [request.user.id, accountId, confirmationId]
      );

      wsHub.sendToUser(request.user.id, 'trade:rejected', { accountId, confirmationId });
      return { success: true };
    } catch (error: any) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.get<{ Params: { accountId: string } }>(
    '/api/steamauth/:accountId/queue',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.accountId);

      const ownership = await queryRows<{ id: number }[]>(
        'SELECT id FROM user_accounts WHERE id = ? AND user_id = ? LIMIT 1',
        [accountId, request.user.id]
      );

      if (!ownership[0]) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      const items = await queryRows<any[]>(
        `SELECT confirmation_id, nonce, kind, headline, summary, status, created_at, updated_at
         FROM confirmations_cache
         WHERE account_id = ?
         ORDER BY updated_at DESC
         LIMIT 200`,
        [accountId]
      );

      return { items };
    }
  );
};

export default steamRoutes;
