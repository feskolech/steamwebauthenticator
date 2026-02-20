import { type FastifyReply, type FastifyInstance } from 'fastify';
import { isProd } from '../config/env';

export async function issueSessionCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  payload: { id: number; email: string; role: 'user' | 'admin' }
): Promise<void> {
  const token = await reply.jwtSign(payload, { expiresIn: '7d' });

  reply.setCookie('sg_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    signed: false
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie('sg_token', { path: '/' });
}
