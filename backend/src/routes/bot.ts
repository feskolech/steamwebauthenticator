import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env';
import { execute, queryRows } from '../db/pool';
import { decryptForUser } from '../utils/crypto';
import { parseMaFile } from '../utils/mafile';
import { generateSteamCode, respondToConfirmation } from '../services/steamService';
import { wsHub } from '../services/wsHub';

async function botAuth(request: any, reply: any): Promise<void> {
  const token = request.headers['x-telegram-bot-token'];
  if (!env.TELEGRAM_BOT_TOKEN || token !== env.TELEGRAM_BOT_TOKEN) {
    reply.code(401).send({ message: 'Invalid bot token' });
  }
}

const botRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { code: string; telegramUserId: string; username?: string };
  }>('/api/telegram/bot/link', { preHandler: botAuth }, async (request, reply) => {
    const { code, telegramUserId, username } = request.body;

    const links = await queryRows<{ id: number; user_id: number }[]>(
      `SELECT id, user_id
       FROM telegram_link_codes
       WHERE code = ?
         AND purpose = 'link'
         AND used_at IS NULL
         AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [code]
    );

    const link = links[0];
    if (!link) {
      return reply.code(404).send({ message: 'Code is invalid or expired' });
    }

    await execute(
      'UPDATE users SET telegram_user_id = ?, telegram_username = ? WHERE id = ?',
      [telegramUserId, username ?? null, link.user_id]
    );

    await execute('UPDATE telegram_link_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [link.id]);

    return { success: true, userId: link.user_id };
  });

  app.post<{
    Body: { code: string; telegramUserId: string; username?: string };
  }>('/api/telegram/bot/oauth', { preHandler: botAuth }, async (request, reply) => {
    const { code, telegramUserId, username } = request.body;

    const result = await execute(
      `UPDATE telegram_oauth_codes
       SET approved = TRUE,
           telegram_user_id = ?,
           telegram_username = ?
       WHERE code = ?
         AND expires_at > UTC_TIMESTAMP()`,
      [telegramUserId, username ?? null, code]
    );

    if (result.affectedRows === 0) {
      return reply.code(404).send({ message: 'Code not found or expired' });
    }

    return { success: true };
  });

  app.get<{ Params: { telegramUserId: string } }>(
    '/api/telegram/bot/accounts/:telegramUserId',
    { preHandler: botAuth },
    async (request, reply) => {
      const users = await queryRows<{ id: number }[]>(
        'SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1',
        [request.params.telegramUserId]
      );

      const user = users[0];
      if (!user) {
        return reply.code(404).send({ message: 'No linked user for telegram id' });
      }

      const accounts = await queryRows<any[]>(
        'SELECT id, alias, account_name, steamid, last_code FROM user_accounts WHERE user_id = ? ORDER BY alias',
        [user.id]
      );

      return { items: accounts };
    }
  );

  app.get<{ Params: { telegramUserId: string } }>(
    '/api/telegram/bot/codes/:telegramUserId',
    { preHandler: botAuth },
    async (request, reply) => {
      const users = await queryRows<{ id: number; password_hash: string }[]>(
        'SELECT id, password_hash FROM users WHERE telegram_user_id = ? LIMIT 1',
        [request.params.telegramUserId]
      );

      const user = users[0];
      if (!user) {
        return reply.code(404).send({ message: 'No linked user for telegram id' });
      }

      const accounts = await queryRows<any[]>(
        'SELECT id, alias, encrypted_ma FROM user_accounts WHERE user_id = ?',
        [user.id]
      );

      const items = accounts.map((account) => {
        const ma = parseMaFile(decryptForUser(account.encrypted_ma, user.password_hash, user.id));
        return {
          accountId: account.id,
          alias: account.alias,
          code: generateSteamCode(ma.shared_secret)
        };
      });

      return { items };
    }
  );

  app.get<{ Params: { telegramUserId: string } }>(
    '/api/telegram/bot/confirms/:telegramUserId',
    { preHandler: botAuth },
    async (request, reply) => {
      const users = await queryRows<{ id: number }[]>(
        'SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1',
        [request.params.telegramUserId]
      );

      const user = users[0];
      if (!user) {
        return reply.code(404).send({ message: 'No linked user for telegram id' });
      }

      const items = await queryRows<any[]>(
        `SELECT c.account_id, a.alias, c.confirmation_id, c.nonce, c.kind, c.headline, c.summary, c.status
         FROM confirmations_cache c
         JOIN user_accounts a ON a.id = c.account_id
         WHERE a.user_id = ? AND c.status = 'pending'
         ORDER BY c.updated_at DESC
         LIMIT 100`,
        [user.id]
      );

      return { items };
    }
  );

  app.post<{
    Body: {
      telegramUserId: string;
      accountId: number;
      confirmationId: string;
      nonce?: string;
    };
  }>('/api/telegram/bot/confirm', { preHandler: botAuth }, async (request, reply) => {
    const users = await queryRows<{ id: number; password_hash: string }[]>(
      'SELECT id, password_hash FROM users WHERE telegram_user_id = ? LIMIT 1',
      [request.body.telegramUserId]
    );

    const user = users[0];
    if (!user) {
      return reply.code(404).send({ message: 'No linked user for telegram id' });
    }

    const accounts = await queryRows<any[]>(
      'SELECT id, encrypted_ma FROM user_accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [request.body.accountId, user.id]
    );

    const account = accounts[0];
    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const ma = parseMaFile(decryptForUser(account.encrypted_ma, user.password_hash, user.id));

    const sessionRows = await queryRows<{ session_json: string }[]>(
      'SELECT session_json FROM account_sessions WHERE account_id = ? LIMIT 1',
      [request.body.accountId]
    );

    const session = sessionRows[0] ? JSON.parse(sessionRows[0].session_json) : null;

    let nonce = request.body.nonce;
    if (!nonce) {
      const cacheRows = await queryRows<{ nonce: string }[]>(
        'SELECT nonce FROM confirmations_cache WHERE account_id = ? AND confirmation_id = ? LIMIT 1',
        [request.body.accountId, request.body.confirmationId]
      );
      nonce = cacheRows[0]?.nonce;
    }

    if (!nonce) {
      return reply.code(400).send({ message: 'Nonce missing' });
    }

    const success = await respondToConfirmation({
      ma,
      session,
      confirmationId: request.body.confirmationId,
      nonce,
      accept: true
    });

    if (!success) {
      return reply.code(400).send({ message: 'Steam confirmation failed' });
    }

    await execute(
      "UPDATE confirmations_cache SET status = 'confirmed', updated_at = UTC_TIMESTAMP() WHERE account_id = ? AND confirmation_id = ?",
      [request.body.accountId, request.body.confirmationId]
    );

    return { success: true };
  });

  app.post<{
    Body: {
      telegramUserId: string;
      cacheId: number;
      accept: boolean;
    };
  }>('/api/telegram/bot/respond', { preHandler: botAuth }, async (request, reply) => {
    const users = await queryRows<{ id: number; password_hash: string }[]>(
      'SELECT id, password_hash FROM users WHERE telegram_user_id = ? LIMIT 1',
      [request.body.telegramUserId]
    );

    const user = users[0];
    if (!user) {
      return reply.code(404).send({ message: 'No linked user for telegram id' });
    }

    const rows = await queryRows<
      {
        account_id: number;
        confirmation_id: string;
        nonce: string | null;
        kind: string;
        encrypted_ma: string;
        status: string;
      }[]
    >(
      `SELECT c.account_id, c.confirmation_id, c.nonce, c.kind, c.status, a.encrypted_ma
       FROM confirmations_cache c
       JOIN user_accounts a ON a.id = c.account_id
       WHERE c.id = ?
         AND a.user_id = ?
       LIMIT 1`,
      [request.body.cacheId, user.id]
    );

    const item = rows[0];
    if (!item) {
      return reply.code(404).send({ message: 'Confirmation not found' });
    }

    if (item.status !== 'pending') {
      return reply.code(409).send({ message: `Confirmation already ${item.status}` });
    }

    const ma = parseMaFile(decryptForUser(item.encrypted_ma, user.password_hash, user.id));

    const sessionRows = await queryRows<{ session_json: string }[]>(
      'SELECT session_json FROM account_sessions WHERE account_id = ? LIMIT 1',
      [item.account_id]
    );
    const session = sessionRows[0] ? JSON.parse(sessionRows[0].session_json) : null;

    const nonce = item.nonce;
    if (!nonce) {
      return reply.code(400).send({ message: 'Nonce missing' });
    }

    const success = await respondToConfirmation({
      ma,
      session,
      confirmationId: item.confirmation_id,
      nonce,
      accept: request.body.accept
    });

    if (!success) {
      return reply.code(400).send({ message: 'Steam confirmation failed' });
    }

    const nextStatus = request.body.accept ? 'confirmed' : 'rejected';
    await execute(
      'UPDATE confirmations_cache SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [nextStatus, request.body.cacheId]
    );

    if (item.kind === 'trade' || item.kind === 'login') {
      await execute(
        `INSERT INTO logs (user_id, account_id, type, details)
         VALUES (?, ?, ?, JSON_OBJECT('confirmationId', ?, 'action', ?, 'source', 'telegram_inline'))`,
        [user.id, item.account_id, item.kind, item.confirmation_id, request.body.accept ? 'confirm' : 'reject']
      );

      wsHub.sendToUser(user.id, `${item.kind}:${request.body.accept ? 'confirmed' : 'rejected'}`, {
        accountId: item.account_id,
        confirmationId: item.confirmation_id
      });
    }

    return {
      success: true,
      kind: item.kind,
      accountId: item.account_id,
      confirmationId: item.confirmation_id,
      status: nextStatus
    };
  });
};

export default botRoutes;
