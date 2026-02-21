import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { type JwtUser } from '../types/auth';

const JWT_ISSUER = 'steamguard-web';
const JWT_AUDIENCE = 'steamguard-web-user';

export function signSessionToken(payload: JwtUser): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: String(payload.id)
  });
}

export function verifySessionToken(token: string): JwtUser | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    if (typeof decoded !== 'object' || decoded === null) {
      return null;
    }

    const payload = decoded as JwtPayload & Partial<JwtUser>;
    if (
      typeof payload.id !== 'number' ||
      typeof payload.email !== 'string' ||
      (payload.role !== 'user' && payload.role !== 'admin')
    ) {
      return null;
    }

    return {
      id: payload.id,
      email: payload.email,
      role: payload.role
    };
  } catch {
    return null;
  }
}

export function getBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim() || null;
}
