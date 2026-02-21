import Fastify from 'fastify';
import securityPlugin from './plugins/security';
import authPlugin from './plugins/auth';
import healthRoute from './routes/health';
import authRoutes from './routes/auth';
import accountRoutes from './routes/accounts';
import steamRoutes from './routes/steam';
import settingsRoutes from './routes/settings';
import logsRoutes from './routes/logs';
import adminRoutes from './routes/admin';
import userApiRoutes from './routes/userApi';
import botRoutes from './routes/bot';
import notificationRoutes from './routes/notifications';
import { wsHub } from './services/wsHub';
import { getBearerToken, verifySessionToken } from './utils/jwt';

function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const items = cookieHeader.split(';');
  const target = `${name}=`;
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }

  return null;
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { colorize: true }
            }
          : undefined
    }
  });

  await app.register(securityPlugin);
  await app.register(authPlugin);

  app.get('/ws', { websocket: true }, (connection, request) => {
    const socket = (connection as any)?.socket ?? connection;
    const queryToken = (request.query as { token?: string } | undefined)?.token;
    const cookieToken = (request.cookies as any)?.sg_token;
    const headerToken = cookieValue(request.headers.cookie, 'sg_token');
    const bearerToken = getBearerToken(request.headers.authorization);
    const token = queryToken ?? cookieToken ?? headerToken ?? bearerToken;

    if (!token) {
      if (socket && typeof (socket as any).close === 'function') {
        (socket as any).close(4001, 'Unauthorized');
      }
      return;
    }

    try {
      const decoded = verifySessionToken(token);
      if (!decoded) {
        throw new Error('invalid-token');
      }

      wsHub.add(decoded.id, connection);

      socket.send(
        JSON.stringify({ event: 'connected', payload: { userId: decoded.id }, ts: Date.now() })
      );

      socket.on('message', (raw: any) => {
        if (raw.toString() === 'ping') {
          socket.send(JSON.stringify({ event: 'pong', ts: Date.now() }));
        }
      });
    } catch {
      if (socket && typeof (socket as any).close === 'function') {
        (socket as any).close(4001, 'Unauthorized');
      }
    }
  });

  await app.register(healthRoute);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(steamRoutes);
  await app.register(settingsRoutes);
  await app.register(logsRoutes);
  await app.register(adminRoutes);
  await app.register(userApiRoutes);
  await app.register(botRoutes);
  await app.register(notificationRoutes);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (reply.sent) {
      return;
    }

    reply.code(500).send({
      message: 'Internal server error'
    });
  });

  return app;
}
