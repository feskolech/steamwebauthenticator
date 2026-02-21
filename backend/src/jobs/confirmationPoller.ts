import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { execute, queryRows } from '../db/pool';
import { decryptForUser } from '../utils/crypto';
import { decodeAccountSession } from '../utils/accountSession';
import { parseMaFile } from '../utils/mafile';
import { generateSteamCode, listConfirmations, respondToConfirmation } from '../services/steamService';
import { wsHub } from '../services/wsHub';
import { sendTelegramMessage } from '../services/telegramService';

let timer: NodeJS.Timeout | null = null;
let running = false;
const sessionExpiredNotifiedAt = new Map<number, number>();
const STALE_PENDING_RECONCILE_MINUTES = 2;
const STALE_PENDING_TTL_MINUTES = 30;

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

async function runCycle(app: FastifyInstance): Promise<void> {
  if (running) {
    return;
  }

  running = true;

  try {
    const accounts = await queryRows<any[]>(
      `SELECT a.id, a.user_id, a.alias, a.encrypted_ma, a.auto_confirm_trades, a.auto_confirm_logins, a.auto_confirm_delay_sec,
              u.password_hash, u.telegram_user_id, u.telegram_notify_login_codes
       FROM user_accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.auto_confirm_trades = TRUE OR a.auto_confirm_logins = TRUE OR u.telegram_user_id IS NOT NULL`
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

        const session = sessions[0]
          ? decodeAccountSession(sessions[0].session_json, account.password_hash, Number(account.user_id))
          : null;
        const confirmations = await listConfirmations(ma, session);
        const byKind: Record<'trade' | 'login' | 'other', Set<string>> = {
          trade: new Set(),
          login: new Set(),
          other: new Set()
        };

        for (const confirmation of confirmations) {
          const kind = confirmation.type === 'trade' ? 'trade' : confirmation.type === 'login' ? 'login' : 'other';
          byKind[kind].add(confirmation.id);

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
              if (kind === 'login' && account.telegram_notify_login_codes) {
                const steamid = ma.steamid ?? ma.Session?.SteamID ?? 'unknown';
                await sendLoginCodeAlert({
                  telegramUserId: account.telegram_user_id,
                  cacheId: Number(inserted.insertId),
                  alias: account.alias,
                  steamid,
                  confirmationId: confirmation.id,
                  headline: confirmation.headline,
                  summary: confirmation.summary,
                  sharedSecret: ma.shared_secret
                });
              } else {
                await sendTelegramMessage(
                  account.telegram_user_id,
                  `New ${kind} confirmation for ${account.alias}: ${confirmation.headline}`,
                  kind === 'login'
                    ? {
                        inlineKeyboard: [
                          [
                            { text: 'Впустить', callbackData: `sgl:a:${Number(inserted.insertId)}` },
                            { text: 'Не впускать', callbackData: `sgl:r:${Number(inserted.insertId)}` }
                          ]
                        ]
                      }
                    : undefined
                );
              }
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

          const canAutoConfirm =
            (kind === 'trade' && Boolean(account.auto_confirm_trades)) ||
            (kind === 'login' && Boolean(account.auto_confirm_logins));

          if (canAutoConfirm && (kind === 'trade' || kind === 'login')) {
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
              "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, ?, JSON_OBJECT('confirmationId', ?, 'action', 'auto_confirm'))",
              [account.user_id, account.id, kind, confirmation.id]
            );

            wsHub.sendToUser(Number(account.user_id), `${kind}:auto_confirmed`, {
              accountId: account.id,
              confirmationId: confirmation.id
            });
          }
        }

        await expireStalePendingByKind(account.id, 'trade', [...byKind.trade]);
        await expireStalePendingByKind(account.id, 'login', [...byKind.login]);
        await expireStalePendingByKind(account.id, 'other', [...byKind.other]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.toLowerCase().includes('steam session expired')) {
          const now = Date.now();
          const last = sessionExpiredNotifiedAt.get(Number(account.id)) ?? 0;
          if (now - last > 15 * 60 * 1000) {
            sessionExpiredNotifiedAt.set(Number(account.id), now);
            const payload = {
              accountId: account.id,
              accountAlias: account.alias,
              message: 'Steam session expired. Open account details and update session.'
            };

            await execute(
              `INSERT INTO notifications (user_id, channel, type, payload)
               VALUES (?, 'web', 'steam_session_expired', CAST(? AS JSON))`,
              [account.user_id, JSON.stringify(payload)]
            );

            await execute(
              "INSERT INTO logs (user_id, account_id, type, details) VALUES (?, ?, 'system', JSON_OBJECT('event', 'session_expired'))",
              [account.user_id, account.id]
            );
          }
        }

        app.log.warn(
          {
            accountId: account.id,
            accountAlias: account.alias,
            errorMessage,
            errorStack: error instanceof Error ? error.stack : undefined
          },
          'Failed steam polling for account'
        );
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
