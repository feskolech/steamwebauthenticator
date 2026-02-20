import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { execute, queryRows } from '../db/pool';
import { createOpaqueCode, createNumericCode } from '../utils/crypto';
import { clearSessionCookie, issueSessionCookie } from '../utils/session';
import { guardLoginByIp, guardWriteByIp } from '../middleware/rateLimiters';
import { getUserByEmail, getUserById, sanitizeUser } from '../services/userService';
import { sendTelegramMessage } from '../services/telegramService';
import { env } from '../config/env';
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  verifyAuthentication,
  verifyRegistration
} from '../services/passkeyService';

type RegisterBody = {
  email: string;
  password: string;
};

type LoginBody = {
  email: string;
  password: string;
};

const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/auth/csrf', async (_request, reply) => {
    const csrfToken = (reply as any).generateCsrf();
    return { csrfToken };
  });

  app.post<{ Body: RegisterBody }>('/api/auth/register', async (request, reply) => {
    try {
      await guardWriteByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    const email = request.body.email?.toLowerCase().trim();
    const password = request.body.password;

    if (!email || !password || password.length < 8) {
      return reply.code(400).send({ message: 'Invalid email or password' });
    }

    const settings = await queryRows<{ registration_enabled: number }[]>(
      'SELECT registration_enabled FROM global_settings WHERE id = 1 LIMIT 1'
    );

    if (settings[0] && !settings[0].registration_enabled) {
      return reply.code(403).send({ message: 'Registration is disabled by administrator' });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ message: 'User already exists' });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await execute(
      `INSERT INTO users (email, password_hash, role, language, theme, twofa_method)
       VALUES (?, ?, 'user', 'en', 'light', 'none')`,
      [email, hash]
    );

    const created = await getUserById(Number(result.insertId));
    if (!created) {
      return reply.code(500).send({ message: 'User creation failed' });
    }

    await issueSessionCookie(app, reply, {
      id: created.id,
      email: created.email,
      role: created.role
    });

    return { user: sanitizeUser(created) };
  });

  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    try {
      await guardLoginByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    const email = request.body.email?.toLowerCase().trim();
    const password = request.body.password;

    if (!email || !password) {
      return reply.code(400).send({ message: 'Invalid credentials' });
    }

    const user = await getUserByEmail(email);
    if (!user || !user.is_active) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    if (user.twofa_method === 'telegram' && user.telegram_user_id) {
      const code = createNumericCode(6);
      await execute(
        `INSERT INTO pending_telegram_2fa (user_id, code, expires_at)
         VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))`,
        [user.id, code]
      );

      await sendTelegramMessage(
        user.telegram_user_id,
        `SteamGuard Web login code: ${code}. This code expires in 10 minutes.`
      );

      return {
        requires2fa: true,
        method: 'telegram',
        email: user.email,
        message: 'Telegram code sent'
      };
    }

    await issueSessionCookie(app, reply, {
      id: user.id,
      email: user.email,
      role: user.role
    });

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'login', JSON_OBJECT('method', 'password'))",
      [user.id]
    );

    return { user: sanitizeUser(user) };
  });

  app.post<{ Body: { email: string; code: string } }>('/api/auth/login/verify-telegram', async (request, reply) => {
    const email = request.body.email?.toLowerCase().trim();
    const code = request.body.code?.trim();

    if (!email || !code) {
      return reply.code(400).send({ message: 'Missing email or code' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return reply.code(404).send({ message: 'User not found' });
    }

    const pendingRows = await queryRows<{ id: number; code: string }[]>(
      `SELECT id, code
       FROM pending_telegram_2fa
       WHERE user_id = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
       ORDER BY id DESC
       LIMIT 1`,
      [user.id]
    );

    const pending = pendingRows[0];
    if (!pending || pending.code !== code) {
      return reply.code(401).send({ message: 'Invalid 2FA code' });
    }

    await execute('UPDATE pending_telegram_2fa SET used_at = UTC_TIMESTAMP() WHERE id = ?', [pending.id]);

    await issueSessionCookie(app, reply, {
      id: user.id,
      email: user.email,
      role: user.role
    });

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'login', JSON_OBJECT('method', 'telegram_2fa'))",
      [user.id]
    );

    return { user: sanitizeUser(user) };
  });

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (_request, reply) => {
    clearSessionCookie(reply);
    return { success: true };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await getUserById(request.user.id);
    if (!user) {
      clearSessionCookie(reply);
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    return { user: sanitizeUser(user) };
  });

  app.post('/api/auth/telegram/oauth/start', async () => {
    const code = createOpaqueCode(8);
    await execute(
      `INSERT INTO telegram_oauth_codes (code, expires_at)
       VALUES (?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))`,
      [code]
    );

    const startParam = `login_${code}`;
    const deepLink = env.TELEGRAM_BOT_USERNAME
      ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${startParam}`
      : null;

    return {
      code,
      startParam,
      deepLink,
      manualCommand: `/start ${startParam}`,
      expiresInSec: 600
    };
  });

  app.get<{ Params: { code: string } }>('/api/auth/telegram/oauth/poll/:code', async (request, reply) => {
    const rows = await queryRows<{
      code: string;
      approved: number;
      telegram_user_id: string | null;
      expires_at: Date;
    }[]>(
      `SELECT code, approved, telegram_user_id, expires_at
       FROM telegram_oauth_codes
       WHERE code = ?
       LIMIT 1`,
      [request.params.code]
    );

    const authCode = rows[0];
    if (!authCode) {
      return reply.code(404).send({ message: 'Code not found' });
    }

    if (new Date(authCode.expires_at).getTime() < Date.now()) {
      return { status: 'expired' };
    }

    if (!authCode.approved || !authCode.telegram_user_id) {
      return { status: 'pending' };
    }

    const users = await queryRows<any[]>(
      'SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1',
      [authCode.telegram_user_id]
    );
    const user = users[0];

    if (!user) {
      return { status: 'unlinked' };
    }

    await issueSessionCookie(app, reply, {
      id: user.id,
      email: user.email,
      role: user.role
    });

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'login', JSON_OBJECT('method', 'telegram_oauth'))",
      [user.id]
    );

    return { status: 'ok', user: sanitizeUser(user) };
  });

  app.post('/api/auth/webauthn/register/options', { preHandler: app.authenticate }, async (request, reply) => {
    const currentUser = await getUserById(request.user.id);
    if (!currentUser) {
      return reply.code(404).send({ message: 'User not found' });
    }

    const credentials = await queryRows<{ credential_id: string }[]>(
      'SELECT credential_id FROM user_passkeys WHERE user_id = ?',
      [currentUser.id]
    );

    const options = await createRegistrationOptions({
      userId: currentUser.id,
      email: currentUser.email,
      existingCredentialIds: credentials.map((c) => c.credential_id)
    });

    await execute(
      `INSERT INTO webauthn_challenges (user_id, challenge, flow, expires_at)
       VALUES (?, ?, 'register', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))`,
      [currentUser.id, options.challenge]
    );

    return options;
  });

  app.post<{ Body: { response: any } }>(
    '/api/auth/webauthn/register/verify',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const currentUser = await getUserById(request.user.id);
      if (!currentUser) {
        return reply.code(404).send({ message: 'User not found' });
      }

      const challenges = await queryRows<{ id: number; challenge: string }[]>(
        `SELECT id, challenge
         FROM webauthn_challenges
         WHERE user_id = ? AND flow = 'register' AND expires_at > UTC_TIMESTAMP()
         ORDER BY id DESC
         LIMIT 1`,
        [currentUser.id]
      );

      const challenge = challenges[0];
      if (!challenge) {
        return reply.code(400).send({ message: 'Challenge expired' });
      }

      const verification = await verifyRegistration({
        response: request.body.response,
        expectedChallenge: challenge.challenge
      });

      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ message: 'Passkey verification failed' });
      }

      const cred = verification.registrationInfo.credential;
      const publicKey = Buffer.from(cred.publicKey).toString('base64');

      await execute(
        `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, transports)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE counter = VALUES(counter), transports = VALUES(transports)`,
        [
          currentUser.id,
          cred.id,
          publicKey,
          verification.registrationInfo.credential.counter,
          (cred.transports ?? []).join(',')
        ]
      );

      await execute(
        "UPDATE users SET twofa_method = 'webauthn' WHERE id = ?",
        [currentUser.id]
      );

      await execute('DELETE FROM webauthn_challenges WHERE id = ?', [challenge.id]);

      return { verified: true };
    }
  );

  app.post<{ Body: { email: string } }>('/api/auth/webauthn/login/options', async (request, reply) => {
    const email = request.body.email?.toLowerCase().trim();
    if (!email) {
      return reply.code(400).send({ message: 'Email is required' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return reply.code(404).send({ message: 'User not found' });
    }

    const creds = await queryRows<{ credential_id: string }[]>(
      'SELECT credential_id FROM user_passkeys WHERE user_id = ?',
      [user.id]
    );

    if (creds.length === 0) {
      return reply.code(400).send({ message: 'No passkeys registered' });
    }

    const options = await createAuthenticationOptions(creds.map((c) => c.credential_id));

    await execute(
      `INSERT INTO webauthn_challenges (user_id, challenge, flow, expires_at)
       VALUES (?, ?, 'login', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))`,
      [user.id, options.challenge]
    );

    return options;
  });

  app.post<{ Body: { email: string; response: any } }>('/api/auth/webauthn/login/verify', async (request, reply) => {
    const email = request.body.email?.toLowerCase().trim();
    if (!email) {
      return reply.code(400).send({ message: 'Email is required' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return reply.code(404).send({ message: 'User not found' });
    }

    const challenges = await queryRows<{ id: number; challenge: string }[]>(
      `SELECT id, challenge
       FROM webauthn_challenges
       WHERE user_id = ? AND flow = 'login' AND expires_at > UTC_TIMESTAMP()
       ORDER BY id DESC
       LIMIT 1`,
      [user.id]
    );

    const challenge = challenges[0];
    if (!challenge) {
      return reply.code(400).send({ message: 'Challenge expired' });
    }

    const creds = await queryRows<{
      credential_id: string;
      public_key: string;
      counter: number;
      transports: string | null;
    }[]>(
      'SELECT credential_id, public_key, counter, transports FROM user_passkeys WHERE user_id = ? AND credential_id = ? LIMIT 1',
      [user.id, request.body.response.id]
    );

    const credential = creds[0];
    if (!credential) {
      return reply.code(400).send({ message: 'Credential not found' });
    }

    const verification = await verifyAuthentication({
      response: request.body.response,
      expectedChallenge: challenge.challenge,
      credential: {
        id: credential.credential_id,
        publicKey: Buffer.from(credential.public_key, 'base64'),
        counter: Number(credential.counter),
        transports: credential.transports ? credential.transports.split(',') : undefined
      }
    });

    if (!verification.verified) {
      return reply.code(400).send({ message: 'Passkey login failed' });
    }

    await execute('UPDATE user_passkeys SET counter = ? WHERE credential_id = ?', [
      verification.authenticationInfo.newCounter,
      credential.credential_id
    ]);

    await execute('DELETE FROM webauthn_challenges WHERE id = ?', [challenge.id]);

    await issueSessionCookie(app, reply, {
      id: user.id,
      email: user.email,
      role: user.role
    });

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'login', JSON_OBJECT('method', 'webauthn'))",
      [user.id]
    );

    return { user: sanitizeUser(user) };
  });
};

export default authRoutes;
