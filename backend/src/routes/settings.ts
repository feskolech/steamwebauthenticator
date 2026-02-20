import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';
import { createOpaqueCode, hashApiKey } from '../utils/crypto';

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings', { preHandler: app.authenticate }, async (request) => {
    const users = await queryRows<any[]>(
      `SELECT language, theme, steam_userid, twofa_method, telegram_user_id, telegram_username,
              telegram_notify_login_codes, api_key_last4
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [request.user.id]
    );

    const user = users[0];

    return {
      language: user?.language ?? 'en',
      theme: user?.theme ?? 'light',
      steamUserId: user?.steam_userid ?? null,
      twofaMethod: user?.twofa_method ?? 'none',
      telegramLinked: Boolean(user?.telegram_user_id),
      telegramUsername: user?.telegram_username ?? null,
      telegramNotifyLoginCodes: Boolean(user?.telegram_notify_login_codes),
      apiKeyLast4: user?.api_key_last4 ?? null
    };
  });

  app.patch<{
    Body: {
      language?: 'en' | 'ru';
      theme?: 'light' | 'dark';
      steamUserId?: string | null;
      twofaMethod?: 'none' | 'telegram' | 'webauthn';
      telegramNotifyLoginCodes?: boolean;
    };
  }>('/api/settings', { preHandler: app.authenticate }, async (request, reply) => {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (request.body.language) {
      if (!['en', 'ru'].includes(request.body.language)) {
        return reply.code(400).send({ message: 'Invalid language' });
      }
      updates.push('language = ?');
      values.push(request.body.language);
    }

    if (request.body.theme) {
      if (!['light', 'dark'].includes(request.body.theme)) {
        return reply.code(400).send({ message: 'Invalid theme' });
      }
      updates.push('theme = ?');
      values.push(request.body.theme);
    }

    if (request.body.steamUserId !== undefined) {
      updates.push('steam_userid = ?');
      values.push(request.body.steamUserId || null);
    }

    if (request.body.twofaMethod) {
      const users = await queryRows<{ telegram_user_id: string | null }[]>(
        'SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1',
        [request.user.id]
      );
      const telegramLinked = Boolean(users[0]?.telegram_user_id);

      if (request.body.twofaMethod === 'telegram' && !telegramLinked) {
        return reply.code(400).send({ message: 'Link Telegram first' });
      }

      updates.push('twofa_method = ?');
      values.push(request.body.twofaMethod);
    }

    if (typeof request.body.telegramNotifyLoginCodes === 'boolean') {
      const users = await queryRows<{ telegram_user_id: string | null }[]>(
        'SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1',
        [request.user.id]
      );
      const telegramLinked = Boolean(users[0]?.telegram_user_id);

      if (request.body.telegramNotifyLoginCodes && !telegramLinked) {
        return reply.code(400).send({ message: 'Link Telegram first' });
      }

      updates.push('telegram_notify_login_codes = ?');
      values.push(request.body.telegramNotifyLoginCodes ? 1 : 0);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ message: 'No fields to update' });
    }

    values.push(request.user.id);

    await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'settings_updated'))",
      [request.user.id]
    );

    return { success: true };
  });

  app.post('/api/settings/telegram/link-code', { preHandler: app.authenticate }, async (request) => {
    const code = createOpaqueCode(4).toUpperCase();

    await execute(
      `INSERT INTO telegram_link_codes (user_id, code, purpose, expires_at)
       VALUES (?, ?, 'link', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))`,
      [request.user.id, code]
    );

    return {
      code,
      command: `/add=${code}`,
      expiresInSec: 900
    };
  });

  app.delete('/api/settings/telegram', { preHandler: app.authenticate }, async (request) => {
    await execute(
      `UPDATE users
       SET telegram_user_id = NULL,
           telegram_username = NULL,
           telegram_notify_login_codes = FALSE,
           twofa_method = CASE WHEN twofa_method = 'telegram' THEN 'none' ELSE twofa_method END
       WHERE id = ?`,
      [request.user.id]
    );

    return { success: true };
  });

  app.post('/api/settings/api-key', { preHandler: app.authenticate }, async (request) => {
    const rawKey = createOpaqueCode(24);
    const hash = hashApiKey(rawKey);

    await execute('UPDATE users SET api_key_hash = ?, api_key_last4 = ? WHERE id = ?', [
      hash,
      rawKey.slice(-4),
      request.user.id
    ]);

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'api_key_regenerated'))",
      [request.user.id]
    );

    return { apiKey: rawKey };
  });
};

export default settingsRoutes;
