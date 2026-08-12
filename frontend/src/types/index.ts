export type User = {
  id: number;
  email: string;
  role: 'user' | 'admin';
  language: 'en' | 'ru';
  theme: 'light' | 'dark';
  telegramLinked: boolean;
  telegramUsername: string | null;
  twofaMethod: 'none' | 'telegram' | 'webauthn' | 'totp';
  hasTotpSecret: boolean;
  hasPasskeys: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  isActive: boolean;
};

export type Account = {
  id: number;
  alias: string;
  accountName: string;
  steamid: string | null;
  source?: 'mafile' | 'credentials';
  autoConfirm?: boolean;
  autoConfirmTrades: boolean;
  autoConfirmTradeMode: 'all' | 'incoming_only';
  autoConfirmLogins: boolean;
  autoConfirmDelaySec: number;
  lastCode: string | null;
  lastActive: string | null;
  folderId?: number | null;
  folderName?: string | null;
  tags?: AccountTag[];
  hasRecoveryCode?: boolean;
  createdAt?: string;
};

export type AccountFolder = {
  id: number;
  name: string;
  createdAt: string;
};

export type AccountTag = {
  id: number;
  name: string;
  createdAt: string;
};

export type UserWebhook = {
  id: number;
  name: string;
  targetType: 'generic' | 'discord';
  url: string;
  eventTypes: Array<'trade' | 'login' | 'steam_session_expired'>;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LogItem = {
  id: number;
  userId?: number | null;
  userEmail?: string | null;
  accountId: number | null;
  accountAlias: string | null;
  type: 'trade' | 'login' | 'code' | 'system';
  category: 'steam' | 'auth' | 'security';
  eventKey: string;
  context: Record<string, string | number | boolean | null>;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AdminLogItem = LogItem & {
  userId: number | null;
  userEmail: string | null;
};

export type RegistrationInvite = {
  id: number;
  code: string;
  note: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  createdByEmail: string;
  usedByEmail: string | null;
};

export type NotificationItem = {
  id: number;
  channel: 'web' | 'telegram' | 'email';
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type ConfirmationQueueItem = {
  confirmation_id: string;
  nonce: string;
  kind: string;
  headline: string;
  summary: string;
  status: string;
  created_at: string;
  updated_at: string;
};
