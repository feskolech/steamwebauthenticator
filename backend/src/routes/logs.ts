import type { FastifyPluginAsync } from 'fastify';
import { queryRows } from '../db/pool';

type LogScope = 'all' | 'steam' | 'auth' | 'security';
type LogCategory = Exclude<LogScope, 'all'>;

type LogRow = {
  id: number;
  account_id: number | null;
  alias: string | null;
  type: 'trade' | 'login' | 'code' | 'system';
  details: unknown;
  created_at: Date;
};

type UserLogItem = {
  id: number;
  accountId: number | null;
  accountAlias: string | null;
  type: LogRow['type'];
  category: LogCategory;
  eventKey: string;
  context: Record<string, string | number | boolean | null>;
  createdAt: Date;
  details: Record<string, unknown>;
};

function parseScope(value: string | undefined): LogScope {
  if (value === 'steam' || value === 'auth' || value === 'security') {
    return value;
  }
  return 'all';
}

function normalizeDetails(input: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return {};
}

function mapLoginEvent(row: LogRow, details: Record<string, unknown>): UserLogItem {
  const method = typeof details.method === 'string' ? details.method : null;
  const action = typeof details.action === 'string' ? details.action : null;
  const confirmationId =
    typeof details.confirmationId === 'string' ? details.confirmationId : null;

  if (method === 'password') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'auth',
      eventKey: 'auth.login.password',
      context: {},
      createdAt: row.created_at,
      details: { method: 'password' }
    };
  }

  if (method === 'telegram_2fa') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'auth',
      eventKey: 'auth.login.telegram2fa',
      context: {},
      createdAt: row.created_at,
      details: { method: 'telegram_2fa' }
    };
  }

  if (method === 'telegram_oauth') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'auth',
      eventKey: 'auth.login.telegramOAuth',
      context: {},
      createdAt: row.created_at,
      details: { method: 'telegram_oauth' }
    };
  }

  if (method === 'webauthn') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'auth',
      eventKey: 'auth.login.passkey',
      context: {},
      createdAt: row.created_at,
      details: { method: 'webauthn' }
    };
  }

  if (action === 'incoming') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'steam',
      eventKey: 'steam.login.incoming',
      context: {
        confirmationId
      },
      createdAt: row.created_at,
      details: {
        action: 'incoming',
        confirmationId,
        headline: details.headline ?? null,
        summary: details.summary ?? null
      }
    };
  }

  if (action === 'auto_confirm') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'steam',
      eventKey: 'steam.login.autoConfirmed',
      context: {
        confirmationId
      },
      createdAt: row.created_at,
      details: {
        action: 'auto_confirm',
        confirmationId,
        headline: details.headline ?? null,
        summary: details.summary ?? null
      }
    };
  }

  if (action === 'confirm') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'steam',
      eventKey: 'steam.login.confirmed',
      context: {
        confirmationId
      },
      createdAt: row.created_at,
      details: {
        action: 'confirm',
        confirmationId,
        headline: details.headline ?? null,
        summary: details.summary ?? null
      }
    };
  }

  if (action === 'reject') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'steam',
      eventKey: 'steam.login.rejected',
      context: {
        confirmationId
      },
      createdAt: row.created_at,
      details: {
        action: 'reject',
        confirmationId,
        headline: details.headline ?? null,
        summary: details.summary ?? null
      }
    };
  }

  return {
    id: row.id,
    accountId: row.account_id,
    accountAlias: row.alias,
    type: row.type,
    category: 'auth',
    eventKey: 'auth.login.unknown',
    context: {},
    createdAt: row.created_at,
    details: {}
  };
}

function mapTradeEvent(row: LogRow, details: Record<string, unknown>): UserLogItem {
  const action = typeof details.action === 'string' ? details.action : null;
  const confirmationId =
    typeof details.confirmationId === 'string' ? details.confirmationId : null;

  const actionToEvent: Record<string, string> = {
    confirm: 'steam.trade.confirmed',
    reject: 'steam.trade.rejected',
    auto_confirm: 'steam.trade.autoConfirmed',
    incoming: 'steam.trade.incoming'
  };

  return {
    id: row.id,
    accountId: row.account_id,
    accountAlias: row.alias,
    type: row.type,
    category: 'steam',
    eventKey: action && actionToEvent[action] ? actionToEvent[action] : 'steam.trade.updated',
    context: {
      confirmationId
    },
    createdAt: row.created_at,
    details: {
      action: action ?? 'unknown',
      confirmationId,
      headline: details.headline ?? null,
      summary: details.summary ?? null
    }
  };
}

