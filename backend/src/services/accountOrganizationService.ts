import { queryRows } from '../db/pool';

export type AccountFolder = {
  id: number;
  name: string;
  createdAt: Date;
};

export type AccountTag = {
  id: number;
  name: string;
  createdAt: Date;
};

type AccountFolderRow = {
  id: number;
  name: string;
  created_at: Date;
};

type AccountTagRow = {
  id: number;
  name: string;
  created_at: Date;
};

type AccountTagAssignmentRow = {
  account_id: number;
  tag_id: number;
  tag_name: string;
  tag_created_at: Date;
};

export async function listFoldersByUser(userId: number): Promise<AccountFolder[]> {
  const rows = await queryRows<AccountFolderRow[]>(
    `SELECT id, name, created_at
     FROM account_folders
     WHERE user_id = ?
     ORDER BY name ASC, id ASC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at
  }));
}

export async function listTagsByUser(userId: number): Promise<AccountTag[]> {
  const rows = await queryRows<AccountTagRow[]>(
    `SELECT id, name, created_at
     FROM account_tags
     WHERE user_id = ?
     ORDER BY name ASC, id ASC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at
  }));
}

export async function listAccountTagsByAccountIds(
  userId: number,
  accountIds: number[]
): Promise<Map<number, AccountTag[]>> {
  const map = new Map<number, AccountTag[]>();
  if (accountIds.length === 0) {
    return map;
  }

  const placeholders = accountIds.map(() => '?').join(', ');
  const rows = await queryRows<AccountTagAssignmentRow[]>(
    `SELECT ata.account_id, t.id AS tag_id, t.name AS tag_name, t.created_at AS tag_created_at
     FROM account_tag_assignments ata
     JOIN account_tags t ON t.id = ata.tag_id
     JOIN user_accounts a ON a.id = ata.account_id
     WHERE a.user_id = ?
       AND ata.account_id IN (${placeholders})
     ORDER BY t.name ASC, t.id ASC`,
    [userId, ...accountIds]
  );

  for (const row of rows) {
    const current = map.get(row.account_id) ?? [];
    current.push({
      id: row.tag_id,
      name: row.tag_name,
      createdAt: row.tag_created_at
    });
    map.set(row.account_id, current);
  }

  return map;
}
