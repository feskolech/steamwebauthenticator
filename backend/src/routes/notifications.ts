import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';

const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/notifications', { preHandler: app.authenticate }, async (request) => {
    const items = await queryRows<any[]>(
      `SELECT id, channel, type, payload, read_at, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [request.user.id]
    );

    return {
      items: items.map((row) => ({
        id: row.id,
        channel: row.channel,
        type: row.type,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        readAt: row.read_at,
        createdAt: row.created_at
      }))
    };
  });

  app.post<{ Params: { id: string } }>('/api/notifications/:id/read', { preHandler: app.authenticate }, async (request) => {
    await execute(
      `UPDATE notifications
       SET read_at = UTC_TIMESTAMP()
       WHERE id = ? AND user_id = ?`,
      [Number(request.params.id), request.user.id]
    );

    return { success: true };
  });
};

export default notificationRoutes;
