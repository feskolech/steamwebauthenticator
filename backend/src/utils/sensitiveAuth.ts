import jwt, { type JwtPayload } from 'jsonwebtoken';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { env, isProd } from '../config/env';

const SENSITIVE_COOKIE = 'sg_sensitive';
const SENSITIVE_AUDIENCE = 'steamguard-web-sensitive';
const SENSITIVE_ISSUER = 'steamguard-web';

type SensitiveTokenPayload = {
  id: number;
  purpose: 'sensitive';
};

export function issueSensitiveAuthCookie(reply: FastifyReply, userId: number): void {
  const token = jwt.sign(
    {
      id: userId,
      purpose: 'sensitive'
    } satisfies SensitiveTokenPayload,
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '10m',
      issuer: SENSITIVE_ISSUER,
      audience: SENSITIVE_AUDIENCE,
      subject: String(userId)
    }
  );

  reply.setCookie(SENSITIVE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 60 * 10,
    signed: false
  });
}

export function clearSensitiveAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(SENSITIVE_COOKIE, { path: '/' });
}

function verifySensitiveAuthToken(token: string, userId: number): boolean {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: SENSITIVE_ISSUER,
      audience: SENSITIVE_AUDIENCE
    });

    if (typeof decoded !== 'object' || decoded === null) {
      return false;
    }

    const payload = decoded as JwtPayload & Partial<SensitiveTokenPayload>;
    return payload.id === userId && payload.purpose === 'sensitive';
  } catch {
    return false;
  }
}

export function requireSensitiveAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.cookies?.[SENSITIVE_COOKIE];
  if (!token || !verifySensitiveAuthToken(token, request.user.id)) {
    reply.code(428).send({
      code: 'SENSITIVE_AUTH_REQUIRED',
      message: 'Sensitive action requires password confirmation.'
    });
    return false;
  }

  return true;
}
