import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, execute, queryRows } from '../db/pool';
import { createOpaqueCode, createNumericCode, decryptForUser, hashApiKey } from '../utils/crypto';
import { createRegistrationChallenge, validateRegistrationChallenge } from '../utils/registrationChallenge';
import { clearSessionCookie, issueSessionCookie } from '../utils/session';
import { clearSensitiveAuthCookie, issueSensitiveAuthCookie } from '../utils/sensitiveAuth';
import { guardLogin2faByIp, guardLoginByIp, guardRegisterByIp, guardWriteByIp } from '../middleware/rateLimiters';
import { getUserByEmail, getUserById, sanitizeUser } from '../services/userService';
import { telegramLogin2faCode } from '../services/telegramCopy';
import { sendTelegramMessage } from '../services/telegramService';
import { verifyTurnstileToken } from '../services/turnstileService';
import { env } from '../config/env';
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  verifyAuthentication,
  verifyRegistration
} from '../services/passkeyService';
import {
  normalizeDomainList,
  parseRegistrationMode,
  validateRegistrationAccess
} from '../services/registrationPolicyService';
import { hashRecoveryCode } from '../services/recoveryCodeService';
import { verifyTotpCode } from '../services/totpService';

type RegisterBody = {
  email: string;
  password: string;
  registrationChallenge?: string;
  inviteCode?: string;
  company?: string;
  turnstileToken?: string;
};

