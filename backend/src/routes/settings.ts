import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';
import { createOpaqueCode, decryptForUser, encryptForUser, hashApiKey } from '../utils/crypto';
import { requireSensitiveAuth } from '../utils/sensitiveAuth';
import {
  createUserWebhook,
  deleteUserWebhook,
  listUserWebhooks,
  testUserWebhook,
  type WebhookTargetType
} from '../services/webhookService';
import { getUserById } from '../services/userService';
import { buildTotpSetup, verifyTotpCode } from '../services/totpService';
import { generateRecoveryCodes, hashRecoveryCode } from '../services/recoveryCodeService';

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings', { preHandler: app.authenticate }, async (request) => {
    const [users, recoveryCodeRows, passkeyRows] = await Promise.all([
      queryRows<any[]>(
        `SELECT language, theme, twofa_method, encrypted_totp_secret, telegram_user_id, telegram_username,
               telegram_notify_login_codes, api_key_last4
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [request.user.id]
      ),
      queryRows<{ total: number }[]>(
        `SELECT COUNT(*) AS total
         FROM user_recovery_codes
         WHERE user_id = ? AND used_at IS NULL`,
        [request.user.id]
      ),
      queryRows<{ total: number }[]>(
        `SELECT COUNT(*) AS total
         FROM user_passkeys
         WHERE user_id = ?`,
        [request.user.id]
      )
    ]);

    const user = users[0];

    return {
      language: user?.language ?? 'en',
      theme: user?.theme ?? 'light',
      twofaMethod: user?.twofa_method ?? 'none',
      hasTotpSecret: Boolean(user?.encrypted_totp_secret),
      hasPasskeys: Number(passkeyRows[0]?.total ?? 0) > 0,
      hasRecoveryCodes: Number(recoveryCodeRows[0]?.total ?? 0) > 0,
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
      twofaMethod?: 'none' | 'telegram' | 'webauthn' | 'totp';
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

    if (request.body.twofaMethod) {
      const [users, passkeyRows] = await Promise.all([
        queryRows<{ telegram_user_id: string | null; encrypted_totp_secret: string | null }[]>(
          'SELECT telegram_user_id, encrypted_totp_secret FROM users WHERE id = ? LIMIT 1',
          [request.user.id]
        ),
        queryRows<{ total: number }[]>(
          'SELECT COUNT(*) AS total FROM user_passkeys WHERE user_id = ?',
          [request.user.id]
        )
      ]);
      const telegramLinked = Boolean(users[0]?.telegram_user_id);
      const hasTotpSecret = Boolean(users[0]?.encrypted_totp_secret);
      const hasPasskeys = Number(passkeyRows[0]?.total ?? 0) > 0;

      if (request.body.twofaMethod === 'telegram' && !telegramLinked) {
        return reply.code(400).send({ message: 'Link Telegram first' });
      }

      if (request.body.twofaMethod === 'totp' && !hasTotpSecret) {
        return reply.code(400).send({ message: 'Set up TOTP first' });
      }

      if (request.body.twofaMethod === 'webauthn' && !hasPasskeys) {
        return reply.code(400).send({ message: 'Register a passkey first' });
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

  app.post('/api/settings/totp/setup', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await getUserById(request.user.id);
    if (!user) {
      return reply.code(404).send({ message: 'User not found' });
    }

    const setup = await buildTotpSetup(user.email);
    const encryptedSecret = encryptForUser(setup.secret, user.password_hash, user.id);

    await execute(
      `INSERT INTO pending_totp_setups (user_id, encrypted_secret, expires_at)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))
       ON DUPLICATE KEY UPDATE encrypted_secret = VALUES(encrypted_secret), expires_at = VALUES(expires_at)`,
      [user.id, encryptedSecret]
    );

    return {
      secret: setup.secret,
      otpauthUrl: setup.otpauthUrl,
      qrCodeDataUrl: setup.qrCodeDataUrl,
      expiresInSec: 600
    };
  });

  app.post<{ Body: { code?: string } }>('/api/settings/totp/verify', { preHandler: app.authenticate }, async (request, reply) => {
    const code = request.body.code?.trim();
    if (!code) {
      return reply.code(400).send({ message: 'TOTP code is required' });
    }

    const user = await getUserById(request.user.id);
    if (!user) {
      return reply.code(404).send({ message: 'User not found' });
    }

    const pendingRows = await queryRows<{ encrypted_secret: string }[]>(
      `SELECT encrypted_secret
       FROM pending_totp_setups
       WHERE user_id = ? AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [user.id]
    );

    const pending = pendingRows[0];
    if (!pending) {
      return reply.code(400).send({ message: 'TOTP setup expired' });
    }

    const secret = decryptForUser(pending.encrypted_secret, user.password_hash, user.id);
    if (!verifyTotpCode(secret, code)) {
      return reply.code(400).send({ message: 'Invalid TOTP code' });
    }

    await execute('UPDATE users SET encrypted_totp_secret = ?, twofa_method = ? WHERE id = ?', [
      pending.encrypted_secret,
      'totp',
      user.id
    ]);
    await execute('DELETE FROM pending_totp_setups WHERE user_id = ?', [user.id]);
    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'totp_enabled'))",
      [user.id]
    );

    return { success: true };
  });

  app.post('/api/settings/recovery-codes/regenerate', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireSensitiveAuth(request, reply)) {
      return;
    }

    const codes = generateRecoveryCodes(8);

    await execute('DELETE FROM user_recovery_codes WHERE user_id = ?', [request.user.id]);
    for (const code of codes) {
      await execute('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES (?, ?)', [
        request.user.id,
        hashRecoveryCode(code)
      ]);
    }

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'recovery_codes_regenerated'))",
      [request.user.id]
    );

    return { codes };
  });

  app.get('/api/settings/webhooks', { preHandler: app.authenticate }, async (request) => {
    return {
      items: await listUserWebhooks(request.user.id)
    };
  });

  app.post<{
    Body: { name?: string; url?: string; targetType?: WebhookTargetType; eventTypes?: string[] };
  }>('/api/settings/webhooks', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const webhook = await createUserWebhook(request.user.id, request.body ?? {});
      await execute(
        "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'webhook_created', 'targetType', ?, 'name', ?))",
        [request.user.id, webhook.targetType, webhook.name]
      );
      return { webhook };
    } catch (error: any) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.delete<{ Params: { webhookId: string } }>(
    '/api/settings/webhooks/:webhookId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const webhookId = Number(request.params.webhookId);
      if (!Number.isInteger(webhookId) || webhookId <= 0) {
        return reply.code(400).send({ message: 'Invalid webhook id' });
      }

      try {
        await deleteUserWebhook(request.user.id, webhookId);
        await execute(
          "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'webhook_deleted', 'webhookId', ?))",
          [request.user.id, webhookId]
        );
        return { success: true };
      } catch (error: any) {
        const statusCode = error.message === 'Webhook not found' ? 404 : 400;
        return reply.code(statusCode).send({ message: error.message });
      }
    }
  );

  app.post<{ Params: { webhookId: string } }>(
    '/api/settings/webhooks/:webhookId/test',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const webhookId = Number(request.params.webhookId);
      if (!Number.isInteger(webhookId) || webhookId <= 0) {
        return reply.code(400).send({ message: 'Invalid webhook id' });
      }

      try {
        await testUserWebhook(request.user.id, webhookId);
        await execute(
          "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'webhook_tested', 'webhookId', ?))",
          [request.user.id, webhookId]
        );
        return { success: true };
      } catch (error: any) {
        const statusCode = error.message === 'Webhook not found' ? 404 : 400;
        return reply.code(statusCode).send({ message: error.message });
      }
    }
  );

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
