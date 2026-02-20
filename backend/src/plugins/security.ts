import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import csrfProtection from '@fastify/csrf-protection';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { env, isProd } from '../config/env';

export default fp(async (app) => {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }

      const allowed = [env.APP_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'];
      cb(null, allowed.includes(origin));
    },
    credentials: true
  });

  await app.register(helmet, {
    contentSecurityPolicy: false
  });

  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {
      sameSite: 'lax',
      httpOnly: true,
      secure: isProd,
      path: '/'
    }
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'sg_token',
      signed: false
    }
  });

  await app.register(csrfProtection, {
    cookieOpts: {
      signed: false,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/'
    }
  });

  await app.register(multipart, {
    limits: {
      fileSize: 3 * 1024 * 1024,
      files: 1
    }
  });

  await app.register(websocket);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SteamGuard Web API',
        version: '1.0.0'
      },
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'sg_token'
          }
        }
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/api-docs'
  });

  if (isProd) {
    app.addHook('onRequest', async (request, reply) => {
      const forwardedProto = request.headers['x-forwarded-proto'];
      if (forwardedProto && forwardedProto !== 'https') {
        const host = request.headers.host;
        if (host) {
          return reply.redirect(`https://${host}${request.url}`);
        }
      }
    });
  }

  app.addHook('preHandler', (request, reply, done) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      done();
      return;
    }

    if (request.url.startsWith('/api/telegram/bot/')) {
      done();
      return;
    }

    app.csrfProtection(request, reply, done);
  });
});
