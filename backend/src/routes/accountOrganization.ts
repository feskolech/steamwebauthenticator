import type { FastifyPluginAsync } from 'fastify';
import { db, execute, queryRows } from '../db/pool';
import { guardWriteByIp } from '../middleware/rateLimiters';
import {
  listFoldersByUser,
  listTagsByUser,
  type AccountFolder,
  type AccountTag
} from '../services/accountOrganizationService';
import { normalizeOrganizationName, normalizeOrganizationTagIds } from '../utils/accountOrganization';

function organizationErrorMessage(kind: 'Folder' | 'Tag', error: any): string {
  if (error?.code === 'ER_DUP_ENTRY') {
    return `${kind} already exists`;
  }

  return error?.message || `${kind} operation failed`;
}

async function getFolderByOwner(userId: number, folderId: number): Promise<AccountFolder> {
  const rows = await queryRows<{ id: number; name: string; created_at: Date }[]>(
    `SELECT id, name, created_at
     FROM account_folders
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [folderId, userId]
  );

  const folder = rows[0];
  if (!folder) {
    throw new Error('Folder not found');
  }

  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.created_at
  };
}

async function getTagByOwner(userId: number, tagId: number): Promise<AccountTag> {
  const rows = await queryRows<{ id: number; name: string; created_at: Date }[]>(
    `SELECT id, name, created_at
     FROM account_tags
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [tagId, userId]
  );

  const tag = rows[0];
  if (!tag) {
    throw new Error('Tag not found');
  }

  return {
    id: tag.id,
    name: tag.name,
    createdAt: tag.created_at
  };
}

const accountOrganizationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/account-organization', { preHandler: app.authenticate }, async (request) => {
    const [folders, tags] = await Promise.all([
      listFoldersByUser(request.user.id),
      listTagsByUser(request.user.id)
    ]);

    return { folders, tags };
  });

  app.post<{ Body: { name?: string } }>('/api/account-folders', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      await guardWriteByIp(request.ip);
      const body = request.body ?? {};
      const name = normalizeOrganizationName(body.name ?? '');
      const result = await execute('INSERT INTO account_folders (user_id, name) VALUES (?, ?)', [
        request.user.id,
        name
      ]);

      return {
        folder: await getFolderByOwner(request.user.id, Number(result.insertId))
      };
    } catch (error: any) {
      const statusCode = error.message?.includes('Too many requests') ? 429 : 400;
      return reply.code(statusCode).send({ message: organizationErrorMessage('Folder', error) });
    }
  });

  app.patch<{ Params: { folderId: string }; Body: { name?: string } }>(
    '/api/account-folders/:folderId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const folderId = Number(request.params.folderId);
      if (!Number.isInteger(folderId) || folderId <= 0) {
        return reply.code(400).send({ message: 'Invalid folder id' });
      }

      try {
        await guardWriteByIp(request.ip);
        const body = request.body ?? {};
        const name = normalizeOrganizationName(body.name ?? '');
        await getFolderByOwner(request.user.id, folderId);
        await execute('UPDATE account_folders SET name = ? WHERE id = ? AND user_id = ?', [
          name,
          folderId,
          request.user.id
        ]);

        return {
          folder: await getFolderByOwner(request.user.id, folderId)
        };
      } catch (error: any) {
        const statusCode = error.message === 'Folder not found'
          ? 404
          : error.message?.includes('Too many requests')
            ? 429
            : 400;
        return reply.code(statusCode).send({ message: organizationErrorMessage('Folder', error) });
      }
    }
  );

  app.delete<{ Params: { folderId: string } }>(
    '/api/account-folders/:folderId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const folderId = Number(request.params.folderId);
      if (!Number.isInteger(folderId) || folderId <= 0) {
        return reply.code(400).send({ message: 'Invalid folder id' });
      }

      try {
        await guardWriteByIp(request.ip);
        await getFolderByOwner(request.user.id, folderId);
        await execute('UPDATE user_accounts SET folder_id = NULL WHERE user_id = ? AND folder_id = ?', [
          request.user.id,
          folderId
        ]);
        await execute('DELETE FROM account_folders WHERE id = ? AND user_id = ?', [folderId, request.user.id]);
        return { success: true };
      } catch (error: any) {
        const statusCode = error.message === 'Folder not found'
          ? 404
          : error.message?.includes('Too many requests')
            ? 429
            : 400;
        return reply.code(statusCode).send({ message: organizationErrorMessage('Folder', error) });
      }
    }
  );

  app.post<{ Body: { name?: string } }>('/api/account-tags', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      await guardWriteByIp(request.ip);
      const body = request.body ?? {};
      const name = normalizeOrganizationName(body.name ?? '');
      const result = await execute('INSERT INTO account_tags (user_id, name) VALUES (?, ?)', [
        request.user.id,
        name
      ]);

      return {
        tag: await getTagByOwner(request.user.id, Number(result.insertId))
      };
    } catch (error: any) {
      const statusCode = error.message?.includes('Too many requests') ? 429 : 400;
      return reply.code(statusCode).send({ message: organizationErrorMessage('Tag', error) });
    }
  });

  app.patch<{ Params: { tagId: string }; Body: { name?: string } }>(
    '/api/account-tags/:tagId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const tagId = Number(request.params.tagId);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return reply.code(400).send({ message: 'Invalid tag id' });
      }

      try {
        await guardWriteByIp(request.ip);
        const body = request.body ?? {};
        const name = normalizeOrganizationName(body.name ?? '');
        await getTagByOwner(request.user.id, tagId);
        await execute('UPDATE account_tags SET name = ? WHERE id = ? AND user_id = ?', [
          name,
          tagId,
          request.user.id
        ]);

        return {
          tag: await getTagByOwner(request.user.id, tagId)
        };
      } catch (error: any) {
        const statusCode = error.message === 'Tag not found'
          ? 404
          : error.message?.includes('Too many requests')
            ? 429
            : 400;
        return reply.code(statusCode).send({ message: organizationErrorMessage('Tag', error) });
      }
    }
  );

  app.delete<{ Params: { tagId: string } }>(
    '/api/account-tags/:tagId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const tagId = Number(request.params.tagId);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return reply.code(400).send({ message: 'Invalid tag id' });
      }

      try {
        await guardWriteByIp(request.ip);
        await getTagByOwner(request.user.id, tagId);
        await execute('DELETE FROM account_tag_assignments WHERE tag_id = ?', [tagId]);
        await execute('DELETE FROM account_tags WHERE id = ? AND user_id = ?', [tagId, request.user.id]);
        return { success: true };
      } catch (error: any) {
        const statusCode = error.message === 'Tag not found'
          ? 404
          : error.message?.includes('Too many requests')
            ? 429
            : 400;
        return reply.code(statusCode).send({ message: organizationErrorMessage('Tag', error) });
      }
    }
  );

  app.patch<{
    Params: { accountId: string };
    Body: { folderId?: number | null; tagIds?: number[] };
  }>('/api/accounts/:accountId/organization', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = Number(request.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return reply.code(400).send({ message: 'Invalid account id' });
    }

    const accountRows = await queryRows<{ id: number }[]>(
      'SELECT id FROM user_accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [accountId, request.user.id]
    );
    if (!accountRows[0]) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const body = request.body ?? {};
    const hasFolderUpdate = Object.prototype.hasOwnProperty.call(body, 'folderId');
    const hasTagUpdate = Array.isArray(body.tagIds);
    if (!hasFolderUpdate && !hasTagUpdate) {
      return reply.code(400).send({ message: 'No organization changes provided' });
    }

    try {
      await guardWriteByIp(request.ip);
      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        if (hasFolderUpdate) {
          if (body.folderId === null) {
            await connection.execute('UPDATE user_accounts SET folder_id = NULL WHERE id = ? AND user_id = ?', [
              accountId,
              request.user.id
            ]);
          } else {
            const folderId = Number(body.folderId);
            if (!Number.isInteger(folderId) || folderId <= 0) {
              throw new Error('Invalid folder id');
            }

            await getFolderByOwner(request.user.id, folderId);
            await connection.execute('UPDATE user_accounts SET folder_id = ? WHERE id = ? AND user_id = ?', [
              folderId,
              accountId,
              request.user.id
            ]);
          }
        }

        if (hasTagUpdate) {
          const tagIds = normalizeOrganizationTagIds(body.tagIds ?? []);
          if (tagIds.length > 0) {
            const placeholders = tagIds.map(() => '?').join(', ');
            const ownedTags = await queryRows<{ id: number }[]>(
              `SELECT id FROM account_tags WHERE user_id = ? AND id IN (${placeholders})`,
              [request.user.id, ...tagIds]
            );

            if (ownedTags.length !== tagIds.length) {
              throw new Error('One or more tags are invalid');
            }
          }

          await connection.execute('DELETE FROM account_tag_assignments WHERE account_id = ?', [accountId]);
          if (tagIds.length > 0) {
            const values = tagIds.map(() => '(?, ?)').join(', ');
            const params = tagIds.flatMap((tagId) => [accountId, tagId]);
            await connection.execute(
              `INSERT INTO account_tag_assignments (account_id, tag_id) VALUES ${values}`,
              params
            );
          }
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      return { success: true };
    } catch (error: any) {
      const statusCode = error.message === 'Folder not found'
        ? 404
        : error.message?.includes('Too many requests')
          ? 429
          : 400;
      return reply.code(statusCode).send({ message: error?.message || 'Failed to update account organization' });
    }
  });
};

export default accountOrganizationRoutes;
