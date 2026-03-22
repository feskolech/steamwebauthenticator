import { useEffect, useMemo, useRef, useState } from 'react';
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
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

type TelegramOAuthPending = {
  code: string;
  pollSecret: string;
  deepLink: string | null;
  manualCommand: string;
  expiresAt: number;
};

type RegisterChallenge = {
  token: string;
  minFillMs: number;
  expiresAt: number;
};

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, login, register, verifyTelegram2fa, verifyTotp2fa, verifyRecoveryCode, refreshUser } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [company, setCompany] = useState('');
  const [twofaCode, setTwofaCode] = useState('');
  const [twofaMethod, setTwofaMethod] = useState<'telegram' | 'totp' | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [registerChallenge, setRegisterChallenge] = useState<RegisterChallenge | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(!TURNSTILE_SITE_KEY);
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
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstilePromiseRef = useRef<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    timeoutId: number | null;
  } | null>(null);

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (mode !== 'register') {
      setRegisterChallenge(null);
      return;
    }

    let cancelled = false;

    const loadChallenge = async () => {
      try {
        const response = await authApi.registerChallenge();
        if (!cancelled) {
          setRegisterChallenge({
            token: response.token,
            minFillMs: response.minFillMs,
            expiresAt: Date.now() + response.expiresInSec * 1000
          });
        }
      } catch {
        if (!cancelled) {
          setRegisterChallenge(null);
        }
      }
    };

    void loadChallenge();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    setRequires2fa(false);
    setTwofaMethod(null);
    setTwofaCode('');
    setUseRecoveryCode(false);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'register' || !TURNSTILE_SITE_KEY) {
      setTurnstileReady(!TURNSTILE_SITE_KEY);
      return;
    }

    let cancelled = false;
    let widgetId: string | null = null;

    const renderWidget = () => {
      if (cancelled || !window.turnstile) {
        return;
      }

      const container = document.getElementById('turnstile-register-widget');
      if (!container) {
        return;
      }

      container.innerHTML = '';
      widgetId = window.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'auto',
        execution: 'execute',
        callback: (token: string) => {
          const pending = turnstilePromiseRef.current;
          if (pending) {
            if (pending.timeoutId) {
              window.clearTimeout(pending.timeoutId);
            }
            turnstilePromiseRef.current = null;
            pending.resolve(token);
          }
        },
        'expired-callback': () => {
          const pending = turnstilePromiseRef.current;
          if (pending) {
            if (pending.timeoutId) {
              window.clearTimeout(pending.timeoutId);
            }
            turnstilePromiseRef.current = null;
            pending.reject(new Error(t('auth.completeAntiBot')));
          }
          if (widgetId) {
            window.turnstile?.reset(widgetId);
          }
        },
        'error-callback': () => {
          const pending = turnstilePromiseRef.current;
          if (pending) {
            if (pending.timeoutId) {
              window.clearTimeout(pending.timeoutId);
            }
            turnstilePromiseRef.current = null;
            pending.reject(new Error(t('auth.turnstileUnavailable')));
          }
        }
      });
      turnstileWidgetIdRef.current = widgetId;
      setTurnstileReady(true);
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]');
    if (window.turnstile) {
      renderWidget();
    } else if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.turnstileScript = 'true';
      script.onload = () => {
        renderWidget();
      };
      document.head.appendChild(script);
    } else {
      existingScript.addEventListener('load', renderWidget, { once: true });
    }

    return () => {
      cancelled = true;
      const pending = turnstilePromiseRef.current;
      if (pending) {
        if (pending.timeoutId) {
          window.clearTimeout(pending.timeoutId);
        }
        turnstilePromiseRef.current = null;
      }
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      turnstileWidgetIdRef.current = null;
    };
  }, [mode, t]);

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

  const executeTurnstile = async (): Promise<string> => {
    if (!TURNSTILE_SITE_KEY) {
      return '';
    }

    const widgetId = turnstileWidgetIdRef.current;
    if (!window.turnstile || !widgetId || !turnstileReady) {
      throw new Error(t('auth.turnstileUnavailable'));
    }

    if (turnstilePromiseRef.current) {
      throw new Error(t('auth.completeAntiBot'));
    }

    return new Promise<string>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        turnstilePromiseRef.current = null;
        reject(new Error(t('auth.turnstileTimedOut')));
      }, 15000);

      turnstilePromiseRef.current = { resolve, reject, timeoutId };

      try {
        window.turnstile?.reset(widgetId);
        window.turnstile?.execute(widgetId);
      } catch {
        window.clearTimeout(timeoutId);
        turnstilePromiseRef.current = null;
        reject(new Error(t('auth.turnstileUnavailable')));
      }
    });
  };

  const onSubmit = async () => {
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const result = await login(email, password);
        if (result.requires2fa) {
          setRequires2fa(true);
          setTwofaMethod(result.method ?? 'telegram');
        } else {
          navigate('/dashboard');
        }
      } else {
        if (!registerChallenge || registerChallenge.expiresAt <= Date.now()) {
          const nextChallenge = await authApi.registerChallenge();
          setRegisterChallenge({
            token: nextChallenge.token,
            minFillMs: nextChallenge.minFillMs,
            expiresAt: Date.now() + nextChallenge.expiresInSec * 1000
          });
          throw new Error(t('auth.registrationFormExpired'));
        }

        const turnstileToken = TURNSTILE_SITE_KEY ? await executeTurnstile() : undefined;
        await register(email, password, registerChallenge.token, inviteCode, company, turnstileToken);
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
      if (useRecoveryCode) {
        await verifyRecoveryCode(email, password, twofaCode);
      } else if (twofaMethod === 'totp') {
        await verifyTotp2fa(email, twofaCode);
      } else {
        await verifyTelegram2fa(email, twofaCode);
      }
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
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('auth.telegramLoginFailed'));
    }
  };

  const onPasskeyLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const options = await authApi.webauthnLoginOptions(email || undefined);
      const authResponse = await startAuthentication(options as any);
      await authApi.webauthnLoginVerify(authResponse, {
        email: email || undefined,
        challenge: typeof (options as any).challenge === 'string' ? (options as any).challenge : undefined
      });
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
          {mode === 'register' && (
            <>
              <Input
                placeholder={t('auth.inviteCodeOptional')}
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              />
              <input
                type="text"
                name="company"
                autoComplete="off"
                tabIndex={-1}
                className="hidden"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
              {TURNSTILE_SITE_KEY && (
                <div className="turnstile-hidden-shell" aria-hidden="true">
                  <div id="turnstile-register-widget" className="turnstile-widget" />
                </div>
              )}
            </>
          )}

          {requires2fa && (
              <Input
                placeholder={
                  useRecoveryCode
                    ? t('auth.recoveryCode')
                    : twofaMethod === 'totp'
                      ? t('auth.totpCode')
                      : t('auth.telegramCode')
                }
                value={twofaCode}
                onChange={(event) => setTwofaCode(event.target.value)}
              />
            )}

          {error && <div className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="flex gap-2">
            {!requires2fa ? (
              <Button
                className="flex-1"
                onClick={() => void onSubmit()}
                disabled={loading || (mode === 'register' && (!registerChallenge || !turnstileReady))}
              >
                {loading ? t('auth.pleaseWait') : submitLabel}
              </Button>
            ) : (
              <div className="flex w-full flex-col gap-2">
                <Button className="flex-1" onClick={() => void onVerify2fa()} disabled={loading}>
                  {useRecoveryCode ? t('auth.useRecoveryCode') : t('auth.verify2fa')}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setUseRecoveryCode((current) => !current);
                    setTwofaCode('');
                  }}
                  disabled={loading}
                >
                  {useRecoveryCode ? t('auth.usePrimary2fa') : t('auth.useRecoveryCodeInstead')}
                </Button>
              </div>
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
