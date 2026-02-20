import type { FastifyPluginAsync } from 'fastify';
import { execute, queryRows } from '../db/pool';
import { decryptForUser } from '../utils/crypto';
import { parseMaFile } from '../utils/mafile';
import { generateSteamCode, respondToConfirmation } from '../services/steamService';

async function getAccountForUser(userId: number, accountId: number): Promise<any> {
  const rows = await queryRows<any[]>(
    `SELECT a.*, u.password_hash
     FROM user_accounts a
     JOIN users u ON u.id = a.user_id
     WHERE a.id = ? AND a.user_id = ?
     LIMIT 1`,
    [accountId, userId]
  );

  if (!rows[0]) {
    throw new Error('Account not found');
  }

  return rows[0];
}

async function getSession(accountId: number): Promise<any | null> {
  const rows = await queryRows<{ session_json: string }[]>(
    'SELECT session_json FROM account_sessions WHERE account_id = ? LIMIT 1',
    [accountId]
  );

  if (!rows[0]) {
    return null;
  }

  return JSON.parse(rows[0].session_json);
}

const userApiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/user/accounts', { preHandler: app.authenticate }, async (request) => {
    const accounts = await queryRows<any[]>(
      `SELECT id, alias, account_name, steamid, auto_confirm, auto_confirm_trades, auto_confirm_logins, auto_confirm_delay_sec, last_code, last_active
       FROM user_accounts
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [request.user.id]
    );

    return {
      items: accounts.map((item) => ({
        id: item.id,
        alias: item.alias,
        accountName: item.account_name,
        steamid: item.steamid,
        autoConfirm: Boolean(item.auto_confirm ?? item.auto_confirm_trades),
        autoConfirmTrades: Boolean(item.auto_confirm_trades ?? item.auto_confirm),
        autoConfirmLogins: Boolean(item.auto_confirm_logins),
        autoConfirmDelaySec: item.auto_confirm_delay_sec,
        lastCode: item.last_code,
        lastActive: item.last_active
      }))
    };
  });

  app.get<{ Params: { id: string } }>('/api/account/:id/code', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = Number(request.params.id);

    try {
      const account = await getAccountForUser(request.user.id, accountId);
      const ma = parseMaFile(decryptForUser(account.encrypted_ma, account.password_hash, request.user.id));
      const code = generateSteamCode(ma.shared_secret);

      await execute('UPDATE user_accounts SET last_code = ?, last_active = UTC_TIMESTAMP() WHERE id = ?', [
        code,
        accountId
      ]);

      return { code, generatedAt: new Date().toISOString() };
    } catch (error: any) {
      return reply.code(404).send({ message: error.message });
    }
  });

  app.post<{ Params: { id: string; offerid: string }; Body: { nonce?: string } }>(
    '/api/account/:id/confirm/trade/:offerid',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = Number(request.params.id);
      const confirmationId = request.params.offerid;

      try {
        const account = await getAccountForUser(request.user.id, accountId);
        const ma = parseMaFile(decryptForUser(account.encrypted_ma, account.password_hash, request.user.id));
        const session = await getSession(accountId);

        let nonce = request.body?.nonce;
        if (!nonce) {
          const rows = await queryRows<{ nonce: string }[]>(
            'SELECT nonce FROM confirmations_cache WHERE account_id = ? AND confirmation_id = ? LIMIT 1',
            [accountId, confirmationId]
          );
          nonce = rows[0]?.nonce;
        }

        if (!nonce) {
          return reply.code(400).send({ message: 'Missing nonce. Fetch trade queue first.' });
        }

        const success = await respondToConfirmation({
          ma,
          session,
          confirmationId,
          nonce,
          accept: true
        });

        if (!success) {
          return reply.code(400).send({ message: 'Confirmation failed' });
        }

        await execute(
          "UPDATE confirmations_cache SET status = 'confirmed', updated_at = UTC_TIMESTAMP() WHERE account_id = ? AND confirmation_id = ?",
          [accountId, confirmationId]
        );

        return { success: true };
      } catch (error: any) {
        return reply.code(400).send({ message: error.message });
      }
    }
  );
};

export default userApiRoutes;