type LoginBody = {
  email: string;
  password: string;
};

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/auth/csrf', async (_request, reply) => {
    const csrfToken = (reply as any).generateCsrf();
    return { csrfToken };
  });

  app.get('/api/auth/register/challenge', async () => createRegistrationChallenge());

  app.post<{ Body: RegisterBody }>('/api/auth/register', async (request, reply) => {
    try {
      await guardRegisterByIp(request.ip);
      await guardWriteByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    if (request.body.company?.trim()) {
      return reply.code(400).send({ message: 'Registration request rejected.' });
    }

    const challengeResult = validateRegistrationChallenge(request.body.registrationChallenge);
    if (!challengeResult.ok) {
      return reply.code(400).send({ message: challengeResult.message });
    }

    const turnstileResult = await verifyTurnstileToken(request.body.turnstileToken, request.ip);
    if (!turnstileResult.ok) {
      return reply.code(400).send({ message: turnstileResult.message });
    }

    const email = request.body.email?.toLowerCase().trim();
    const password = request.body.password;

    if (!email || !password || password.length < 8) {
      return reply.code(400).send({ message: 'Invalid email or password' });
    }

    const settings = await queryRows<
      { registration_enabled: number; registration_mode: string; allowed_email_domains: string | null }[]
    >(
      'SELECT registration_enabled, registration_mode, allowed_email_domains FROM global_settings WHERE id = 1 LIMIT 1'
    );

    const registrationMode = parseRegistrationMode(settings[0]?.registration_mode);
    const inviteCode = request.body.inviteCode?.trim().toUpperCase() || null;
    const inviteRows = registrationMode === 'invite_only' && inviteCode
      ? await queryRows<{ id: number }[]>(
          `SELECT id
           FROM registration_invites
           WHERE code = ?
             AND used_at IS NULL
             AND expires_at > UTC_TIMESTAMP()
           LIMIT 1`,
          [inviteCode]
        )
      : [];
    const invite = inviteRows[0] ?? null;

    try {
      validateRegistrationAccess(
        {
          registrationEnabled: Boolean(settings[0]?.registration_enabled),
          registrationMode,
          allowedEmailDomains: normalizeDomainList(settings[0]?.allowed_email_domains)
        },
        email,
        { hasInvite: Boolean(invite) }
      );
    } catch (error: any) {
      return reply.code(403).send({ message: error.message });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ message: 'User already exists' });
    }

    const hash = await bcrypt.hash(password, 12);

    const connection = await db.getConnection();
    let insertId = 0;
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<any>(
        `INSERT INTO users (email, password_hash, role, language, theme, twofa_method)
         VALUES (?, ?, 'user', 'en', 'light', 'none')`,
        [email, hash]
      );
      insertId = Number(result.insertId);

      if (invite) {
        await connection.execute(
          `UPDATE registration_invites
           SET used_at = UTC_TIMESTAMP(), used_by_user_id = ?
           WHERE id = ? AND used_at IS NULL`,
          [insertId, invite.id]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const created = await getUserById(insertId);
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

  app.post<{ Body: { password?: string } }>(
    '/api/auth/reauth',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        await guardLoginByIp(request.ip);
      } catch (error: any) {
        return reply.code(429).send({ message: error.message });
      }

      const password = request.body.password;
      if (!password) {
        return reply.code(400).send({ message: 'Password is required' });
      }

      const user = await getUserById(request.user.id);
      if (!user || !user.is_active) {
        clearSessionCookie(reply);
        clearSensitiveAuthCookie(reply);
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return reply.code(401).send({ message: 'Invalid password' });
      }

      issueSensitiveAuthCookie(reply, user.id);
      return { success: true };
    }
  );

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
        telegramLogin2faCode(user.language, code)
      );

      return {
        requires2fa: true,
        method: 'telegram',
        email: user.email,
        message: 'Telegram code sent'
      };
    }

    if (user.twofa_method === 'totp' && user.encrypted_totp_secret) {
      return {
        requires2fa: true,
        method: 'totp',
        email: user.email,
        message: 'TOTP code required'
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
    try {
      await guardLogin2faByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    const email = request.body.email?.toLowerCase().trim();
    const code = request.body.code?.trim();

    if (!email || !code) {
      return reply.code(400).send({ message: 'Missing email or code' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return reply.code(401).send({ message: 'Invalid 2FA code' });
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

  app.post<{ Body: { email: string; code: string } }>('/api/auth/login/verify-totp', async (request, reply) => {
    try {
      await guardLogin2faByIp(request.ip);
    } catch (error: any) {
      return reply.code(429).send({ message: error.message });
    }

    const email = request.body.email?.toLowerCase().trim();
    const code = request.body.code?.trim();

    if (!email || !code) {
      return reply.code(400).send({ message: 'Missing email or code' });
    }

    const user = await getUserByEmail(email);
    if (!user || !user.encrypted_totp_secret) {
      return reply.code(401).send({ message: 'Invalid 2FA code' });
    }

    const secret = decryptForUser(user.encrypted_totp_secret, user.password_hash, user.id);
    if (!verifyTotpCode(secret, code)) {
      return reply.code(401).send({ message: 'Invalid 2FA code' });
    }

    await issueSessionCookie(app, reply, {
      id: user.id,
      email: user.email,
      role: user.role
    });

    await execute(
      "INSERT INTO logs (user_id, type, details) VALUES (?, 'login', JSON_OBJECT('method', 'totp'))",
      [user.id]
    );

    return { user: sanitizeUser(user) };
  });

  app.post<{ Body: { email: string; password: string; recoveryCode: string } }>(
    '/api/auth/login/recovery',
    async (request, reply) => {
      try {
        await guardLogin2faByIp(request.ip);
      } catch (error: any) {
        return reply.code(429).send({ message: error.message });
      }

      const email = request.body.email?.toLowerCase().trim();
      const password = request.body.password;
      const recoveryCode = request.body.recoveryCode?.trim();

      if (!email || !password || !recoveryCode) {
        return reply.code(400).send({ message: 'Missing email, password or recovery code' });
      }

      const user = await getUserByEmail(email);
      if (!user || !user.is_active) {
        return reply.code(401).send({ message: 'Invalid credentials' });
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return reply.code(401).send({ message: 'Invalid credentials' });
      }

      const recoveryRows = await queryRows<{ id: number }[]>(
        `SELECT id
         FROM user_recovery_codes
         WHERE user_id = ?
           AND code_hash = ?
           AND used_at IS NULL
         LIMIT 1`,
        [user.id, hashRecoveryCode(recoveryCode)]
      );

      const recoveryRow = recoveryRows[0];
      if (!recoveryRow) {
        return reply.code(401).send({ message: 'Invalid recovery code' });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('DELETE FROM user_recovery_codes WHERE user_id = ?', [user.id]);
        await connection.execute(
          "UPDATE users SET twofa_method = 'none', encrypted_totp_secret = NULL WHERE id = ?",
          [user.id]
        );
        await connection.execute('DELETE FROM user_passkeys WHERE user_id = ?', [user.id]);
        await connection.execute('DELETE FROM pending_telegram_2fa WHERE user_id = ?', [user.id]);
        await connection.execute('DELETE FROM pending_totp_setups WHERE user_id = ?', [user.id]);
        await connection.execute(
          "INSERT INTO logs (user_id, type, details) VALUES (?, 'system', JSON_OBJECT('event', 'recovery_code_used'))",
          [user.id]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      const refreshedUser = await getUserById(user.id);
      if (!refreshedUser) {
        return reply.code(500).send({ message: 'User not found after recovery login' });
      }

      await issueSessionCookie(app, reply, {
        id: refreshedUser.id,
        email: refreshedUser.email,
        role: refreshedUser.role
      });

      return { user: sanitizeUser(refreshedUser) };
    }
  );

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (_request, reply) => {
    clearSessionCookie(reply);
    clearSensitiveAuthCookie(reply);
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
    const pollSecret = createOpaqueCode(16);
    const pollSecretHash = hashApiKey(pollSecret);
    await execute(
      `INSERT INTO telegram_oauth_codes (code, poll_secret_hash, expires_at)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))`,
      [code, pollSecretHash]
    );

    const startParam = `login_${code}`;
    const deepLink = env.TELEGRAM_BOT_USERNAME
      ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${startParam}`
      : null;

    return {
      code,
      pollSecret,
      startParam,
      deepLink,
      manualCommand: `/start ${startParam}`,
      expiresInSec: 600
    };
  });

  app.get<{ Params: { code: string } }>(
    '/api/auth/telegram/oauth/poll/:code',
    async (request, reply) => {
      const rawHeaderToken = request.headers['x-telegram-poll-token'];
      const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken;
      const pollToken = headerToken?.trim();
      if (!pollToken) {
        return reply.code(401).send({ message: 'Missing poll token' });
      }

      const rows = await queryRows<{
        code: string;
        approved: number;
        telegram_user_id: string | null;
        poll_secret_hash: string;
        consumed_at: Date | null;
        expires_at: Date;
      }[]>(
        `SELECT code, approved, telegram_user_id, poll_secret_hash, consumed_at, expires_at
         FROM telegram_oauth_codes
         WHERE code = ?
         LIMIT 1`,
        [request.params.code]
      );

      const authCode = rows[0];
      if (!authCode) {
        return reply.code(404).send({ message: 'Code not found' });
      }

      const pollTokenHash = hashApiKey(pollToken);
      if (!safeHashEqual(authCode.poll_secret_hash, pollTokenHash)) {
        return reply.code(401).send({ message: 'Invalid poll token' });
      }

      if (new Date(authCode.expires_at).getTime() < Date.now()) {
        return { status: 'expired' };
      }

      if (authCode.consumed_at) {
        return { status: 'used' };
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

      const consumeResult = await execute(
        `UPDATE telegram_oauth_codes
         SET consumed_at = UTC_TIMESTAMP()
         WHERE code = ?
           AND approved = TRUE
           AND consumed_at IS NULL
           AND expires_at > UTC_TIMESTAMP()`,
        [request.params.code]
      );

      if (consumeResult.affectedRows === 0) {
        return { status: 'used' };
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
    }
  );

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

  app.post<{ Body: { email?: string } }>('/api/auth/webauthn/login/options', async (request, reply) => {
    const email = request.body.email?.toLowerCase().trim();
    let userId: number | null = null;
    let credentialIds: string[] = [];

    if (email) {
      const user = await getUserByEmail(email);
      if (!user) {
        return reply.code(400).send({ message: 'Passkey login is unavailable for this account' });
      }

      const creds = await queryRows<{ credential_id: string }[]>(
        'SELECT credential_id FROM user_passkeys WHERE user_id = ?',
        [user.id]
      );

      if (creds.length === 0) {
        return reply.code(400).send({ message: 'Passkey login is unavailable for this account' });
      }

      userId = user.id;
      credentialIds = creds.map((c) => c.credential_id);
    }

    const options = await createAuthenticationOptions(credentialIds);

    await execute(
      `INSERT INTO webauthn_challenges (user_id, challenge, flow, expires_at)
       VALUES (?, ?, 'login', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))`,
      [userId, options.challenge]
    );

    return options;
  });

  app.post<{ Body: { email?: string; challenge?: string; response: any } }>('/api/auth/webauthn/login/verify', async (request, reply) => {
    const email = request.body.email?.toLowerCase().trim();
    const responseId = request.body.response?.id;
    if (!responseId) {
      return reply.code(400).send({ message: 'Passkey login failed' });
    }

    let user = null;
    let credential:
      | {
          credential_id: string;
          public_key: string;
          counter: number;
          transports: string | null;
        }
      | undefined;

    if (email) {
      user = await getUserByEmail(email);
      if (!user) {
        return reply.code(400).send({ message: 'Passkey login failed' });
      }

      const creds = await queryRows<{
        credential_id: string;
        public_key: string;
        counter: number;
        transports: string | null;
      }[]>(
        'SELECT credential_id, public_key, counter, transports FROM user_passkeys WHERE user_id = ? AND credential_id = ? LIMIT 1',
        [user.id, responseId]
      );

      credential = creds[0];
    } else {
      const rows = await queryRows<({
        credential_id: string;
        public_key: string;
        counter: number;
        transports: string | null;
      } & {
        id: number;
        email: string;
        role: 'user' | 'admin';
        language: string;
        theme: 'light' | 'dark';
        telegram_user_id: string | null;
        telegram_username: string | null;
        twofa_method: 'none' | 'telegram' | 'webauthn' | 'totp';
        encrypted_totp_secret: string | null;
        api_key_last4: string | null;
        is_active: number;
        password_hash: string;
      })[]>(
        `SELECT u.*, p.credential_id, p.public_key, p.counter, p.transports
         FROM user_passkeys p
         JOIN users u ON u.id = p.user_id
         WHERE p.credential_id = ?
         LIMIT 1`,
        [responseId]
      );

      const row = rows[0];
      if (row) {
        user = row;
        credential = row;
      }
    }

    if (!user || !credential) {
      return reply.code(400).send({ message: 'Passkey login failed' });
    }

    if (!user.is_active) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const challengeParams = request.body.challenge
      ? [user.id, request.body.challenge]
      : [user.id];
    const challengeQuery = request.body.challenge
      ? `SELECT id, challenge
         FROM webauthn_challenges
         WHERE flow = 'login'
           AND expires_at > UTC_TIMESTAMP()
           AND (user_id = ? OR user_id IS NULL)
           AND challenge = ?
         ORDER BY id DESC
         LIMIT 1`
      : `SELECT id, challenge
         FROM webauthn_challenges
         WHERE user_id = ? AND flow = 'login' AND expires_at > UTC_TIMESTAMP()
         ORDER BY id DESC
         LIMIT 1`;

    const challenges = await queryRows<{ id: number; challenge: string }[]>(challengeQuery, challengeParams);

    const challenge = challenges[0];
    if (!challenge) {
      return reply.code(400).send({ message: 'Challenge expired' });
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
