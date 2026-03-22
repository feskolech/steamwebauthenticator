import type { FastifyPluginAsync } from 'fastify';
import { queryRows } from '../db/pool';
import { mapLogRow, parseScope, type LogRow, type LogViewItem } from '../services/logViewService';

function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

const logsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { limit?: string; accountId?: string; scope?: string };
  }>('/api/logs', { preHandler: app.authenticate }, async (request, reply) => {
    const parsedLimit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return reply.code(400).send({ message: 'Invalid limit' });
    }

    const limit = Math.min(300, parsedLimit);
    const accountId = parsePositiveInt(request.query.accountId);
    const scope = parseScope(request.query.scope);

    if (Number.isNaN(accountId)) {
      return reply.code(400).send({ message: 'Invalid accountId' });
    }

    const params: unknown[] = [request.user.id];
    let where = 'WHERE l.user_id = ?';

    if (accountId) {
      where += ' AND l.account_id = ?';
      params.push(accountId);
    }

    params.push(Math.max(limit * 3, 100));

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
};

export default logsRoutes;
