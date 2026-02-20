import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function AdminPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [overview, setOverview] = useState<{ users: number; accounts: number } | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [users, setUsers] = useState<Array<{ id: number; email: string; role: string; twofaMethod: string }>>([]);

  const load = async () => {
    const [overviewRes, settingsRes, usersRes] = await Promise.all([
      adminApi.overview(),
      adminApi.settings(),
      adminApi.users()
    ]);

    setOverview(overviewRes);
    setRegistrationEnabled(settingsRes.registrationEnabled);
    setUsers(usersRes.items);
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      void load();
    }
  }, [user?.role]);

  if (user?.role !== 'admin') {
    return <div>{t('admin.accessRequired')}</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-sm text-base-500">{t('admin.users')}</div>
          <div className="text-2xl font-bold">{overview?.users ?? 0}</div>
        </Card>
        <Card>
          <div className="text-sm text-base-500">{t('admin.accounts')}</div>
          <div className="text-2xl font-bold">{overview?.accounts ?? 0}</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">{t('admin.registration')}</div>
            <div className="text-sm text-base-500">
              {registrationEnabled ? t('admin.enabled') : t('admin.disabled')}
            </div>
          </div>
          <Button
            onClick={() => {
              void (async () => {
                await adminApi.updateSettings(!registrationEnabled);
                await load();
              })();
            }}
          >
            {t('admin.toggle')}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">{t('admin.recentUsers')}</h2>
        <div className="space-y-2 text-sm">
          {users.map((item) => (
            <div key={item.id} className="rounded-xl border border-base-200 p-3 dark:border-base-700">
              <div className="font-medium">{item.email}</div>
              <div className="text-xs text-base-500">
                {item.role} / {item.twofaMethod}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