function mapSystemEvent(
  row: LogRow,
  details: Record<string, unknown>
): UserLogItem | null {
  const event = typeof details.event === 'string' ? details.event : '';

  const systemMap: Record<
    string,
    {
      category: LogCategory;
      eventKey: string;
      allowedDetails: string[];
      context: (input: Record<string, unknown>) => Record<string, string | number | boolean | null>;
    }
  > = {
    ma_import: {
      category: 'steam',
      eventKey: 'steam.account.imported',
      allowedDetails: ['event'],
      context: () => ({})
    },
    account_deleted: {
      category: 'steam',
      eventKey: 'steam.account.deleted',
      allowedDetails: ['event'],
      context: () => ({})
    },
    session_updated: {
      category: 'steam',
      eventKey: 'steam.session.updated',
      allowedDetails: ['event'],
      context: () => ({})
    },
    session_expired: {
      category: 'steam',
      eventKey: 'steam.session.expired',
      allowedDetails: ['event'],
      context: () => ({})
    },
    steam_enroll_started: {
      category: 'steam',
      eventKey: 'steam.enroll.started',
      allowedDetails: ['event', 'steamid', 'accountName'],
      context: (input) => ({
        steamid: typeof input.steamid === 'string' ? input.steamid : null
      })
    },
    steam_enroll_completed: {
      category: 'steam',
      eventKey: 'steam.enroll.completed',
      allowedDetails: ['event', 'steamid', 'accountName'],
      context: (input) => ({
        steamid: typeof input.steamid === 'string' ? input.steamid : null
      })
    },
    settings_updated: {
      category: 'security',
      eventKey: 'security.settings.updated',
      allowedDetails: ['event'],
      context: () => ({})
    },
    api_key_regenerated: {
      category: 'security',
      eventKey: 'security.apiKey.regenerated',
      allowedDetails: ['event'],
      context: () => ({})
    }
  };

  const mapped = systemMap[event];
  if (!mapped) {
    return null;
  }

  const safeDetails: Record<string, unknown> = {};
  for (const key of mapped.allowedDetails) {
    if (details[key] !== undefined) {
      safeDetails[key] = details[key];
    }
  }

  return {
    id: row.id,
    accountId: row.account_id,
    accountAlias: row.alias,
    type: row.type,
    category: mapped.category,
    eventKey: mapped.eventKey,
    context: mapped.context(details),
    createdAt: row.created_at,
    details: safeDetails
  };
}

function mapLogRow(row: LogRow): UserLogItem | null {
  const details = normalizeDetails(row.details);

  if (row.type === 'login') {
    return mapLoginEvent(row, details);
  }

  if (row.type === 'trade') {
    return mapTradeEvent(row, details);
  }

  if (row.type === 'code') {
    return {
      id: row.id,
      accountId: row.account_id,
      accountAlias: row.alias,
      type: row.type,
      category: 'steam',
      eventKey: 'steam.code.generated',
      context: {
        source: typeof details.source === 'string' ? details.source : null
      },
      createdAt: row.created_at,
      details: {
        source: typeof details.source === 'string' ? details.source : 'unknown'
      }
    };
  }

  return mapSystemEvent(row, details);
}

const logsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { limit?: string; accountId?: string; scope?: string };
  }>('/api/logs', { preHandler: app.authenticate }, async (request) => {
    const limit = Math.min(300, Math.max(1, Number(request.query.limit ?? 100)));
    const accountId = request.query.accountId ? Number(request.query.accountId) : null;
    const scope = parseScope(request.query.scope);

    const params: unknown[] = [request.user.id];
    let where = 'WHERE l.user_id = ?';

    if (accountId) {
      where += ' AND l.account_id = ?';
      params.push(accountId);
    }

    params.push(Math.max(limit * 3, 100));

    const rows = await queryRows<LogRow[]>(
      `SELECT l.id, l.account_id, l.type, l.details, l.created_at, a.alias
       FROM logs l
       LEFT JOIN user_accounts a ON a.id = l.account_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ?`,
      params
    );

    const mapped = rows.map(mapLogRow).filter(Boolean) as UserLogItem[];
    const filtered =
      scope === 'all' ? mapped : mapped.filter((item) => item.category === scope);

    return {
      items: filtered.slice(0, limit)
    };
  });
};

export default logsRoutes;
