import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeToggle } from '../components/ThemeToggle';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card relative grid w-full max-w-5xl grid-cols-1 overflow-hidden p-0 md:grid-cols-[1.1fr_1fr]">
        <div className="absolute right-8 top-8 z-20 hidden gap-2 md:flex">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
        <div className="relative hidden p-10 md:block">
          <div className="absolute inset-0 bg-gradient-to-br from-accent-500/20 to-transparent" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <h1 className="text-3xl font-bold">{t('appName')}</h1>
              <p className="mt-3 max-w-sm text-sm text-base-700 dark:text-base-200">{t('subtitle')}</p>
            </div>
            <div className="rounded-2xl border border-base-200/50 bg-white/60 p-4 text-xs dark:border-base-700 dark:bg-base-900/60">
              {t('authLayout.description')}
            </div>
          </div>
        </div>
        <div className="p-6 md:p-10">
          <div className="mb-4 flex gap-2 md:hidden">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
