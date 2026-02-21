import 'fastify';
import type { FastifyReply } from 'fastify';
import type { JwtUser } from './auth';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtUser;
  }

  interface FastifyInstance {
    authenticate: (request: import('fastify').FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: import('fastify').FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
