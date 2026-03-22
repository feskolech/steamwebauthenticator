import type { FastifyPluginAsync } from 'fastify';
import { db, queryRows } from '../db/pool';
import { mapLogRow, parseScope, type LogRow, type LogViewItem } from '../services/logViewService';
import { normalizeDomainList, parseRegistrationMode, type RegistrationMode } from '../services/registrationPolicyService';
import { requireSensitiveAuth } from '../utils/sensitiveAuth';
import { createOpaqueCode } from '../utils/crypto';

function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

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
    const settings = await queryRows<
      { registration_enabled: number; registration_mode: string; allowed_email_domains: string | null; updated_at: Date }[]
    >(
      'SELECT registration_enabled, registration_mode, allowed_email_domains, updated_at FROM global_settings WHERE id = 1 LIMIT 1'
    );

    return {
      registrationEnabled: Boolean(settings[0]?.registration_enabled),
      registrationMode: parseRegistrationMode(settings[0]?.registration_mode),
      allowedEmailDomains: normalizeDomainList(settings[0]?.allowed_email_domains),
      updatedAt: settings[0]?.updated_at ?? null
    };
  });

  app.patch<{
    Body: { registrationEnabled: boolean; registrationMode?: RegistrationMode; allowedEmailDomains?: string[] };
  }>(
    '/api/admin/settings',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      if (typeof request.body.registrationEnabled !== 'boolean') {
        return reply.code(400).send({ message: 'registrationEnabled must be boolean' });
      }

      const registrationMode = parseRegistrationMode(request.body.registrationMode);
      if (request.body.registrationMode && registrationMode !== request.body.registrationMode) {
        return reply.code(400).send({ message: 'registrationMode is invalid' });
      }

      const allowedEmailDomains = normalizeDomainList(
        Array.isArray(request.body.allowedEmailDomains) ? request.body.allowedEmailDomains.join(',') : ''
      );

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          'UPDATE global_settings SET registration_enabled = ?, registration_mode = ?, allowed_email_domains = ?, updated_at = UTC_TIMESTAMP() WHERE id = 1',
          [request.body.registrationEnabled ? 1 : 0, registrationMode, allowedEmailDomains.join(',') || null]
        );

        await connection.execute(
          "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'registration_toggle', 'enabled', ?, 'mode', ?, 'allowedDomains', ?))",
          [request.user.id, request.body.registrationEnabled, registrationMode, allowedEmailDomains.join(',') || null]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

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

  app.get<{ Querystring: { limit?: string } }>('/api/admin/invites', { preHandler: app.requireAdmin }, async (request, reply) => {
    const parsedLimit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return reply.code(400).send({ message: 'Invalid limit' });
    }

    const invites = await queryRows<any[]>(
      `SELECT i.id, i.code, i.note, i.expires_at, i.used_at, i.created_at,
              creator.email AS created_by_email,
              used.email AS used_by_email
       FROM registration_invites i
       JOIN users creator ON creator.id = i.created_by_user_id
       LEFT JOIN users used ON used.id = i.used_by_user_id
       ORDER BY i.created_at DESC
       LIMIT ?`,
      [Math.min(200, parsedLimit)]
    );

    return {
      items: invites.map((invite) => ({
        id: invite.id,
        code: invite.code,
        note: invite.note,
        expiresAt: invite.expires_at,
        usedAt: invite.used_at,
        createdAt: invite.created_at,
        createdByEmail: invite.created_by_email,
        usedByEmail: invite.used_by_email
      }))
    };
  });

  app.post<{ Body: { note?: string; expiresInDays?: number } }>('/api/admin/invites', { preHandler: app.requireAdmin }, async (request, reply) => {
    const expiresInDays = Number(request.body.expiresInDays ?? 14);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
      return reply.code(400).send({ message: 'expiresInDays must be between 1 and 365' });
    }

    const note = String(request.body.note ?? '').trim() || null;
    const code = createOpaqueCode(6).toUpperCase();

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<any>(
        `INSERT INTO registration_invites (code, note, created_by_user_id, expires_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
        [code, note, request.user.id, expiresInDays]
      );

      await connection.execute(
        "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'invite_created', 'inviteId', ?, 'code', ?, 'expiresInDays', ?, 'note', ?))",
        [request.user.id, Number(result.insertId), code, expiresInDays, note]
      );
      await connection.commit();

      return {
        invite: {
          id: Number(result.insertId),
          code,
          note,
          expiresInDays
        }
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  app.delete<{ Params: { inviteId: string } }>('/api/admin/invites/:inviteId', { preHandler: app.requireAdmin }, async (request, reply) => {
    const inviteId = Number(request.params.inviteId);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      return reply.code(400).send({ message: 'Invalid invite id' });
    }

    const invites = await queryRows<{ id: number; code: string }[]>(
      'SELECT id, code FROM registration_invites WHERE id = ? LIMIT 1',
      [inviteId]
    );
    const invite = invites[0];
    if (!invite) {
      return reply.code(404).send({ message: 'Invite not found' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM registration_invites WHERE id = ?', [inviteId]);
      await connection.execute(
        "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'invite_deleted', 'inviteId', ?, 'code', ?))",
        [request.user.id, inviteId, invite.code]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return { success: true };
  });

  app.get<{
    Querystring: { limit?: string; userId?: string; accountId?: string; scope?: string };
  }>('/api/admin/logs', { preHandler: app.requireAdmin }, async (request, reply) => {
    const parsedLimit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return reply.code(400).send({ message: 'Invalid limit' });
    }
    const limit = Math.min(300, parsedLimit);
    const userId = parsePositiveInt(request.query.userId);
    const accountId = parsePositiveInt(request.query.accountId);
    const scope = parseScope(request.query.scope);

    if (Number.isNaN(userId)) {
      return reply.code(400).send({ message: 'Invalid userId' });
    }
    if (Number.isNaN(accountId)) {
      return reply.code(400).send({ message: 'Invalid accountId' });
    }

    const params: unknown[] = [];
    let where = 'WHERE l.user_id IS NOT NULL';

    if (userId) {
      where += ' AND l.user_id = ?';
      params.push(userId);
    }

    if (accountId) {
      where += ' AND l.account_id = ?';
      params.push(accountId);
    }

    params.push(Math.max(limit * 3, 150));

    const rows = await queryRows<LogRow[]>(
      `SELECT l.id, l.user_id, l.account_id, l.type, l.details, l.created_at, a.alias, u.email AS user_email
       FROM logs l
       LEFT JOIN user_accounts a ON a.id = l.account_id
       LEFT JOIN users u ON u.id = l.user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ?`,
      params
    );

    const mapped = rows.map(mapLogRow).filter(Boolean) as LogViewItem[];
    const filtered = scope === 'all' ? mapped : mapped.filter((item) => item.category === scope);

    return {
      items: filtered.slice(0, limit)
    };
  });

  app.delete<{ Params: { userId: string } }>(
    '/api/admin/users/:userId',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const userId = Number(request.params.userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        return reply.code(400).send({ message: 'Invalid user id' });
      }

      if (userId === request.user.id) {
        return reply.code(400).send({ message: 'You cannot delete your own admin account.' });
      }

      if (!requireSensitiveAuth(request, reply)) {
        return;
      }

      const users = await queryRows<{ id: number; email: string; role: string }[]>(
        'SELECT id, email, role FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      const target = users[0];
      if (!target) {
        return reply.code(404).send({ message: 'User not found' });
      }

      if (target.role === 'admin') {
        return reply.code(403).send({ message: 'Deleting admin accounts is blocked.' });
      }

      const accounts = await queryRows<{ id: number }[]>(
        'SELECT id FROM user_accounts WHERE user_id = ?',
        [userId]
      );
      const accountIds = accounts.map((account) => account.id);

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        if (accountIds.length > 0) {
          const placeholders = accountIds.map(() => '?').join(', ');
          await connection.execute(
            `UPDATE logs
             SET account_id = NULL
             WHERE account_id IN (${placeholders})`,
            accountIds
          );
        }

        await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
        await connection.execute(
          "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'admin_user_deleted', 'targetUserId', ?, 'targetEmail', ?))",
          [request.user.id, userId, target.email]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      return { success: true };
    }
  );
};

export default adminRoutes;
