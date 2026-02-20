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

  const [maAlias, setMaAlias] = useState('');
  const [maFile, setMaFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [steamAlias, setSteamAlias] = useState('');
  const [steamAccountName, setSteamAccountName] = useState('');
  const [steamPassword, setSteamPassword] = useState('');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [pendingEnroll, setPendingEnroll] = useState<PendingEnrollment | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

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

  const saveCache = (next: CachedCode) => {
    setCachedCodes(next);
    localStorage.setItem(OFFLINE_CODES_KEY, JSON.stringify(next));
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
        password: steamPassword,
        guardCode: steamGuardCode || undefined
      });
      setPendingEnroll(response);
      if (!steamAlias) {
        setSteamAlias(response.accountName);
      }
    } catch (err: any) {
      setEnrollError(err?.response?.data?.message || err.message || t('accounts.enrollStartFailed'));
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
      setSteamGuardCode('');
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
              <Input
                placeholder={t('accounts.steamGuardCode')}
                value={steamGuardCode}
                onChange={(event) => setSteamGuardCode(event.target.value)}
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
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-base-500">
                <th className="px-2 py-2">{t('accounts.colAlias')}</th>
                <th className="px-2 py-2">{t('accounts.colSteamId')}</th>
                <th className="px-2 py-2">{t('accounts.colLastCode')}</th>
                <th className="px-2 py-2">{t('accounts.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-base-200/80 dark:border-base-700/70">
                  <td className="px-2 py-3 font-medium">{account.alias}</td>
                  <td className="px-2 py-3 text-xs">{account.steamid ?? '-'}</td>
                  <td className="px-2 py-3">
                    <Badge variant={navigator.onLine ? 'default' : 'warning'}>
                      {account.lastCode ?? cachedCodes[String(account.id)] ?? t('accounts.noCode')}
                    </Badge>
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
                  <td className="px-2 py-4 text-sm text-base-500" colSpan={4}>
                    {t('common.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
