import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, authApi } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SensitiveActionModal } from '../components/security/SensitiveActionModal';
import { Input } from '../components/ui/Input';
import type { AdminLogItem, RegistrationInvite } from '../types';

type Scope = 'all' | 'steam' | 'auth' | 'security';
type RegistrationMode = 'open' | 'disabled' | 'domain_allowlist' | 'invite_only';

export function AdminPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [overview, setOverview] = useState<{ users: number; accounts: number } | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('open');
  const [allowedDomains, setAllowedDomains] = useState('');
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [inviteNote, setInviteNote] = useState('');
  const [inviteDays, setInviteDays] = useState('14');
  const [users, setUsers] = useState<Array<{ id: number; email: string; role: string; twofaMethod: string }>>([]);
  const [auditLogs, setAuditLogs] = useState<AdminLogItem[]>([]);
  const [auditScope, setAuditScope] = useState<Scope>('all');
  const [auditUserId, setAuditUserId] = useState<string>('all');
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; email: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextScope: Scope, nextUserId: string) => {
    setError(null);
    const [overviewRes, settingsRes, usersRes, invitesRes, logsRes] = await Promise.all([
      adminApi.overview(),
      adminApi.settings(),
      adminApi.users(),
      adminApi.invites(),
      adminApi.logs({
        scope: nextScope,
        userId: nextUserId === 'all' ? undefined : Number(nextUserId),
        limit: 80
      })
    ]);

    setOverview(overviewRes);
    setRegistrationEnabled(settingsRes.registrationEnabled);
    setRegistrationMode(settingsRes.registrationMode);
    setAllowedDomains(settingsRes.allowedEmailDomains.join(', '));
    setUsers(usersRes.items);
    setInvites(invitesRes.items);
    setAuditLogs(logsRes.items);
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      void load(auditScope, auditUserId);
    }
  }, [auditScope, auditUserId, load, user?.role]);

  if (user?.role !== 'admin') {
    return <div>{t('admin.accessRequired')}</div>;
  }

  const confirmDeleteUser = async (password: string) => {
    if (!deleteTarget) {
      return;
    }

    setDeleteBusy(true);
    setDeleteError(null);
    setError(null);
    try {
      await authApi.reauthenticate(password);
      await adminApi.deleteUser(deleteTarget.id);
      await load(auditScope, auditUserId);
      setDeleteTarget(null);
    } catch (err: any) {
      setDeleteError(err?.response?.data?.message || err.message || t('admin.deleteUserFailed'));
    } finally {
      setDeleteBusy(false);
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      {error && <div className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

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
        <div className="space-y-3">
          <div>
            <div className="font-semibold">{t('admin.registration')}</div>
            <div className="text-sm text-base-500">
              {registrationEnabled ? t('admin.enabled') : t('admin.disabled')}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              <div className="mb-1">{t('admin.registrationEnabledLabel')}</div>
              <select
                className="input-base"
                value={registrationEnabled ? 'enabled' : 'disabled'}
                onChange={(event) => setRegistrationEnabled(event.target.value === 'enabled')}
              >
                <option value="enabled">{t('admin.enabled')}</option>
                <option value="disabled">{t('admin.disabled')}</option>
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1">{t('admin.registrationMode')}</div>
              <select
                className="input-base"
                value={registrationMode}
                onChange={(event) => setRegistrationMode(event.target.value as RegistrationMode)}
              >
                <option value="open">{t('admin.registrationModeOpen')}</option>
                <option value="disabled">{t('admin.registrationModeDisabled')}</option>
                <option value="domain_allowlist">{t('admin.registrationModeDomainAllowlist')}</option>
                <option value="invite_only">{t('admin.registrationModeInviteOnly')}</option>
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1">{t('admin.allowedDomains')}</div>
              <input
                className="input-base"
                value={allowedDomains}
                disabled={registrationMode !== 'domain_allowlist'}
                onChange={(event) => setAllowedDomains(event.target.value)}
                placeholder={t('admin.allowedDomainsPlaceholder')}
              />
            </label>
          </div>

          <Button
            onClick={() => {
              void (async () => {
                await adminApi.updateSettings({
                  registrationEnabled,
                  registrationMode,
                  allowedEmailDomains: allowedDomains
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                });
                await load(auditScope, auditUserId);
              })();
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('admin.invitesTitle')}</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
          <Input
            placeholder={t('admin.inviteNotePlaceholder')}
            value={inviteNote}
            onChange={(event) => setInviteNote(event.target.value)}
          />
          <Input value={inviteDays} onChange={(event) => setInviteDays(event.target.value)} />
          <Button
            onClick={() => {
              void (async () => {
                await adminApi.createInvite({
                  note: inviteNote || undefined,
                  expiresInDays: Number(inviteDays || 14)
                });
                setInviteNote('');
                await load(auditScope, auditUserId);
              })();
            }}
          >
            {t('admin.createInvite')}
          </Button>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          {invites.map((invite) => (
            <div key={invite.id} className="rounded-xl border border-base-200 p-3 dark:border-base-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono font-medium">{invite.code}</div>
                  <div className="text-xs text-base-500">
                    {invite.note || t('admin.inviteNoNote')} · {new Date(invite.expiresAt).toLocaleString()}
                  </div>
                  {invite.usedAt && (
                    <div className="text-xs text-base-500">
                      {t('admin.inviteUsedBy', { email: invite.usedByEmail ?? t('admin.unknownActor') })}
                    </div>
                  )}
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    void (async () => {
                      await adminApi.deleteInvite(invite.id);
                      await load(auditScope, auditUserId);
                    })();
                  }}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))}

          {invites.length === 0 && <div className="text-sm text-base-500">{t('admin.invitesEmpty')}</div>}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">{t('admin.recentUsers')}</h2>
        <div className="space-y-2 text-sm">
          {users.map((item) => (
            <div key={item.id} className="rounded-xl border border-base-200 p-3 dark:border-base-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{item.email}</div>
                  <div className="text-xs text-base-500">
                    {item.role} / {item.twofaMethod}
                  </div>
                </div>
                {item.role !== 'admin' && (
                  <Button
                    variant="danger"
                    disabled={busyUserId === item.id}
                    onClick={() => {
                      setBusyUserId(item.id);
                      setDeleteError(null);
                      setDeleteTarget({ id: item.id, email: item.email });
                    }}
                  >
                    {busyUserId === item.id ? t('common.loading') : t('admin.deleteUser')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('admin.auditTitle')}</h2>
          <Button variant="secondary" onClick={() => void load(auditScope, auditUserId)}>
            {t('common.refresh')}
          </Button>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <div className="mb-1">{t('admin.auditScope')}</div>
            <select
              className="input-base"
              value={auditScope}
              onChange={(event) => {
                setAuditScope(event.target.value as Scope);
              }}
            >
              <option value="all">{t('logs.scope.all')}</option>
              <option value="steam">{t('logs.scope.steam')}</option>
              <option value="auth">{t('logs.scope.auth')}</option>
              <option value="security">{t('logs.scope.security')}</option>
            </select>
          </label>

          <label className="text-sm">
            <div className="mb-1">{t('admin.auditUser')}</div>
            <select
              className="input-base"
              value={auditUserId}
              onChange={(event) => {
                setAuditUserId(event.target.value);
              }}
            >
              <option value="all">{t('admin.auditAllUsers')}</option>
              {users.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.email}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2 text-sm">
          {auditLogs.map((item) => (
            <div key={item.id} className="rounded-xl border border-base-200 p-3 dark:border-base-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        item.category === 'steam'
                          ? 'success'
                          : item.category === 'security'
                            ? 'warning'
                            : 'default'
                      }
                    >
                      {t(`logs.scope.${item.category}`)}
                    </Badge>
                    <span className="text-xs text-base-500">{item.userEmail ?? t('admin.unknownActor')}</span>
                    {item.accountAlias && <span className="text-xs text-base-500">{item.accountAlias}</span>}
                  </div>
                  <div className="font-medium">{t(`logs.events.${item.eventKey}`, item.context)}</div>
                </div>
                <div className="text-xs text-base-500">{new Date(item.createdAt).toLocaleString()}</div>
              </div>

              <pre className="mt-2 overflow-x-auto rounded-lg bg-base-100 p-2 text-xs dark:bg-base-800">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </div>
          ))}

          {auditLogs.length === 0 && <div className="text-sm text-base-500">{t('admin.auditEmpty')}</div>}
        </div>
      </Card>

      <SensitiveActionModal
        open={Boolean(deleteTarget)}
        title={t('auth.sensitiveActionTitle')}
        description={t('admin.deleteUserSensitiveDescription', { email: deleteTarget?.email ?? '' })}
        busy={deleteBusy}
        error={deleteError}
        onClose={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
            setDeleteError(null);
            setBusyUserId(null);
          }
        }}
        onConfirm={(password) => {
          void confirmDeleteUser(password);
        }}
      />
    </div>
  );
}
