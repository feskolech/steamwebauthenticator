import crypto from 'crypto';
import { env } from '../config/env';

const IV_LENGTH = 16;

function deriveUserKey(passwordHash: string, userId: number): Buffer {
  return crypto.pbkdf2Sync(passwordHash, `${env.ENCRYPTION_KEY}:${userId}`, 180000, 32, 'sha256');
}

export function encryptForUser(payload: string, passwordHash: string, userId: number): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveUserKey(passwordHash, userId);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptForUser(encryptedPayload: string, passwordHash: string, userId: number): string {
  const [ivB64, authTagB64, payloadB64] = encryptedPayload.split(':');
  if (!ivB64 || !authTagB64 || !payloadB64) {
    throw new Error('Malformed encrypted payload');
  }

  const key = deriveUserKey(passwordHash, userId);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const plain = Buffer.concat([
    decipher.update(Buffer.from(payloadB64, 'base64')),
    decipher.final()
  ]);

  return plain.toString('utf8');
}

export function createNumericCode(length = 6): string {
  const min = 10 ** (length - 1);
  const max = (10 ** length) - 1;
  const value = crypto.randomInt(min, max + 1);
  return String(value);
}

export function createOpaqueCode(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(`${env.ENCRYPTION_KEY}:${rawKey}`).digest('hex');
}
