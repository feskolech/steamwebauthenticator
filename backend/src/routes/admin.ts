import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';

const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/overview', { preHandler: app.requireAdmin }, async () => {
    const [userCount] = await queryRows<{ total: number }[]>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'user'"
    );
    const [accountCount] = await queryRows<{ total: number }[]>(
      'SELECT COUNT(*) AS total FROM user_accounts'
    );

    return {
      users: userCount?.total ?? 0,
      accounts: accountCount?.total ?? 0
    };
  });

  app.get('/api/admin/settings', { preHandler: app.requireAdmin }, async () => {
    const settings = await queryRows<{ registration_enabled: number; updated_at: Date }[]>(
      'SELECT registration_enabled, updated_at FROM global_settings WHERE id = 1 LIMIT 1'
    );

    return {
      registrationEnabled: Boolean(settings[0]?.registration_enabled),
      updatedAt: settings[0]?.updated_at ?? null
    };
  });

  app.patch<{ Body: { registrationEnabled: boolean } }>(
    '/api/admin/settings',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      if (typeof request.body.registrationEnabled !== 'boolean') {
        return reply.code(400).send({ message: 'registrationEnabled must be boolean' });
      }

      await execute(
        'UPDATE global_settings SET registration_enabled = ?, updated_at = UTC_TIMESTAMP() WHERE id = 1',
        [request.body.registrationEnabled ? 1 : 0]
      );

      await execute(
        "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'registration_toggle', 'enabled', ?))",
        [request.user.id, request.body.registrationEnabled]
      );

      return { success: true };
    }
  );

  app.get<{ Querystring: { limit?: string } }>('/api/admin/users', { preHandler: app.requireAdmin }, async (request) => {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 100)));

    const users = await queryRows<any[]>(
      `SELECT id, email, role, language, theme, telegram_user_id, twofa_method, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit]
    );

    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        language: user.language,
        theme: user.theme,
        telegramLinked: Boolean(user.telegram_user_id),
        twofaMethod: user.twofa_method,
        createdAt: user.created_at
      }))
    };
  });
};

export default adminRoutes;
