import { type FastifyReply, type FastifyInstance } from 'fastify';
import { isProd } from '../config/env';
import { signSessionToken } from './jwt';
import { type JwtUser } from '../types/auth';

export async function issueSessionCookie(
  _app: FastifyInstance,
  reply: FastifyReply,
  payload: JwtUser
): Promise<void> {
  const token = signSessionToken(payload);

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
