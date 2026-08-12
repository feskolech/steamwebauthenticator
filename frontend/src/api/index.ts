import { apiClient } from './client';
import type {
  Account,
  AdminLogItem,
  AccountFolder,
  AccountTag,
  ConfirmationQueueItem,
  LogItem,
  NotificationItem,
  RegistrationInvite,
  UserWebhook,
  User
} from '../types';

export const authApi = {
  me: () => apiClient.get<{ user: User }>('/api/auth/me'),
  registerChallenge: () =>
    apiClient.get<{ token: string; minFillMs: number; expiresInSec: number }>('/api/auth/register/challenge'),
  reauthenticate: (password: string) => apiClient.post<{ success: boolean }>('/api/auth/reauth', { password }),
  login: (email: string, password: string) =>
    apiClient.post<{ user?: User; requires2fa?: boolean; method?: 'telegram' | 'totp'; message?: string }>('/api/auth/login', {
      email,
      password
    }),
  register: (
    email: string,
    password: string,
    registrationChallenge: string,
    inviteCode?: string,
    company = '',
    turnstileToken?: string
  ) =>
    apiClient.post<{ user: User }>('/api/auth/register', {
      email,
      password,
      registrationChallenge,
      inviteCode,
      company,
      turnstileToken
    }),
  verifyTelegram2fa: (email: string, code: string) =>
    apiClient.post<{ user: User }>('/api/auth/login/verify-telegram', { email, code }),
  verifyTotp2fa: (email: string, code: string) =>
    apiClient.post<{ user: User }>('/api/auth/login/verify-totp', { email, code }),
  verifyRecoveryCode: (email: string, password: string, recoveryCode: string) =>
    apiClient.post<{ user: User }>('/api/auth/login/recovery', { email, password, recoveryCode }),
  logout: () => apiClient.post<{ success: boolean }>('/api/auth/logout'),
  startTelegramOAuth: () =>
    apiClient.post<{
      code: string;
      pollSecret: string;
      deepLink: string | null;
      manualCommand: string;
      startParam: string;
      expiresInSec: number;
    }>('/api/auth/telegram/oauth/start'),
  pollTelegramOAuth: (code: string, token: string) =>
    apiClient.get<{ status: string; user?: User }>(`/api/auth/telegram/oauth/poll/${code}`, {
      headers: {
        'x-telegram-poll-token': token
      }
    }),
  webauthnLoginOptions: (email?: string) =>
    apiClient.post<Record<string, unknown>>('/api/auth/webauthn/login/options', email ? { email } : {}),
  webauthnLoginVerify: (response: unknown, options?: { email?: string; challenge?: string }) =>
    apiClient.post<{ user: User }>('/api/auth/webauthn/login/verify', {
      response,
      email: options?.email,
      challenge: options?.challenge
    }),
  webauthnRegisterOptions: () => apiClient.post<Record<string, unknown>>('/api/auth/webauthn/register/options'),
  webauthnRegisterVerify: (response: unknown) =>
    apiClient.post<{ verified: boolean }>('/api/auth/webauthn/register/verify', { response })
};

