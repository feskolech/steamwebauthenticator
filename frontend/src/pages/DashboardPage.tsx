import { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountApi, notificationApi } from '../api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { Account, NotificationItem } from '../types';

type WsEvent = {
  event: string;
  payload: Record<string, unknown>;
  ts: number;
};

export function DashboardPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [accountRes, notificationRes] = await Promise.all([accountApi.list(), notificationApi.list()]);
      setAccounts(accountRes.items);
      setNotifications(notificationRes.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const wsUrl =
      import.meta.env.VITE_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsEvent;
        setLiveEvents((previous) => [parsed, ...previous].slice(0, 20));
      } catch {
        // ignore malformed events
      }
    };

    return () => {
      socket.close();
    };
  }, []);

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
              <div className="mt-1 text-2xl font-bold">{liveEvents.length}</div>
            </div>
            <Activity className="text-success" size={18} />
          </div>
        </Card>
      </div>

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
    </div>
  );
}
