export type LogScope = 'all' | 'steam' | 'auth' | 'security';
export type LogCategory = Exclude<LogScope, 'all'>;

export type LogRow = {
  id: number;
  user_id: number | null;
  user_email?: string | null;
  account_id: number | null;
  alias: string | null;
  type: 'trade' | 'login' | 'code' | 'system';
  details: unknown;
  created_at: Date;
};

export type LogViewItem = {
  id: number;
  userId: number | null;
  userEmail: string | null;
  accountId: number | null;
  accountAlias: string | null;
  type: LogRow['type'];
  category: LogCategory;
  eventKey: string;
  context: Record<string, string | number | boolean | null>;
  createdAt: Date;
  details: Record<string, unknown>;
};

export function parseScope(value: string | undefined): LogScope {
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

function createBase(row: LogRow, category: LogCategory, eventKey: string): LogViewItem {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    accountId: row.account_id,
    accountAlias: row.alias,
    type: row.type,
    category,
    eventKey,
    context: {},
    createdAt: row.created_at,
    details: {}
  };
}

function mapLoginEvent(row: LogRow, details: Record<string, unknown>): LogViewItem {
  const method = typeof details.method === 'string' ? details.method : null;
  const action = typeof details.action === 'string' ? details.action : null;
  const confirmationId = typeof details.confirmationId === 'string' ? details.confirmationId : null;

  if (method === 'password') {
    return { ...createBase(row, 'auth', 'auth.login.password'), details: { method: 'password' } };
  }
  if (method === 'telegram_2fa') {
    return { ...createBase(row, 'auth', 'auth.login.telegram2fa'), details: { method: 'telegram_2fa' } };
  }
  if (method === 'telegram_oauth') {
    return { ...createBase(row, 'auth', 'auth.login.telegramOAuth'), details: { method: 'telegram_oauth' } };
  }
  if (method === 'webauthn') {
    return { ...createBase(row, 'auth', 'auth.login.passkey'), details: { method: 'webauthn' } };
  }
  if (method === 'totp') {
    return { ...createBase(row, 'auth', 'auth.login.totp'), details: { method: 'totp' } };
  }

  const actionToEvent: Record<string, string> = {
    incoming: 'steam.login.incoming',
    auto_confirm: 'steam.login.autoConfirmed',
    confirm: 'steam.login.confirmed',
    reject: 'steam.login.rejected'
  };

  if (action && actionToEvent[action]) {
    return {
      ...createBase(row, 'steam', actionToEvent[action]),
      context: { confirmationId },
      details: {
        action,
        confirmationId,
        headline: details.headline ?? null,
        summary: details.summary ?? null,
        source: details.source ?? null
      }
    };
  }

  return createBase(row, 'auth', 'auth.login.unknown');
}

function mapTradeEvent(row: LogRow, details: Record<string, unknown>): LogViewItem {
  const action = typeof details.action === 'string' ? details.action : null;
  const confirmationId = typeof details.confirmationId === 'string' ? details.confirmationId : null;
  const actionToEvent: Record<string, string> = {
    confirm: 'steam.trade.confirmed',
    reject: 'steam.trade.rejected',
    auto_confirm: 'steam.trade.autoConfirmed',
    incoming: 'steam.trade.incoming'
  };

  return {
    ...createBase(row, 'steam', action && actionToEvent[action] ? actionToEvent[action] : 'steam.trade.updated'),
    context: { confirmationId },
    details: {
      action: action ?? 'unknown',
      confirmationId,
      headline: details.headline ?? null,
      summary: details.summary ?? null,
      source: details.source ?? null
    }
  };
}

function mapSystemEvent(row: LogRow, details: Record<string, unknown>): LogViewItem | null {
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
    },
    webhook_created: {
      category: 'security',
      eventKey: 'security.webhook.created',
      allowedDetails: ['event', 'targetType', 'name'],
      context: (input) => ({
        targetType: typeof input.targetType === 'string' ? input.targetType : null,
        name: typeof input.name === 'string' ? input.name : null
      })
    },
    webhook_deleted: {
      category: 'security',
      eventKey: 'security.webhook.deleted',
      allowedDetails: ['event', 'webhookId'],
      context: (input) => ({
        webhookId: typeof input.webhookId === 'number' ? input.webhookId : null
      })
    },
    webhook_tested: {
      category: 'security',
      eventKey: 'security.webhook.tested',
      allowedDetails: ['event', 'webhookId'],
      context: (input) => ({
        webhookId: typeof input.webhookId === 'number' ? input.webhookId : null
      })
    },
    invite_created: {
      category: 'security',
      eventKey: 'security.invite.created',
      allowedDetails: ['event', 'inviteId', 'code', 'expiresInDays', 'note'],
      context: (input) => ({
        inviteId: typeof input.inviteId === 'number' ? input.inviteId : null,
        code: typeof input.code === 'string' ? input.code : null,
        expiresInDays: typeof input.expiresInDays === 'number' ? input.expiresInDays : null,
        note: typeof input.note === 'string' ? input.note : null
      })
    },
    invite_deleted: {
      category: 'security',
      eventKey: 'security.invite.deleted',
      allowedDetails: ['event', 'inviteId', 'code'],
      context: (input) => ({
        inviteId: typeof input.inviteId === 'number' ? input.inviteId : null,
        code: typeof input.code === 'string' ? input.code : null
      })
    },
    totp_enabled: {
      category: 'security',
      eventKey: 'security.totp.enabled',
      allowedDetails: ['event'],
      context: () => ({})
    },
    recovery_codes_regenerated: {
      category: 'security',
      eventKey: 'security.recoveryCodes.regenerated',
      allowedDetails: ['event'],
      context: () => ({})
    },
    recovery_code_used: {
      category: 'security',
      eventKey: 'security.recoveryCode.used',
      allowedDetails: ['event'],
      context: () => ({})
    },
    registration_toggle: {
      category: 'security',
      eventKey: 'security.registration.toggled',
      allowedDetails: ['event', 'enabled', 'mode', 'allowedDomains'],
      context: (input) => ({
        enabled: typeof input.enabled === 'boolean' ? input.enabled : null,
        mode: typeof input.mode === 'string' ? input.mode : null,
        allowedDomains: typeof input.allowedDomains === 'string' ? input.allowedDomains : null
      })
    },
    admin_user_deleted: {
      category: 'security',
      eventKey: 'security.admin.userDeleted',
      allowedDetails: ['event', 'targetUserId', 'targetEmail'],
      context: (input) => ({
        targetUserId: typeof input.targetUserId === 'number' ? input.targetUserId : null,
        targetEmail: typeof input.targetEmail === 'string' ? input.targetEmail : null
      })
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
    ...createBase(row, mapped.category, mapped.eventKey),
    context: mapped.context(details),
    details: safeDetails
  };
}

export function mapLogRow(row: LogRow): LogViewItem | null {
  const details = normalizeDetails(row.details);

  if (row.type === 'login') {
    return mapLoginEvent(row, details);
  }
  if (row.type === 'trade') {
    return mapTradeEvent(row, details);
  }
  if (row.type === 'code') {
    return {
      ...createBase(row, 'steam', 'steam.code.generated'),
      context: {
        source: typeof details.source === 'string' ? details.source : null
      },
      details: {
        source: typeof details.source === 'string' ? details.source : 'unknown'
      }
    };
  }

  return mapSystemEvent(row, details);
}
