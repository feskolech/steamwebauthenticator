export type User = {
  id: number;
  email: string;
  role: 'user' | 'admin';
  language: 'en' | 'ru';
  theme: 'light' | 'dark';
  steamUserId: string | null;
  telegramLinked: boolean;
  telegramUsername: string | null;
  twofaMethod: 'none' | 'telegram' | 'webauthn';
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
  autoConfirmLogins: boolean;
  autoConfirmDelaySec: number;
  lastCode: string | null;
  lastActive: string | null;
  hasRecoveryCode?: boolean;
  createdAt?: string;
};

export type LogItem = {
  id: number;
  accountId: number | null;
  accountAlias: string | null;
  type: 'trade' | 'login' | 'code' | 'system';
  category: 'steam' | 'auth' | 'security';
  eventKey: string;
  context: Record<string, string | number | boolean | null>;
  details: Record<string, unknown>;
  createdAt: string;
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
