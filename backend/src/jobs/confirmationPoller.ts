import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { execute, queryRows } from '../db/pool';
import { decryptForUser } from '../utils/crypto';
import { parseMaFile } from '../utils/mafile';
import { listConfirmations, respondToConfirmation } from '../services/steamService';
import { wsHub } from '../services/wsHub';
import { sendTelegramMessage } from '../services/telegramService';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runCycle(app: FastifyInstance): Promise<void> {
  if (running) {
    return;
  }

  running = true;

  try {
    const accounts = await queryRows<any[]>(
      `SELECT a.id, a.user_id, a.alias, a.encrypted_ma, a.auto_confirm, a.auto_confirm_delay_sec,
              u.password_hash, u.telegram_user_id
       FROM user_accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.auto_confirm = TRUE OR u.telegram_user_id IS NOT NULL`
    );

    for (const account of accounts) {
      try {
        const ma = parseMaFile(
          decryptForUser(account.encrypted_ma, account.password_hash, Number(account.user_id))
        );

        const sessions = await queryRows<{ session_json: string }[]>(
          'SELECT session_json FROM account_sessions WHERE account_id = ? LIMIT 1',
          [account.id]
        );

        const session = sessions[0] ? JSON.parse(sessions[0].session_json) : null;
        const confirmations = await listConfirmations(ma, session);

        for (const confirmation of confirmations) {
          const kind = confirmation.type === 'trade' ? 'trade' : confirmation.type === 'login' ? 'login' : 'other';

          const inserted = await execute(
            `INSERT IGNORE INTO confirmations_cache (account_id, confirmation_id, nonce, kind, headline, summary, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [
              account.id,
              confirmation.id,
              confirmation.nonce,
              kind,
              confirmation.headline,
              confirmation.summary
            ]
          );

          if (inserted.affectedRows > 0) {
            const payload = {
              accountId: account.id,
              accountAlias: account.alias,
              confirmationId: confirmation.id,
              kind,
              headline: confirmation.headline,
              summary: confirmation.summary
            };

            wsHub.sendToUser(Number(account.user_id), 'confirmation:new', payload);

            await execute(
              `INSERT INTO notifications (user_id, channel, type, payload)
               VALUES (?, 'web', ?, CAST(? AS JSON))`,
              [
                account.user_id,
                kind,
                JSON.stringify(payload)
              ]
            );

            if (account.telegram_user_id) {
              await sendTelegramMessage(
                account.telegram_user_id,
                `New ${kind} confirmation for ${account.alias}: ${confirmation.headline}`
              );
            }

            if (kind === 'trade' || kind === 'login') {
              await execute(
                `INSERT INTO logs (user_id, account_id, type, details)
                 VALUES (?, ?, ?, JSON_OBJECT('action', 'incoming', 'confirmationId', ?, 'headline', ?, 'summary', ?))`,
                [
                  account.user_id,
                  account.id,
                  kind === 'trade' ? 'trade' : 'login',
                  confirmation.id,
                  confirmation.headline,
                  confirmation.summary
                ]
              );
            }
          }

          if (account.auto_confirm && kind === 'trade') {
            const cacheRows = await queryRows<{ id: number; created_at: Date; status: string; nonce: string }[]>(
              `SELECT id, created_at, status, nonce
               FROM confirmations_cache
               WHERE account_id = ? AND confirmation_id = ?
               LIMIT 1`,
              [account.id, confirmation.id]
            );

            const cache = cacheRows[0];
            if (!cache || cache.status !== 'pending') {
              continue;
            }

            const ageSec = (Date.now() - new Date(cache.created_at).getTime()) / 1000;
            const delaySec = Number(account.auto_confirm_delay_sec ?? 0);

            if (ageSec < delaySec) {
              continue;
            }

            const ok = await respondToConfirmation({
              ma,
              session,
              confirmationId: confirmation.id,
              nonce: cache.nonce || confirmation.nonce,
              accept: true
            });

            if (!ok) {
              continue;
            }

            await execute(
              `UPDATE confirmations_cache
               SET status = 'confirmed', updated_at = UTC_TIMESTAMP()
               WHERE id = ?`,
              [cache.id]
            );

            await execute(
              "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'trade', JSON_OBJECT('confirmationId', ?, 'action', 'auto_confirm'))",
              [account.user_id, account.id, confirmation.id]
            );

            wsHub.sendToUser(Number(account.user_id), 'trade:auto_confirmed', {
              accountId: account.id,
              confirmationId: confirmation.id
            });
          }
        }
      } catch (error) {
        app.log.warn({ error, accountId: account.id }, 'Failed steam polling for account');
      }
    }
  } finally {
    running = false;
  }
}

export function startConfirmationPoller(app: FastifyInstance): void {
  if (timer) {
    return;
  }

  const intervalMs = Math.max(5, env.STEAM_POLL_INTERVAL_SEC) * 1000;
  timer = setInterval(() => {
    void runCycle(app);
  }, intervalMs);

  void runCycle(app);
  app.log.info(`Steam confirmation poller started (${intervalMs}ms interval)`);
}

export function stopConfirmationPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
