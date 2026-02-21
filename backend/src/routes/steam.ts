import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';
import { decryptForUser } from '../utils/crypto';
import { parseMaFile, type SteamSessionState } from '../utils/mafile';
import { generateSteamCode, listConfirmations, respondToConfirmation } from '../services/steamService';
import { wsHub } from '../services/wsHub';
import { sendTelegramMessage } from '../services/telegramService';

type AccountBundle = {
  id: number;
  user_id: number;
  alias: string;
  encrypted_ma: string;
  password_hash: string;
  telegram_user_id: string | null;
  telegram_notify_login_codes: number;
};

const STALE_PENDING_RECONCILE_MINUTES = 2;
const STALE_PENDING_TTL_MINUTES = 30;

async function getAccountBundle(userId: number, accountId: number): Promise<AccountBundle> {
  const rows = await queryRows<AccountBundle[]>(
    `SELECT a.id, a.user_id, a.alias, a.encrypted_ma, u.password_hash, u.telegram_user_id, u.telegram_notify_login_codes
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

function resolveCodeTtlSec(nowSec: number): number {
  return 30 - (nowSec % 30) || 30;
}

function formatLoginAlertMessage(params: {
  alias: string;
  steamid: string;
  confirmationId: string;
  headline: string;
  summary: string;
  code: string;
  validForSec: number;
}): string {
  return [
    'Steam login confirmation requested',
    `Account: ${params.alias}`,
    `SteamID: ${params.steamid}`,
    `Confirmation ID: ${params.confirmationId}`,
    params.headline ? `Title: ${params.headline}` : '',
    params.summary ? `Details: ${params.summary}` : '',
    `Steam Guard code: ${params.code} (expires in ${params.validForSec}s)`
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendLoginCodeAlert(params: {
  telegramUserId: string | number;
  cacheId: number;
  alias: string;
  steamid: string;
  confirmationId: string;
  headline: string;
  summary: string;
  sharedSecret: string;
}): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = resolveCodeTtlSec(nowSec);
  const currentCode = generateSteamCode(params.sharedSecret);

  if (ttlSec < 15) {
    await sendTelegramMessage(
      params.telegramUserId,
      `${formatLoginAlertMessage({
        alias: params.alias,
        steamid: params.steamid,
        confirmationId: params.confirmationId,
        headline: params.headline,
        summary: params.summary,
        code: currentCode,
        validForSec: ttlSec
      })}\nNext code will be sent in ${ttlSec}s.`,
      {
        inlineKeyboard: [
          [
            { text: 'Впустить', callbackData: `sgl:a:${params.cacheId}` },
            { text: 'Не впускать', callbackData: `sgl:r:${params.cacheId}` }
          ]
        ]
      }
    );

    const timeout = setTimeout(() => {
      void sendTelegramMessage(
        params.telegramUserId,
        `Next Steam Guard code for ${params.alias}: ${generateSteamCode(params.sharedSecret)}`
      );
    }, (ttlSec + 1) * 1000);
    timeout.unref();
    return;
  }

  await sendTelegramMessage(
    params.telegramUserId,
    formatLoginAlertMessage({
      alias: params.alias,
      steamid: params.steamid,
      confirmationId: params.confirmationId,
      headline: params.headline,
      summary: params.summary,
      code: currentCode,
      validForSec: ttlSec
    }),
    {
      inlineKeyboard: [
        [
          { text: 'Впустить', callbackData: `sgl:a:${params.cacheId}` },
          { text: 'Не впускать', callbackData: `sgl:r:${params.cacheId}` }
        ]
      ]
    }
  );
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

async function expireStalePendingByKind(
  accountId: number,
  kind: 'trade' | 'login' | 'other',
  activeConfirmationIds: string[]
): Promise<void> {
  if (activeConfirmationIds.length === 0) {
    await execute(
      `UPDATE confirmations_cache
       SET status = 'expired', updated_at = UTC_TIMESTAMP()
       WHERE account_id = ?
         AND kind = ?
         AND status = 'pending'
         AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
      [accountId, kind, STALE_PENDING_TTL_MINUTES]
    );
    return;
  }

  const placeholders = activeConfirmationIds.map(() => '?').join(', ');
  await execute(
    `UPDATE confirmations_cache
     SET status = 'expired', updated_at = UTC_TIMESTAMP()
     WHERE account_id = ?
       AND kind = ?
       AND status = 'pending'
       AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
       AND confirmation_id NOT IN (${placeholders})`,
    [accountId, kind, STALE_PENDING_RECONCILE_MINUTES, ...activeConfirmationIds]
  );
}

