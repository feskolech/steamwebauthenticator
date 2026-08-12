/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';

const apiMocks = vi.hoisted(() => ({
  accountApi: {
    list: vi.fn(),
    liveCodes: vi.fn(),
    code: vi.fn(),
    import: vi.fn(),
    export: vi.fn(),
    enrollStart: vi.fn(),
    enrollFinish: vi.fn()
  },
  accountOrganizationApi: {
    get: vi.fn(),
    createFolder: vi.fn(),
    createTag: vi.fn(),
    updateAccountOrganization: vi.fn()
  },
  authApi: {
    reauth: vi.fn()
  }
}));

vi.mock('../api', () => apiMocks);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'accounts.liveCodeTimer') {
        return `Live code timer ${params?.seconds}`;
      }
      if (key === 'accounts.expiresIn') {
        return `Expires in ${params?.seconds}`;
      }
      return key;
    }
  })
}));

describe('AccountsPage offline code cache', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.accountApi.list.mockResolvedValue({
      items: [
        {
          id: 1,
          alias: 'Main',
          accountName: 'main',
          steamid: '76561198000000001',
          source: 'mafile',
          autoConfirmTrades: false,
          autoConfirmTradeMode: 'all',
          autoConfirmLogins: false,
          autoConfirmDelaySec: 0,
          lastCode: null,
          lastActive: null,
          folderId: null,
          folderName: null,
          tags: [],
          hasRecoveryCode: false,
          createdAt: '2026-06-22T07:00:00Z'
        }
      ]
    });
    apiMocks.accountOrganizationApi.get.mockResolvedValue({ folders: [], tags: [] });
    apiMocks.accountApi.liveCodes.mockResolvedValue({
      generatedAt: '2026-06-22T07:00:00Z',
      validForSec: 25,
      items: [{ accountId: 1, code: 'ABCDE' }]
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('persists fetched live codes for offline display fallback', async () => {
    render(
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(localStorage.getItem('steamguard-offline-codes')).toBe(JSON.stringify({ '1': 'ABCDE' }));
    });
  });
});
