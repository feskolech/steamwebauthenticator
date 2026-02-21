import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../layouts/AuthLayout';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../api';

type Mode = 'login' | 'register';

const TELEGRAM_OAUTH_STORAGE_KEY = 'steamguard-telegram-oauth-pending';

type TelegramOAuthPending = {
  code: string;
  pollSecret: string;
  deepLink: string | null;
  manualCommand: string;
  expiresAt: number;
};

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, login, register, verifyTelegram2fa, refreshUser } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telegramCode, setTelegramCode] = useState('');
  const [requires2fa, setRequires2fa] = useState(false);
  const [telegramOAuth, setTelegramOAuth] = useState<{
    code: string;
    pollSecret: string;
    deepLink: string | null;
    manualCommand: string;
    expiresAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    const raw = sessionStorage.getItem(TELEGRAM_OAUTH_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as TelegramOAuthPending;
      if (
        !parsed ||
        typeof parsed.code !== 'string' ||
        typeof parsed.pollSecret !== 'string' ||
        typeof parsed.manualCommand !== 'string' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
        return;
      }

      if (parsed.expiresAt <= Date.now()) {
        sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
        return;
      }

      setTelegramOAuth(parsed);
    } catch {
      sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!telegramOAuth) {
      sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
      return;
    }

    sessionStorage.setItem(TELEGRAM_OAUTH_STORAGE_KEY, JSON.stringify(telegramOAuth));
  }, [telegramOAuth]);

  useEffect(() => {
    if (!telegramOAuth) {
      return;
    }

    const pollOnce = async () => {
      try {
        const status = await authApi.pollTelegramOAuth(telegramOAuth.code, telegramOAuth.pollSecret);
        if (status.status === 'ok') {
          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
          await refreshUser();
          navigate('/dashboard');
          return;
        }

        if (status.status === 'unlinked') {
          setError(t('auth.telegramNotLinked'));
          setTelegramOAuth(null);
          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
          return;
        }

        if (status.status === 'expired') {
          setError(t('auth.telegramCodeExpired'));
          setTelegramOAuth(null);
          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
          return;
        }

        if (status.status === 'used') {
          setError(t('auth.telegramCodeExpired'));
          setTelegramOAuth(null);
          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
        }
      } catch {
        // ignore polling issues
      }
    };

    void pollOnce();
    const timer = setInterval(() => {
      void pollOnce();
    }, 3000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void pollOnce();
      }
    };
    const onFocus = () => {
      void pollOnce();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [telegramOAuth, refreshUser, navigate, t]);

  const submitLabel = useMemo(
    () => (mode === 'login' ? t('auth.signIn') : t('auth.createAccount')),
    [mode, t]
  );

  const onSubmit = async () => {
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const result = await login(email, password);
        if (result.requires2fa) {
          setRequires2fa(true);
        } else {
          navigate('/dashboard');
        }
      } else {
        await register(email, password);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('auth.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const onVerify2fa = async () => {
    setError(null);
    setLoading(true);
    try {
      await verifyTelegram2fa(email, telegramCode);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('auth.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const onTelegramOAuth = async () => {
    setError(null);
    try {
      const response = await authApi.startTelegramOAuth();
      const nextState = {
        ...response,
        expiresAt: Date.now() + response.expiresInSec * 1000
      };
      setTelegramOAuth(nextState);
      if (response.deepLink) {
        const opened = window.open(response.deepLink, '_blank', 'noopener,noreferrer');
        if (!opened) {
          window.location.href = response.deepLink;
        }
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('auth.telegramLoginFailed'));
    }
  };

  const onPasskeyLogin = async () => {
    if (!email) {
      setError(t('auth.emailRequiredPasskey'));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const options = await authApi.webauthnLoginOptions(email);
      const authResponse = await startAuthentication(options as any);
      await authApi.webauthnLoginVerify(email, authResponse);
      await refreshUser();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('auth.passkeyLoginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-5 animate-fade-in-up">
        <div className="flex items-center gap-2 rounded-xl bg-base-100 p-1 dark:bg-base-800">
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${mode === 'login' ? 'bg-white dark:bg-base-900' : ''}`}
            onClick={() => setMode('login')}
          >
            {t('auth.login')}
          </button>
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${mode === 'register' ? 'bg-white dark:bg-base-900' : ''}`}
            onClick={() => setMode('register')}
          >
            {t('auth.register')}
          </button>
        </div>

        <div className="space-y-3">
          <Input
            placeholder={t('auth.email')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            placeholder={t('auth.password')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {requires2fa && (
            <Input
              placeholder={t('auth.telegramCode')}
              value={telegramCode}
              onChange={(event) => setTelegramCode(event.target.value)}
            />
          )}

          {error && <div className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="flex gap-2">
            {!requires2fa ? (
              <Button className="flex-1" onClick={() => void onSubmit()} disabled={loading}>
                {loading ? t('auth.pleaseWait') : submitLabel}
              </Button>
            ) : (
              <Button className="flex-1" onClick={() => void onVerify2fa()} disabled={loading}>
                {t('auth.verify2fa')}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t border-base-200 pt-4 dark:border-base-700">
          <Button variant="secondary" className="w-full" onClick={() => void onTelegramOAuth()}>
            {t('auth.loginTelegram')}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => void onPasskeyLogin()}>
            {t('auth.loginPasskey')}
          </Button>

          {telegramOAuth && (
            <div className="rounded-xl border border-accent-500/20 bg-accent-500/10 p-3 text-xs">
              <div>{t('auth.telegramPending')}</div>
              <div>{t('auth.telegramReturnHint')}</div>
              <div>{t('auth.command')}: {telegramOAuth.manualCommand}</div>
              {telegramOAuth.deepLink && (
                <a className="underline" href={telegramOAuth.deepLink} target="_blank" rel="noreferrer">
                  {t('auth.openBot')}
                </a>
              )}
              <div className="pt-2">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    void authApi
                      .pollTelegramOAuth(telegramOAuth.code, telegramOAuth.pollSecret)
                      .then(async (status) => {
                        if (status.status === 'ok') {
                          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
                          await refreshUser();
                          navigate('/dashboard');
                          return;
                        }

                        if (status.status === 'expired' || status.status === 'used') {
                          setError(t('auth.telegramCodeExpired'));
                          setTelegramOAuth(null);
                          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
                          return;
                        }

                        if (status.status === 'unlinked') {
                          setError(t('auth.telegramNotLinked'));
                          setTelegramOAuth(null);
                          sessionStorage.removeItem(TELEGRAM_OAUTH_STORAGE_KEY);
                        }
                      })
                      .catch(() => undefined);
                  }}
                >
                  {t('auth.checkNow')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