async function expireOldPending(accountId: number): Promise<void> {
  await execute(
    `UPDATE confirmations_cache
     SET status = 'expired', updated_at = UTC_TIMESTAMP()
     WHERE account_id = ?
       AND status = 'pending'
       AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
    [accountId, STALE_PENDING_TTL_MINUTES]
  );
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
        const tradeIds = trades.map((item) => item.id);

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
              `INSERT INTO notifications (user_id, channel, type, payload)
               VALUES (?, 'web', 'trade', CAST(? AS JSON))`,
              [
                request.user.id,
                JSON.stringify({
                  accountId,
                  accountAlias: account.alias,
                  confirmationId: conf.id,
                  kind: 'trade',
                  headline: conf.headline,
                  summary: conf.summary
                })
              ]
            );

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

        await expireStalePendingByKind(accountId, 'trade', tradeIds);

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
        const loginIds = loginConfirms.map((item) => item.id);

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
              `INSERT INTO notifications (user_id, channel, type, payload)
               VALUES (?, 'web', 'login', CAST(? AS JSON))`,
              [
                request.user.id,
                JSON.stringify({
                  accountId,
                  accountAlias: account.alias,
                  confirmationId: conf.id,
                  kind: 'login',
                  headline: conf.headline,
                  summary: conf.summary
                })
              ]
            );

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

            if (account.telegram_user_id) {
              if (account.telegram_notify_login_codes) {
                await sendLoginCodeAlert({
                  telegramUserId: account.telegram_user_id,
                  cacheId: Number(inserted.insertId),
                  alias: account.alias,
                  steamid: ma.Session?.SteamID ?? ma.steamid ?? 'unknown',
                  confirmationId: conf.id,
                  headline: conf.headline,
                  summary: conf.summary,
                  sharedSecret: ma.shared_secret
                });
              } else {
                await sendTelegramMessage(
                  account.telegram_user_id,
                  `New login confirmation for ${account.alias}: ${conf.headline}`,
                  {
                    inlineKeyboard: [
                      [
                        { text: 'Впустить', callbackData: `sgl:a:${Number(inserted.insertId)}` },
                        { text: 'Не впускать', callbackData: `sgl:r:${Number(inserted.insertId)}` }
                      ]
                    ]
                  }
                );
              }
            }
          }
        }

        await expireStalePendingByKind(accountId, 'login', loginIds);

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

  app.post<{
    Params: { accountId: string; confirmationId: string };
    Body: { nonce?: string };
  }>('/api/steamauth/:accountId/logins/:confirmationId/confirm', { preHandler: app.authenticate }, async (request, reply) => {
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
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'login', JSON_OBJECT('confirmationId', ?, 'action', 'confirm'))",
        [request.user.id, accountId, confirmationId]
      );

      wsHub.sendToUser(request.user.id, 'login:confirmed', { accountId, confirmationId });
      return { success: true };
    } catch (error: any) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.post<{
    Params: { accountId: string; confirmationId: string };
    Body: { nonce?: string };
  }>('/api/steamauth/:accountId/logins/:confirmationId/reject', { preHandler: app.authenticate }, async (request, reply) => {
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
        "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'login', JSON_OBJECT('confirmationId', ?, 'action', 'reject'))",
        [request.user.id, accountId, confirmationId]
      );

      wsHub.sendToUser(request.user.id, 'login:rejected', { accountId, confirmationId });
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

      await expireOldPending(accountId);

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
