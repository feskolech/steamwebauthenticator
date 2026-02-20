import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { useTranslation } from 'react-i18next';
import { settingsApi, authApi } from '../api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useAuth } from '../contexts/AuthContext';

export function SettingsPage() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [language, setLanguage] = useState<'en' | 'ru'>('en');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [steamUserId, setSteamUserId] = useState('');
  const [twofaMethod, setTwofaMethod] = useState<'none' | 'telegram' | 'webauthn'>('none');
  const [telegramInfo, setTelegramInfo] = useState<{ linked: boolean; username: string | null }>({
    linked: false,
    username: null
  });
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const settings = await settingsApi.get();
    setLanguage(settings.language);
    setTheme(settings.theme);
    setSteamUserId(settings.steamUserId ?? '');
    setTwofaMethod(settings.twofaMethod);
    setTelegramInfo({
      linked: settings.telegramLinked,
      username: settings.telegramUsername
    });
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      await settingsApi.update({
        language,
        theme,
        steamUserId: steamUserId || null,
        twofaMethod
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
            <div className="mb-1">{t('settings.steamUserId')}</div>
            <Input value={steamUserId} onChange={(event) => setSteamUserId(event.target.value)} />
          </label>

          <label className="text-sm">
            <div className="mb-1">{t('settings.twofa')}</div>
            <select
              className="input-base"
              value={twofaMethod}
              onChange={(event) =>
                setTwofaMethod(event.target.value as 'none' | 'telegram' | 'webauthn')
              }
            >
              <option value="none">{t('settings.none')}</option>
              <option value="telegram">{t('settings.telegramCodeMethod')}</option>
              <option value="webauthn">{t('settings.passkeyMethod')}</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()}>{t('common.save')}</Button>
          <Button variant="secondary" onClick={() => void registerPasskey()}>
            {t('settings.registerPasskey')}
          </Button>
        </div>
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

      {message && <div className="text-sm text-base-500">{message}</div>}
    </div>
  );
}
