import { ChevronDown, Menu, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ThemeToggle';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { settingsApi } from '../api';

export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(location.pathname.startsWith('/logs'));
  const currentLogScope = useMemo(() => {
    const scope = new URLSearchParams(location.search).get('scope');
    return scope || 'all';
  }, [location.search]);

  useEffect(() => {
    if (location.pathname.startsWith('/logs')) {
      setLogsExpanded(true);
    }
  }, [location.pathname]);

  const links = useMemo(
    () => [
      { to: '/dashboard', label: t('nav.dashboard') },
      { to: '/accounts', label: t('nav.accounts') },
      { to: '/settings', label: t('nav.settings') },
      ...(user?.role === 'admin' ? [{ to: '/admin', label: t('nav.admin') }] : [])
    ],
    [t, user?.role]
  );

  const logLinks = useMemo(
    () => [
      { to: '/logs?scope=all', label: t('nav.logsAll') },
      { to: '/logs?scope=steam', label: t('nav.logsSteam') },
      { to: '/logs?scope=auth', label: t('nav.logsAuth') },
      { to: '/logs?scope=security', label: t('nav.logsSecurity') }
    ],
    [t]
  );

  const syncTheme = async (theme: 'light' | 'dark') => {
    try {
      await settingsApi.update({ theme });
      await refreshUser();
    } catch {
      // Ignore sync failures in UI.
    }
  };

  const syncLang = async (language: 'en' | 'ru') => {
    try {
      await settingsApi.update({ language });
      await refreshUser();
    } catch {
      // Ignore sync failures in UI.
    }
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-base-200/60 bg-white/90 p-4 backdrop-blur transition duration-300 dark:border-base-700 dark:bg-base-900/90 md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-bold">
            <ShieldCheck size={18} className="text-accent-500" />
            SteamGuard
          </div>
          <button className="md:hidden" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="space-y-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-accent-500 text-white'
                    : 'text-base-700 hover:bg-base-100 dark:text-base-200 dark:hover:bg-base-800'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}

          <div className="space-y-1">
            <button
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition ${
                location.pathname.startsWith('/logs')
                  ? 'bg-accent-500 text-white'
                  : 'text-base-700 hover:bg-base-100 dark:text-base-200 dark:hover:bg-base-800'
              }`}
              onClick={() => setLogsExpanded((prev) => !prev)}
            >
              <span>{t('nav.logs')}</span>
              <ChevronDown
                size={16}
                className={`transition-transform ${logsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {logsExpanded && (
              <div className="ml-2 space-y-1 border-l border-base-200/80 pl-2 dark:border-base-700/80">
                {logLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    onClick={() => setOpen(false)}
                    className={() => {
                      const linkScope = link.to.split('scope=')[1] || 'all';
                      const isActive = location.pathname.startsWith('/logs') && linkScope === currentLogScope;
                      return `block rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                        isActive
                          ? 'bg-accent-500 text-white'
                          : 'text-base-600 hover:bg-base-100 dark:text-base-300 dark:hover:bg-base-800'
                      }`;
                    }}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="mt-8 rounded-xl border border-base-200 bg-white/70 p-3 text-xs dark:border-base-700 dark:bg-base-800/70">
          <div>{user?.email}</div>
          <div className="text-base-500">
            {t('layout.role')}: {user?.role}
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-base-200/60 bg-white/80 px-4 py-3 backdrop-blur dark:border-base-700 dark:bg-base-900/70">
          <button className="md:hidden" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="hidden text-sm md:block">{t('subtitle')}</div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher onChange={(lang) => void syncLang(lang)} />
            <ThemeToggle onChange={(theme) => void syncTheme(theme)} />
            <Button
              variant="secondary"
              onClick={() => {
                void logout();
              }}
            >
              {t('auth.signOut')}
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
