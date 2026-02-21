import { apiClient } from './client';
import type { Account, ConfirmationQueueItem, LogItem, NotificationItem, User } from '../types';

export const authApi = {
  me: () => apiClient.get<{ user: User }>('/api/auth/me'),
  login: (email: string, password: string) =>
    apiClient.post<{ user?: User; requires2fa?: boolean; method?: string; message?: string }>('/api/auth/login', {
      email,
      password
    }),
  register: (email: string, password: string) =>
    apiClient.post<{ user: User }>('/api/auth/register', { email, password }),
  verifyTelegram2fa: (email: string, code: string) =>
    apiClient.post<{ user: User }>('/api/auth/login/verify-telegram', { email, code }),
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
  webauthnLoginOptions: (email: string) =>
    apiClient.post<Record<string, unknown>>('/api/auth/webauthn/login/options', { email }),
  webauthnLoginVerify: (email: string, response: unknown) =>
    apiClient.post<{ user: User }>('/api/auth/webauthn/login/verify', { email, response }),
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
      Pick<Account, 'alias' | 'autoConfirm' | 'autoConfirmTrades' | 'autoConfirmLogins' | 'autoConfirmDelaySec'>
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
  setSession: (accountId: number, data: Record<string, string>) =>
    apiClient.post<{ success: boolean }>(`/api/accounts/${accountId}/session`, data)
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
      steamUserId: string | null;
      twofaMethod: 'none' | 'telegram' | 'webauthn';
      telegramLinked: boolean;
      telegramUsername: string | null;
      telegramNotifyLoginCodes: boolean;
      apiKeyLast4: string | null;
    }>('/api/settings'),
  update: (payload: {
    language?: 'en' | 'ru';
    theme?: 'light' | 'dark';
    steamUserId?: string | null;
    twofaMethod?: 'none' | 'telegram' | 'webauthn';
    telegramNotifyLoginCodes?: boolean;
  }) => apiClient.patch<{ success: boolean }>('/api/settings', payload),
  generateTelegramCode: () =>
    apiClient.post<{ code: string; command: string; expiresInSec: number }>('/api/settings/telegram/link-code'),
  unlinkTelegram: () => apiClient.delete<{ success: boolean }>('/api/settings/telegram'),
  regenerateApiKey: () => apiClient.post<{ apiKey: string }>('/api/settings/api-key')
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
  settings: () => apiClient.get<{ registrationEnabled: boolean; updatedAt: string | null }>('/api/admin/settings'),
  updateSettings: (registrationEnabled: boolean) =>
    apiClient.patch<{ success: boolean }>('/api/admin/settings', { registrationEnabled }),
  users: () =>
    apiClient.get<{ items: Array<{ id: number; email: string; role: string; twofaMethod: string }> }>('/api/admin/users')
};

export const notificationApi = {
  list: () => apiClient.get<{ items: NotificationItem[] }>('/api/notifications'),
  markRead: (id: number) => apiClient.post<{ success: boolean }>(`/api/notifications/${id}/read`)
};
