import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Bell, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountApi, notificationApi, steamApi } from '../api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { Account, ConfirmationQueueItem, NotificationItem } from '../types';

type WsEvent = {
  event: string;
  payload: Record<string, unknown>;
  ts: number;
};

type PendingDashboardItem = ConfirmationQueueItem & {
  accountId: number;
  accountAlias: string;
};

type PopupItem = {
  id: number;
  title: string;
  subtitle: string;
  accountId?: number;
};

export function DashboardPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const [pendingItems, setPendingItems] = useState<PendingDashboardItem[]>([]);
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingPending, setSyncingPending] = useState(false);
  const accountsRef = useRef<Account[]>([]);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  const pushPopup = useCallback((title: string, subtitle: string, accountId?: number) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setPopups((previous) => [{ id, title, subtitle, accountId }, ...previous].slice(0, 4));
    window.setTimeout(() => {
      setPopups((previous) => previous.filter((item) => item.id !== id));
    }, 8000);
  }, []);

  const loadPendingConfirmations = useCallback(async (sourceAccounts: Account[], syncSteam = false) => {
    setSyncingPending(true);
    try {
      if (syncSteam) {
        await Promise.allSettled(
          sourceAccounts.flatMap((account) => [
            steamApi.trades(account.id),
            steamApi.logins(account.id)
          ])
        );
      }

      const queueResults = await Promise.all(
        sourceAccounts.map(async (account) => {
          const response = await steamApi.queue(account.id);
          const pending = response.items.filter((item) => item.status === 'pending');
          return pending.map((item) => ({
            ...item,
            accountId: account.id,
            accountAlias: account.alias
          }));
        })
      );

      const flat = queueResults.flat();
      flat.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setPendingItems(flat);
    } finally {
      setSyncingPending(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRes, notificationRes] = await Promise.all([accountApi.list(), notificationApi.list()]);
      setAccounts(accountRes.items);
      setNotifications(notificationRes.items);
      void loadPendingConfirmations(accountRes.items, false);
    } finally {
      setLoading(false);
    }
  }, [loadPendingConfirmations]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (accounts.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      void loadPendingConfirmations(accounts, false);
    }, 5000);

    return () => clearInterval(timer);
  }, [accounts, loadPendingConfirmations]);

  useEffect(() => {
    const wsUrl =
      import.meta.env.VITE_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsEvent;
        if (parsed.event === 'connected' || parsed.event === 'pong') {
          return;
        }
        setLiveEvents((previous) => [parsed, ...previous].slice(0, 20));

        const payload = parsed.payload ?? {};
        const headline = String(payload.headline ?? parsed.event);
        const accountAlias = String(payload.accountAlias ?? payload.account_id ?? '').trim();
        const accountId =
          typeof payload.accountId === 'number'
            ? payload.accountId
            : typeof payload.accountId === 'string'
              ? Number(payload.accountId)
              : undefined;

        if (
          parsed.event === 'confirmation:new' ||
          parsed.event === 'trade:new' ||
          parsed.event === 'login:new'
        ) {
          pushPopup(accountAlias ? `${accountAlias}: ${headline}` : headline, t('dashboard.live'), accountId);
          void loadPendingConfirmations(accountsRef.current, false);
        }
      } catch {
        // ignore malformed events
      }
    };

    return () => {
      socket.close();
    };
  }, [loadPendingConfirmations, pushPopup, t]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);

  if (loading) {
    return <div>{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase text-base-500">{t('dashboard.accounts')}</div>
              <div className="mt-1 text-2xl font-bold">{accounts.length}</div>
            </div>
            <KeyRound className="text-accent-500" size={18} />
          </div>
        </Card>

        <Card className="animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase text-base-500">{t('dashboard.notifications')}</div>
              <div className="mt-1 text-2xl font-bold">{unreadCount}</div>
            </div>
            <Bell className="text-warning" size={18} />
          </div>
        </Card>

        <Card className="animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase text-base-500">{t('dashboard.live')}</div>
              <div className="mt-1 text-2xl font-bold">{pendingItems.length}</div>
            </div>
            <Activity className="text-success" size={18} />
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('dashboard.pendingConfirmations')}</h2>
          <Button
            variant="secondary"
            disabled={syncingPending}
            onClick={() => void loadPendingConfirmations(accounts)}
          >
            {syncingPending ? t('auth.pleaseWait') : t('dashboard.syncConfirmations')}
          </Button>
        </div>
        <div className="space-y-2">
          {pendingItems.length === 0 && <div className="text-sm text-base-500">{t('common.empty')}</div>}
          {pendingItems.slice(0, 20).map((item) => (
            <div key={`${item.accountId}-${item.confirmation_id}`} className="rounded-xl border border-base-200 p-3 text-sm dark:border-base-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {item.accountAlias} • {item.kind}
                  </div>
                  <div className="text-xs text-base-500">{item.headline}</div>
                  <div className="text-xs text-base-500">{item.summary}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="h-8"
                    onClick={() => {
                      void (async () => {
                        if (item.kind === 'login') {
                          await steamApi.confirmLogin(item.accountId, item.confirmation_id, item.nonce);
                        } else {
                          await steamApi.confirmTrade(item.accountId, item.confirmation_id, item.nonce);
                        }
                        await loadPendingConfirmations(accounts, false);
                      })();
                    }}
                  >
                    {t('common.confirm')}
                  </Button>
                  <Button
                    className="h-8"
                    variant="danger"
                    onClick={() => {
                      void (async () => {
                        if (item.kind === 'login') {
                          await steamApi.rejectLogin(item.accountId, item.confirmation_id, item.nonce);
                        } else {
                          await steamApi.rejectTrade(item.accountId, item.confirmation_id, item.nonce);
                        }
                        await loadPendingConfirmations(accounts, false);
                      })();
                    }}
                  >
                    {t('common.reject')}
                  </Button>
                  <Link to={`/accounts/${item.accountId}`}>
                    <Button className="h-8" variant="secondary">
                      {t('dashboard.openAccount')}
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('dashboard.recentNotifications')}</h2>
            <Button variant="secondary" onClick={() => void load()}>
              {t('common.refresh')}
            </Button>
          </div>
          <div className="space-y-2">
            {notifications.length === 0 && <div className="text-sm text-base-500">{t('common.empty')}</div>}
            {notifications.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-xl border border-base-200 p-3 text-sm dark:border-base-700">
                <div className="font-medium">{item.type}</div>
                {typeof item.payload?.message === 'string' && (
                  <div className="text-xs text-base-500">{item.payload.message}</div>
                )}
                <div className="text-xs text-base-500">{new Date(item.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">{t('dashboard.realtimeEvents')}</h2>
          <div className="space-y-2">
            {liveEvents.length === 0 && <div className="text-sm text-base-500">{t('dashboard.noLiveEvents')}</div>}
            {liveEvents.map((event, index) => (
              <div key={`${event.ts}-${index}`} className="rounded-xl border border-base-200 p-3 text-sm dark:border-base-700">
                <div className="font-medium">{event.event}</div>
                <div className="truncate text-xs text-base-500">{JSON.stringify(event.payload)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {popups.length > 0 && (
        <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-[min(92vw,420px)] flex-col gap-2">
          {popups.map((popup) => (
            <div
              key={popup.id}
              className="pointer-events-auto rounded-xl border border-accent-200 bg-white/95 p-3 shadow-lg dark:border-accent-700 dark:bg-base-900/95"
            >
              <div className="text-sm font-semibold">{popup.title}</div>
              <div className="mt-0.5 text-xs text-base-500">{popup.subtitle}</div>
              {popup.accountId ? (
                <div className="mt-2">
                  <Link to={`/accounts/${popup.accountId}`}>
                    <Button className="h-7" variant="secondary">
                      {t('dashboard.openAccount')}
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