export const accountApi = {
  list: () => apiClient.get<{ items: Account[] }>('/api/accounts'),
  liveCodes: () =>
    apiClient.get<{
      generatedAt: string;
      validForSec: number;
      items: Array<{ accountId: number; code: string }>;
    }>('/api/accounts/live-codes'),
  get: (accountId: number) => apiClient.get<Account>(`/api/accounts/${accountId}`),
  import: async (file: File, alias?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (alias) {
      form.append('alias', alias);
    }

    const csrf = await apiClient.refreshCsrfToken();
    const response = await apiClient.raw.post('/api/accounts/import', form, {
      withCredentials: true,
      headers: {
        'csrf-token': csrf
      }
    });
    return response.data;
  },
  update: (
    accountId: number,
    data: Partial<
      Pick<
        Account,
        'alias' | 'autoConfirm' | 'autoConfirmTrades' | 'autoConfirmTradeMode' | 'autoConfirmLogins' | 'autoConfirmDelaySec'
      >
    >
  ) =>
    apiClient.patch<{ success: boolean }>(`/api/accounts/${accountId}`, data),
  delete: (accountId: number) => apiClient.delete<{ success: boolean }>(`/api/accounts/${accountId}`),
  code: (accountId: number) => apiClient.get<{ code: string; generatedAt: string }>(`/api/accounts/${accountId}/code`),
  export: async (accountId: number, alias: string) => {
    const response = await apiClient.raw.get(`/api/accounts/${accountId}/export`, {
      responseType: 'blob',
      withCredentials: true
    });

    const blob = new Blob([response.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${alias}.maFile`;
    link.click();
    URL.revokeObjectURL(url);
  },
  enrollStart: (payload: { accountName: string; password: string; guardCode?: string }) =>
    apiClient.post<{
      pendingId: string;
      accountName: string;
      steamid: string;
      expiresInSec: number;
      message: string;
    }>('/api/accounts/enroll/start', payload),
  enrollFinish: (payload: { pendingId: string; activationCode: string; alias?: string }) =>
    apiClient.post<{
      id: number;
      alias: string;
      accountName: string;
      steamid: string;
      source: 'credentials';
      hasRecoveryCode: boolean;
      recoveryCode: string | null;
    }>('/api/accounts/enroll/finish', payload),
  getRecoveryCode: (accountId: number) =>
    apiClient.get<{ recoveryCode: string }>(`/api/accounts/${accountId}/recovery-code`),
  setSession: (
    accountId: number,
    data: { steamLoginSecure?: string; sessionid?: string; oauthToken?: string; refreshToken?: string; steamid?: string }
  ) => apiClient.post<{ success: boolean }>(`/api/accounts/${accountId}/session`, data),
  reconnect: (accountId: number, payload: { password: string; guardCode?: string }) =>
    apiClient.post<{ success: boolean; steamid: string }>(`/api/accounts/${accountId}/reconnect`, payload)
};

export const accountOrganizationApi = {
  get: () => apiClient.get<{ folders: AccountFolder[]; tags: AccountTag[] }>('/api/account-organization'),
  createFolder: (name: string) => apiClient.post<{ folder: AccountFolder }>('/api/account-folders', { name }),
  renameFolder: (folderId: number, name: string) =>
    apiClient.patch<{ folder: AccountFolder }>(`/api/account-folders/${folderId}`, { name }),
  deleteFolder: (folderId: number) => apiClient.delete<{ success: boolean }>(`/api/account-folders/${folderId}`),
  createTag: (name: string) => apiClient.post<{ tag: AccountTag }>('/api/account-tags', { name }),
  renameTag: (tagId: number, name: string) =>
    apiClient.patch<{ tag: AccountTag }>(`/api/account-tags/${tagId}`, { name }),
  deleteTag: (tagId: number) => apiClient.delete<{ success: boolean }>(`/api/account-tags/${tagId}`),
  updateAccount: (accountId: number, payload: { folderId?: number | null; tagIds?: number[] }) =>
    apiClient.patch<{ success: boolean }>(`/api/accounts/${accountId}/organization`, payload)
};

export const steamApi = {
  trades: (accountId: number) => apiClient.get<{ items: any[] }>(`/api/steamauth/${accountId}/trades`),
  logins: (accountId: number) => apiClient.get<{ items: any[] }>(`/api/steamauth/${accountId}/logins`),
  queue: (accountId: number) =>
    apiClient.get<{ items: ConfirmationQueueItem[] }>(`/api/steamauth/${accountId}/queue`),
  confirmTrade: (accountId: number, confirmationId: string, nonce?: string) =>
    apiClient.post<{ success: boolean }>(`/api/steamauth/${accountId}/trades/${confirmationId}/confirm`, {
      nonce
    }),
  rejectTrade: (accountId: number, confirmationId: string, nonce?: string) =>
    apiClient.post<{ success: boolean }>(`/api/steamauth/${accountId}/trades/${confirmationId}/reject`, {
      nonce
    }),
  confirmLogin: (accountId: number, confirmationId: string, nonce?: string) =>
    apiClient.post<{ success: boolean }>(`/api/steamauth/${accountId}/logins/${confirmationId}/confirm`, {
      nonce
    }),
  rejectLogin: (accountId: number, confirmationId: string, nonce?: string) =>
    apiClient.post<{ success: boolean }>(`/api/steamauth/${accountId}/logins/${confirmationId}/reject`, {
      nonce
    })
};

export const settingsApi = {
  get: () =>
    apiClient.get<{
      language: 'en' | 'ru';
      theme: 'light' | 'dark';
      twofaMethod: 'none' | 'telegram' | 'webauthn' | 'totp';
      hasTotpSecret: boolean;
      hasPasskeys: boolean;
      hasRecoveryCodes: boolean;
      telegramLinked: boolean;
      telegramUsername: string | null;
      telegramNotifyLoginCodes: boolean;
      apiKeyLast4: string | null;
    }>('/api/settings'),
  update: (payload: {
    language?: 'en' | 'ru';
    theme?: 'light' | 'dark';
    twofaMethod?: 'none' | 'telegram' | 'webauthn' | 'totp';
    telegramNotifyLoginCodes?: boolean;
  }) => apiClient.patch<{ success: boolean }>('/api/settings', payload),
  startTotpSetup: () =>
    apiClient.post<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string; expiresInSec: number }>('/api/settings/totp/setup'),
  verifyTotpSetup: (code: string) => apiClient.post<{ success: boolean }>('/api/settings/totp/verify', { code }),
  regenerateRecoveryCodes: () => apiClient.post<{ codes: string[] }>('/api/settings/recovery-codes/regenerate'),
  generateTelegramCode: () =>
    apiClient.post<{ code: string; command: string; expiresInSec: number }>('/api/settings/telegram/link-code'),
  unlinkTelegram: () => apiClient.delete<{ success: boolean }>('/api/settings/telegram'),
  regenerateApiKey: () => apiClient.post<{ apiKey: string }>('/api/settings/api-key'),
  webhooks: () => apiClient.get<{ items: UserWebhook[] }>('/api/settings/webhooks'),
  createWebhook: (payload: {
    name: string;
    url: string;
    targetType: 'generic' | 'discord';
    eventTypes: string[];
  }) => apiClient.post<{ webhook: UserWebhook }>('/api/settings/webhooks', payload),
  deleteWebhook: (webhookId: number) => apiClient.delete<{ success: boolean }>(`/api/settings/webhooks/${webhookId}`),
  testWebhook: (webhookId: number) => apiClient.post<{ success: boolean }>(`/api/settings/webhooks/${webhookId}/test`)
};

export const logApi = {
  list: (accountId?: number, scope: 'all' | 'steam' | 'auth' | 'security' = 'all') =>
    apiClient.get<{ items: LogItem[] }>('/api/logs', {
      params: {
        ...(accountId ? { accountId } : {}),
        scope,
        limit: 200
      }
    })
};

export const adminApi = {
  overview: () => apiClient.get<{ users: number; accounts: number }>('/api/admin/overview'),
  settings: () =>
    apiClient.get<{
      registrationEnabled: boolean;
      registrationMode: 'open' | 'disabled' | 'domain_allowlist';
      registrationMode: 'open' | 'disabled' | 'domain_allowlist' | 'invite_only';
      allowedEmailDomains: string[];
      updatedAt: string | null;
    }>('/api/admin/settings'),
  updateSettings: (payload: {
    registrationEnabled: boolean;
    registrationMode: 'open' | 'disabled' | 'domain_allowlist' | 'invite_only';
    allowedEmailDomains?: string[];
  }) => apiClient.patch<{ success: boolean }>('/api/admin/settings', payload),
  users: () =>
    apiClient.get<{ items: Array<{ id: number; email: string; role: string; twofaMethod: string }> }>('/api/admin/users')
  ,
  invites: () => apiClient.get<{ items: RegistrationInvite[] }>('/api/admin/invites'),
  createInvite: (payload?: { note?: string; expiresInDays?: number }) =>
    apiClient.post<{ invite: { id: number; code: string; note: string | null; expiresInDays: number } }>('/api/admin/invites', payload ?? {}),
  deleteInvite: (inviteId: number) => apiClient.delete<{ success: boolean }>(`/api/admin/invites/${inviteId}`),
  deleteUser: (userId: number) => apiClient.delete<{ success: boolean }>(`/api/admin/users/${userId}`),
  logs: (params?: { scope?: 'all' | 'steam' | 'auth' | 'security'; userId?: number; accountId?: number; limit?: number }) =>
    apiClient.get<{ items: AdminLogItem[] }>('/api/admin/logs', { params })
};

export const notificationApi = {
  list: () => apiClient.get<{ items: NotificationItem[] }>('/api/notifications'),
  markRead: (id: number) => apiClient.post<{ success: boolean }>(`/api/notifications/${id}/read`)
};
