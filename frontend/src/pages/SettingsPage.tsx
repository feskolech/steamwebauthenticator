import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { useTranslation } from 'react-i18next';
import { settingsApi, authApi } from '../api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { SensitiveActionModal } from '../components/security/SensitiveActionModal';
import { useAuth } from '../contexts/AuthContext';
import type { UserWebhook } from '../types';

export function SettingsPage() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [language, setLanguage] = useState<'en' | 'ru'>('en');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [twofaMethod, setTwofaMethod] = useState<'none' | 'telegram' | 'webauthn' | 'totp'>('none');
  const [hasTotpSecret, setHasTotpSecret] = useState(false);
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [hasRecoveryCodes, setHasRecoveryCodes] = useState(false);
  const [telegramInfo, setTelegramInfo] = useState<{ linked: boolean; username: string | null }>({
    linked: false,
    username: null
  });
  const [telegramNotifyLoginCodes, setTelegramNotifyLoginCodes] = useState(false);
  const [telegramNotifySaving, setTelegramNotifySaving] = useState(false);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<UserWebhook[]>([]);
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookTargetType, setWebhookTargetType] = useState<'generic' | 'discord'>('generic');
  const [webhookEventTypes, setWebhookEventTypes] = useState<string[]>(['trade', 'login']);
  const [webhookBusyId, setWebhookBusyId] = useState<number | null>(null);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [settings, webhookResponse] = await Promise.all([settingsApi.get(), settingsApi.webhooks()]);
    setLanguage(settings.language);
    setTheme(settings.theme);
    setTwofaMethod(settings.twofaMethod);
    setHasTotpSecret(settings.hasTotpSecret);
    setHasPasskeys(settings.hasPasskeys);
    setHasRecoveryCodes(settings.hasRecoveryCodes);
    setTelegramInfo({
      linked: settings.telegramLinked,
      username: settings.telegramUsername
    });
    setTelegramNotifyLoginCodes(settings.telegramNotifyLoginCodes);
    setWebhooks(webhookResponse.items);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      await settingsApi.update({
        language,
        theme,
        twofaMethod,
        telegramNotifyLoginCodes
      });
      await refreshUser();
      setMessage(t('settings.saved'));
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('settings.saveFailed'));
    }
  };

  const registerPasskey = async () => {
    try {
      const options = await authApi.webauthnRegisterOptions();
      const response = await startRegistration(options as any);
      await authApi.webauthnRegisterVerify(response);
      setTwofaMethod('webauthn');
      setMessage(t('settings.passkeyAttached'));
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('settings.passkeySetupFailed'));
    }
  };

  const saveTelegramNotifications = async () => {
    try {
      setTelegramNotifySaving(true);
      await settingsApi.update({
        telegramNotifyLoginCodes
      });
      setMessage(t('settings.saved'));
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('settings.saveFailed'));
    } finally {
      setTelegramNotifySaving(false);
    }
  };

  const startTotpSetup = async () => {
    try {
      setTotpBusy(true);
      const response = await settingsApi.startTotpSetup();
      setTotpSetup({ secret: response.secret, qrCodeDataUrl: response.qrCodeDataUrl });
      setMessage(null);
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('settings.totpSetupFailed'));
    } finally {
      setTotpBusy(false);
    }
  };

  const verifyTotpSetup = async () => {
    try {
      setTotpBusy(true);
      await settingsApi.verifyTotpSetup(totpCode);
      setTotpSetup(null);
      setTotpCode('');
      await load();
      setTwofaMethod('totp');
      setMessage(t('settings.totpAttached'));
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('settings.totpVerifyFailed'));
    } finally {
      setTotpBusy(false);
    }
  };

  const createWebhook = async () => {
    try {
      setWebhookSaving(true);
      await settingsApi.createWebhook({
        name: webhookName,
        url: webhookUrl,
        targetType: webhookTargetType,
        eventTypes: webhookEventTypes
      });
      setWebhookName('');
      setWebhookUrl('');
      setWebhookTargetType('generic');
      setWebhookEventTypes(['trade', 'login']);
      await load();
      setMessage(t('settings.webhookSaved'));
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('settings.webhookSaveFailed'));
    } finally {
      setWebhookSaving(false);
    }
  };

  const regenerateRecoveryCodes = async (password: string) => {
    try {
      setRecoveryBusy(true);
      setRecoveryError(null);
      await authApi.reauthenticate(password);
      const response = await settingsApi.regenerateRecoveryCodes();
      setRecoveryCodes(response.codes);
      setHasRecoveryCodes(true);
      setRecoveryModalOpen(false);
      setMessage(t('settings.recoveryCodesGenerated'));
    } catch (error: any) {
      setRecoveryError(error?.response?.data?.message || t('settings.recoveryCodesFailed'));
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <div className="mb-1">{t('settings.language')}</div>
            <select
              className="input-base"
              value={language}
              onChange={(event) => setLanguage(event.target.value as 'en' | 'ru')}
            >
              <option value="en">{t('settings.english')}</option>
              <option value="ru">{t('settings.russian')}</option>
            </select>
          </label>

          <label className="text-sm">
            <div className="mb-1">{t('settings.theme')}</div>
            <select
              className="input-base"
              value={theme}
              onChange={(event) => setTheme(event.target.value as 'light' | 'dark')}
            >
              <option value="light">{t('settings.light')}</option>
              <option value="dark">{t('settings.dark')}</option>
            </select>
          </label>

          <label className="text-sm">
            <div className="mb-1">{t('settings.twofa')}</div>
            <select
              className="input-base"
              value={twofaMethod}
              onChange={(event) =>
                setTwofaMethod(event.target.value as 'none' | 'telegram' | 'webauthn' | 'totp')
              }
            >
              <option value="none">{t('settings.none')}</option>
              <option value="telegram">{t('settings.telegramCodeMethod')}</option>
              <option value="totp" disabled={!hasTotpSecret}>{t('settings.totpMethod')}</option>
              <option value="webauthn" disabled={!hasPasskeys}>{t('settings.passkeyMethod')}</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()}>{t('common.save')}</Button>
          <Button variant="secondary" onClick={() => void startTotpSetup()} disabled={totpBusy}>
            {t('settings.setupTotp')}
          </Button>
          <Button variant="secondary" onClick={() => void registerPasskey()}>
            {t('settings.registerPasskey')}
          </Button>
        </div>

        {totpSetup && (
          <div className="mt-4 rounded-xl border border-base-200 p-4 dark:border-base-700">
            <div className="mb-2 font-medium">{t('settings.totpSetupTitle')}</div>
            <img src={totpSetup.qrCodeDataUrl} alt={t('settings.totpQrAlt')} className="h-40 w-40 rounded-lg bg-white p-2" />
            <div className="mt-3 text-sm text-base-500">{t('settings.totpSecret')}</div>
            <code className="block break-all text-xs">{totpSetup.secret}</code>
            <div className="mt-3 flex gap-2">
              <Input
                placeholder={t('auth.totpCode')}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
              />
              <Button onClick={() => void verifyTotpSetup()} disabled={totpBusy || !totpCode.trim()}>
                {totpBusy ? t('auth.pleaseWait') : t('settings.verifyTotp')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t('settings.recoveryCodes')}</h2>
        <div className="text-sm text-base-500">
          {hasRecoveryCodes ? t('settings.recoveryCodesConfigured') : t('settings.recoveryCodesMissing')}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setRecoveryModalOpen(true)}>
            {hasRecoveryCodes ? t('settings.regenerateRecoveryCodes') : t('settings.generateRecoveryCodes')}
          </Button>
        </div>

        {recoveryCodes.length > 0 && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <div className="font-semibold">{t('settings.recoveryCodesCopyNow')}</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {recoveryCodes.map((code) => (
                <code key={code} className="rounded-lg bg-white/70 px-2 py-1 text-xs dark:bg-base-900/50">
                  {code}
                </code>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t('settings.telegram')}</h2>
        <div className="text-sm text-base-500">
          {t('settings.linked')}:{' '}
          {telegramInfo.linked
            ? `${t('common.yes')} (${telegramInfo.username ?? t('settings.usernameHidden')})`
            : t('common.no')}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                const response = await settingsApi.generateTelegramCode();
                setTelegramCode(response.command);
              })();
            }}
          >
            {t('settings.generateAddCode')}
          </Button>

          {telegramInfo.linked && (
            <Button
              variant="danger"
              onClick={() => {
                void (async () => {
                  await settingsApi.unlinkTelegram();
                  await load();
                })();
              }}
            >
              {t('settings.unlinkTelegram')}
            </Button>
          )}
        </div>

        {telegramCode && (
          <div className="mt-2 text-sm">
            {t('settings.useCommandInBot')}: {telegramCode}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-base-200 p-3 dark:border-base-700">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={telegramNotifyLoginCodes}
              disabled={!telegramInfo.linked}
              onChange={(event) => setTelegramNotifyLoginCodes(event.target.checked)}
            />
            <div>
              <div className="font-medium">{t('settings.telegramNotifyLoginCodes')}</div>
              <div className="text-base-500">{t('settings.telegramNotifyLoginCodesHint')}</div>
              {!telegramInfo.linked && (
                <div className="mt-1 text-warning">{t('settings.telegramLinkFirst')}</div>
              )}
            </div>
          </label>

          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={!telegramInfo.linked || telegramNotifySaving}
              onClick={() => void saveTelegramNotifications()}
            >
              {telegramNotifySaving ? t('auth.pleaseWait') : t('common.save')}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t('settings.apiKeyForBots')}</h2>
        <Button
          onClick={() => {
            void (async () => {
              const response = await settingsApi.regenerateApiKey();
              setNewApiKey(response.apiKey);
            })();
          }}
        >
          {t('settings.generateApiKey')}
        </Button>

        {newApiKey && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <div className="font-semibold">{t('settings.copyNow')}</div>
            <code className="font-mono text-xs">{newApiKey}</code>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t('settings.webhooks')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <div className="mb-1">{t('settings.webhookName')}</div>
            <Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} />
          </label>
          <label className="text-sm">
            <div className="mb-1">{t('settings.webhookType')}</div>
            <select
              className="input-base"
              value={webhookTargetType}
              onChange={(event) => setWebhookTargetType(event.target.value as 'generic' | 'discord')}
            >
              <option value="generic">{t('settings.webhookTypeGeneric')}</option>
              <option value="discord">{t('settings.webhookTypeDiscord')}</option>
            </select>
          </label>
        </div>

        <label className="mt-3 block text-sm">
          <div className="mb-1">{t('settings.webhookUrl')}</div>
          <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
        </label>

        <div className="mt-3 space-y-2 text-sm">
          <div className="font-medium">{t('settings.webhookEvents')}</div>
          {[
            { key: 'trade', label: t('settings.webhookEventTrade') },
            { key: 'login', label: t('settings.webhookEventLogin') },
            { key: 'steam_session_expired', label: t('settings.webhookEventSessionExpired') }
          ].map((item) => (
            <label key={item.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={webhookEventTypes.includes(item.key)}
                onChange={(event) => {
                  setWebhookEventTypes((current) =>
                    event.target.checked
                      ? [...current, item.key]
                      : current.filter((value) => value !== item.key)
                  );
                }}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>

        <div className="mt-4">
          <Button
            disabled={webhookSaving || !webhookName.trim() || !webhookUrl.trim() || webhookEventTypes.length === 0}
            onClick={() => void createWebhook()}
          >
            {webhookSaving ? t('auth.pleaseWait') : t('settings.addWebhook')}
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {webhooks.length === 0 && <div className="text-sm text-base-500">{t('settings.noWebhooks')}</div>}
          {webhooks.map((webhook) => (
            <div key={webhook.id} className="rounded-xl border border-base-200 p-3 text-sm dark:border-base-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{webhook.name}</div>
                  <div className="text-xs text-base-500">{webhook.url}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge>{webhook.targetType}</Badge>
                    {webhook.eventTypes.map((eventType) => (
                      <Badge key={eventType} variant="success">
                        {eventType}
                      </Badge>
                    ))}
                  </div>
                  {webhook.lastError && <div className="mt-2 text-xs text-danger">{webhook.lastError}</div>}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={webhookBusyId === webhook.id}
                    onClick={() => {
                      void (async () => {
                        try {
                          setWebhookBusyId(webhook.id);
                          await settingsApi.testWebhook(webhook.id);
                          await load();
                          setMessage(t('settings.webhookTestSent'));
                        } catch (error: any) {
                          setMessage(error?.response?.data?.message || t('settings.webhookTestFailed'));
                        } finally {
                          setWebhookBusyId(null);
                        }
                      })();
                    }}
                  >
                    {t('settings.testWebhook')}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={webhookBusyId === webhook.id}
                    onClick={() => {
                      void (async () => {
                        try {
                          setWebhookBusyId(webhook.id);
                          await settingsApi.deleteWebhook(webhook.id);
                          await load();
                          setMessage(t('settings.webhookDeleted'));
                        } catch (error: any) {
                          setMessage(error?.response?.data?.message || t('settings.webhookDeleteFailed'));
                        } finally {
                          setWebhookBusyId(null);
                        }
                      })();
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {message && <div className="text-sm text-base-500">{message}</div>}

      <SensitiveActionModal
        open={recoveryModalOpen}
        title={t('settings.recoveryCodes')}
        description={t('settings.recoveryCodesDescription')}
        busy={recoveryBusy}
        error={recoveryError}
        onClose={() => {
          setRecoveryModalOpen(false);
          setRecoveryError(null);
        }}
        onConfirm={(password) => {
          void regenerateRecoveryCodes(password);
        }}
      />
    </div>
  );
}
