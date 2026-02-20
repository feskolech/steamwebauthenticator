import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, KeyRound, Smartphone, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountApi } from '../api';
import type { Account } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';

const OFFLINE_CODES_KEY = 'steamguard-offline-codes';

type CachedCode = Record<string, string>;

type PendingEnrollment = {
  pendingId: string;
  accountName: string;
  steamid: string;
  expiresInSec: number;
  message: string;
};

export function AccountsPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [liveCodes, setLiveCodes] = useState<Record<number, string>>({});
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return 30 - (nowSec % 30) || 30;
  });

  const [maAlias, setMaAlias] = useState('');
  const [maFile, setMaFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [steamAlias, setSteamAlias] = useState('');
  const [steamAccountName, setSteamAccountName] = useState('');
  const [steamPassword, setSteamPassword] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [pendingEnroll, setPendingEnroll] = useState<PendingEnrollment | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [guardModalOpen, setGuardModalOpen] = useState(false);
  const [guardModalType, setGuardModalType] = useState<'email' | 'totp'>('email');
  const [guardModalDomain, setGuardModalDomain] = useState<string | null>(null);
  const [guardCodeInput, setGuardCodeInput] = useState('');
  const [guardModalError, setGuardModalError] = useState<string | null>(null);

  const [cachedCodes, setCachedCodes] = useState<CachedCode>(() => {
    const raw = localStorage.getItem(OFFLINE_CODES_KEY);
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as CachedCode;
    } catch {
      return {};
    }
  });

  const load = async () => {
    const response = await accountApi.list();
    setAccounts(response.items);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let active = true;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateCountdown = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const next = 30 - (nowSec % 30) || 30;
      if (active) {
        setSecondsLeft(next);
      }
    };

    const fetchLiveCodes = async () => {
      try {
        const response = await accountApi.liveCodes();
        if (!active) {
          return;
        }
        const next: Record<number, string> = {};
        response.items.forEach((item) => {
          next[item.accountId] = item.code;
        });
        setLiveCodes(next);
      } catch {
        // ignore temporary errors
      }
    };

    const scheduleRefresh = () => {
      const nowMs = Date.now();
      const secPart = Math.floor(nowMs / 1000);
      const secToNext = 30 - (secPart % 30) || 30;
      const delayMs = secToNext * 1000 + 150;
      refreshTimeout = setTimeout(async () => {
        await fetchLiveCodes();
        scheduleRefresh();
      }, delayMs);
    };

    updateCountdown();
    void fetchLiveCodes();
    scheduleRefresh();
    const timer = setInterval(updateCountdown, 1000);

    return () => {
      active = false;
      clearInterval(timer);
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    };
  }, []);

  const saveCache = (next: CachedCode) => {
    setCachedCodes(next);
    localStorage.setItem(OFFLINE_CODES_KEY, JSON.stringify(next));
  };

  const formatEnrollError = (data: any, fallback: string) => {
    if (!data) {
      return fallback;
    }

    const parts: string[] = [];
    if (data.message) {
      parts.push(String(data.message));
    }

    if (data.code) {
      parts.push(`code=${String(data.code)}`);
    }

    if (data.status !== undefined && data.status !== null) {
      parts.push(`status=${String(data.status)}`);
    }

    if (data.details && typeof data.details === 'object') {
      const details = data.details as Record<string, unknown>;
      if (details.phoneVerified !== undefined && details.phoneVerified !== null) {
        parts.push(`phoneVerified=${String(details.phoneVerified)}`);
      }
      if (details.isSteamGuardEnabled !== undefined && details.isSteamGuardEnabled !== null) {
        parts.push(`isSteamGuardEnabled=${String(details.isSteamGuardEnabled)}`);
      }
      if (details.timestampTwoFactorEnabled) {
        parts.push(`twoFactorEnabledAt=${String(details.timestampTwoFactorEnabled)}`);
      }
    }

    return parts.length > 0 ? parts.join(' | ') : fallback;
  };

  const onImportMa = async () => {
    if (!maFile) {
      setImportError(t('accounts.chooseFile'));
      return;
    }

    setImportBusy(true);
    setImportError(null);

    try {
      await accountApi.import(maFile, maAlias || undefined);
      setMaAlias('');
      setMaFile(null);
      await load();
    } catch (err: any) {
      setImportError(err?.response?.data?.message || err.message || t('accounts.importFailed'));
    } finally {
      setImportBusy(false);
    }
  };

  const onStartEnroll = async () => {
    setEnrollBusy(true);
    setEnrollError(null);
    setRecoveryCode(null);

    try {
      const response = await accountApi.enrollStart({
        accountName: steamAccountName,
        password: steamPassword
      });
      setPendingEnroll(response);
      if (!steamAlias) {
        setSteamAlias(response.accountName);
      }
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'STEAM_GUARD_REQUIRED') {
        setGuardModalType(data.guardType === 'totp' ? 'totp' : 'email');
        setGuardModalDomain(typeof data.guardDomain === 'string' ? data.guardDomain : null);
        setGuardCodeInput('');
        setGuardModalError(null);
        setGuardModalOpen(true);
      } else {
        setEnrollError(
          formatEnrollError(
            data,
            err?.message || t('accounts.enrollStartFailed')
          )
        );
      }
    } finally {
      setEnrollBusy(false);
    }
  };

  const onSubmitGuardCode = async () => {
    setEnrollBusy(true);
    setGuardModalError(null);
    setEnrollError(null);

    try {
      const response = await accountApi.enrollStart({
        accountName: steamAccountName,
        password: steamPassword,
        guardCode: guardCodeInput
      });
      setPendingEnroll(response);
      if (!steamAlias) {
        setSteamAlias(response.accountName);
      }
      setGuardModalOpen(false);
      setGuardCodeInput('');
    } catch (err: any) {
      const data = err?.response?.data;
      setGuardModalError(
        formatEnrollError(
          data,
          err?.message || t('accounts.enrollStartFailed')
        )
      );
    } finally {
      setEnrollBusy(false);
    }
  };

  const onFinishEnroll = async () => {
    if (!pendingEnroll) {
      return;
    }

    setEnrollBusy(true);
    setEnrollError(null);

    try {
      const response = await accountApi.enrollFinish({
        pendingId: pendingEnroll.pendingId,
        activationCode,
        alias: steamAlias || undefined
      });
      setRecoveryCode(response.recoveryCode);
      setPendingEnroll(null);
      setActivationCode('');
      setSteamPassword('');
      await load();
    } catch (err: any) {
      setEnrollError(err?.response?.data?.message || err.message || t('accounts.enrollFinishFailed'));
    } finally {
      setEnrollBusy(false);
    }
  };

  const onGenerateCode = async (account: Account) => {
    try {
      const response = await accountApi.code(account.id);
      const next = {
        ...cachedCodes,
        [String(account.id)]: response.code
      };
      saveCache(next);
      await load();
    } catch (err: any) {
      setImportError(err?.response?.data?.message || err.message || t('accounts.codeGenerationFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('accounts.title')}</h1>

      <Card>
        <h2 className="mb-3 text-base font-semibold">{t('accounts.import')}</h2>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input
            placeholder={t('accounts.alias')}
            value={maAlias}
            onChange={(event) => setMaAlias(event.target.value)}
          />
          <Input
            type="file"
            accept=".maFile,.json"
            onChange={(event) => setMaFile(event.target.files?.[0] ?? null)}
          />
          <Button onClick={() => void onImportMa()} disabled={importBusy} className="gap-2">
            <Upload size={14} />
            {importBusy ? t('accounts.importing') : t('accounts.import')}
          </Button>
        </div>
        {importError && <div className="mt-2 text-sm text-danger">{importError}</div>}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t('accounts.enrollTitle')}</h2>
        <div className="mb-3 text-sm text-base-500">{t('accounts.enrollDescription')}</div>

        {!pendingEnroll ? (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                placeholder={t('accounts.alias')}
                value={steamAlias}
                onChange={(event) => setSteamAlias(event.target.value)}
              />
              <Input
                placeholder={t('accounts.steamLogin')}
                value={steamAccountName}
                onChange={(event) => setSteamAccountName(event.target.value)}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                type="password"
                placeholder={t('accounts.steamPassword')}
                value={steamPassword}
                onChange={(event) => setSteamPassword(event.target.value)}
              />
            </div>

            <Button onClick={() => void onStartEnroll()} disabled={enrollBusy} className="gap-2">
              <Smartphone size={14} />
              {enrollBusy ? t('accounts.enrollStarting') : t('accounts.startEnroll')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-base-200 p-3 text-sm dark:border-base-700">
              <div className="font-medium">{t('accounts.pendingEnrollment')}</div>
              <div className="text-xs text-base-500">
                {pendingEnroll.accountName} • {pendingEnroll.steamid}
              </div>
            </div>

            <Input
              placeholder={t('accounts.activationCode')}
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onFinishEnroll()} disabled={enrollBusy}>
                {enrollBusy ? t('accounts.enrollFinishing') : t('accounts.finishEnroll')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPendingEnroll(null);
                  setActivationCode('');
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {enrollError && <div className="mt-2 text-sm text-danger">{enrollError}</div>}

        {recoveryCode && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <div className="font-semibold">{t('accounts.recoveryCodeLabel')}</div>
            <code className="font-mono text-xs">{recoveryCode}</code>
          </div>
        )}
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <div className="mb-2 text-xs text-base-500">{t('accounts.liveCodeTimer', { seconds: secondsLeft })}</div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-base-500">
                <th className="px-2 py-2">{t('accounts.colAlias')}</th>
                <th className="px-2 py-2">{t('accounts.colUsername')}</th>
                <th className="px-2 py-2">{t('accounts.colSteamId')}</th>
                <th className="px-2 py-2">{t('accounts.colLastCode')}</th>
                <th className="px-2 py-2">{t('accounts.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-base-200/80 dark:border-base-700/70">
                  <td className="px-2 py-3 font-medium">{account.alias}</td>
                  <td className="px-2 py-3 text-xs">{account.accountName}</td>
                  <td className="px-2 py-3 text-xs">{account.steamid ?? '-'}</td>
                  <td className="px-2 py-3">
                    <div className="space-y-1">
                      <Badge variant={navigator.onLine ? 'default' : 'warning'}>
                        {liveCodes[account.id] ??
                          account.lastCode ??
                          cachedCodes[String(account.id)] ??
                          t('accounts.noCode')}
                      </Badge>
                      <div className="text-xs text-base-500">
                        {t('accounts.expiresIn', { seconds: secondsLeft })}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        className="gap-1"
                        onClick={() => void onGenerateCode(account)}
                      >
                        <KeyRound size={14} />
                        {t('accounts.generateCode')}
                      </Button>
                      <Button
                        variant="secondary"
                        className="gap-1"
                        onClick={() => void accountApi.export(account.id, account.alias)}
                      >
                        <Download size={14} />
                        {t('accounts.export')}
                      </Button>
                      <Link to={`/accounts/${account.id}`}>
                        <Button variant="secondary">{t('accounts.details')}</Button>
                      </Link>
                      <Button
                        variant="danger"
                        className="gap-1"
                        onClick={() => {
                          void (async () => {
                            await accountApi.delete(account.id);
                            await load();
                          })();
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-sm text-base-500" colSpan={5}>
                    {t('common.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {guardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-base-200 bg-white p-5 shadow-xl dark:border-base-700 dark:bg-base-900">
            <h3 className="text-lg font-semibold">{t('accounts.guardModalTitle')}</h3>
            <p className="mt-2 text-sm text-base-500">
              {guardModalType === 'email'
                ? t('accounts.guardModalEmailHint', { domain: guardModalDomain ?? 'email' })
                : t('accounts.guardModalTotpHint')}
            </p>

            <div className="mt-3">
              <Input
                placeholder={t('accounts.guardCodePlaceholder')}
                value={guardCodeInput}
                onChange={(event) => setGuardCodeInput(event.target.value)}
              />
            </div>

            {guardModalError && <div className="mt-2 text-sm text-danger">{guardModalError}</div>}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setGuardModalOpen(false);
                  setGuardCodeInput('');
                  setGuardModalError(null);
                }}
              >
                {t('accounts.guardModalCancel')}
              </Button>
              <Button onClick={() => void onSubmitGuardCode()} disabled={enrollBusy || !guardCodeInput.trim()}>
                {enrollBusy ? t('auth.pleaseWait') : t('accounts.guardModalSubmit')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
