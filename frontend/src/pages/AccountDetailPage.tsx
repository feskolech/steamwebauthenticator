import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { accountApi, steamApi } from '../api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import type { Account, ConfirmationQueueItem } from '../types';

export function AccountDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const accountId = Number(params.id);

  const [account, setAccount] = useState<Account | null>(null);
  const [queue, setQueue] = useState<ConfirmationQueueItem[]>([]);
  const [steamLoginSecure, setSteamLoginSecure] = useState('');
  const [sessionid, setSessionid] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [accountRes, queueRes] = await Promise.all([accountApi.get(accountId), steamApi.queue(accountId)]);
    setAccount(accountRes);
    setQueue(queueRes.items);
  }, [accountId]);

  useEffect(() => {
    if (!accountId) {
      return;
    }
    void load();
  }, [accountId, load]);

  if (!account) {
    return <div>{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{account.alias}</h1>
            <div className="text-sm text-base-500">{account.steamid ?? t('accountDetail.noSteamId')}</div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void (async () => {
                  await steamApi.trades(accountId);
                  await steamApi.logins(accountId);
                  await load();
                })();
              }}
            >
              {t('accountDetail.refreshConfirms')}
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  await accountApi.update(accountId, {
                    autoConfirmTrades: !account.autoConfirmTrades
                  });
                  await load();
                })();
              }}
            >
              {t('accountDetail.autoConfirmTrades')}: {account.autoConfirmTrades ? t('common.on') : t('common.off')}
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  await accountApi.update(accountId, {
                    autoConfirmLogins: !account.autoConfirmLogins
                  });
                  await load();
                })();
              }}
            >
              {t('accountDetail.autoConfirmLogins')}: {account.autoConfirmLogins ? t('common.on') : t('common.off')}
            </Button>
          </div>
        </div>
        <div className="mt-2 text-sm text-base-500">
          {t('accountDetail.autoConfirmTradesHint', { delay: account.autoConfirmDelaySec })}
        </div>
        <div className="mt-1 text-sm text-base-500">
          {t('accountDetail.autoConfirmLoginsHint', { delay: account.autoConfirmDelaySec })}
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[140px_1fr_auto]">
          <Input
            type="number"
            min={0}
            max={60}
            defaultValue={account.autoConfirmDelaySec}
            onBlur={(event) => {
              const value = Number(event.target.value);
              void accountApi.update(accountId, { autoConfirmDelaySec: value });
            }}
          />
          <div className="self-center text-sm text-base-500">{t('accountDetail.autoConfirmDelay')}</div>
          <Button variant="secondary" onClick={() => void load()}>
            {t('accountDetail.reload')}
          </Button>
        </div>

        {account.hasRecoveryCode && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <div className="mb-2 font-semibold">{t('accountDetail.recoveryCodeTitle')}</div>
            {!recoveryCode && (
              <Button
                variant="secondary"
                onClick={() => {
                  void (async () => {
                    const response = await accountApi.getRecoveryCode(accountId);
                    setRecoveryCode(response.recoveryCode);
                  })();
                }}
              >
                {t('accountDetail.showRecoveryCode')}
              </Button>
            )}
            {recoveryCode && <code className="font-mono text-xs">{recoveryCode}</code>}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">{t('accountDetail.steamSessionTitle')}</h2>
        <div className="space-y-2">
          <Input
            placeholder={t('accountDetail.steamLoginSecure')}
            value={steamLoginSecure}
            onChange={(event) => setSteamLoginSecure(event.target.value)}
          />
          <Input
            placeholder={t('accountDetail.sessionId')}
            value={sessionid}
            onChange={(event) => setSessionid(event.target.value)}
          />
          <Input
            placeholder={t('accountDetail.oauthToken')}
            value={oauthToken}
            onChange={(event) => setOauthToken(event.target.value)}
          />
          <Button
            onClick={() => {
              void (async () => {
                try {
                  await accountApi.setSession(accountId, { steamLoginSecure, sessionid, oauthToken });
                  setMessage(t('accountDetail.sessionSaved'));
                } catch {
                  setMessage(t('accountDetail.sessionSaveFailed'));
                }
              })();
            }}
          >
            {t('accountDetail.saveSession')}
          </Button>
          {message && <div className="text-sm text-base-500">{message}</div>}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">{t('accountDetail.queueTitle')}</h2>
        <div className="space-y-2">
          {queue.map((item) => (
            <div key={item.confirmation_id} className="rounded-xl border border-base-200 p-3 dark:border-base-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{item.headline}</div>
                  <div className="text-xs text-base-500">{item.summary}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="h-8"
                    onClick={() => {
                      void (async () => {
                        await steamApi.confirmTrade(accountId, item.confirmation_id, item.nonce);
                        await load();
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
                        await steamApi.rejectTrade(accountId, item.confirmation_id, item.nonce);
                        await load();
                      })();
                    }}
                  >
                    {t('common.reject')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {queue.length === 0 && <div className="text-sm text-base-500">{t('accountDetail.noPending')}</div>}
        </div>
      </Card>
    </div>
  );
}
