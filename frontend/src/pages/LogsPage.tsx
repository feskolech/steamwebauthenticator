import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { logApi } from '../api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import type { LogItem } from '../types';

type Scope = 'all' | 'steam' | 'auth' | 'security';

const VALID_SCOPES: Scope[] = ['all', 'steam', 'auth', 'security'];

function normalizeScope(raw: string | null): Scope {
  if (raw && VALID_SCOPES.includes(raw as Scope)) {
    return raw as Scope;
  }
  return 'all';
}

export function LogsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const scope = normalizeScope(searchParams.get('scope'));

  const scopeOptions = useMemo(
    () => [
      { value: 'all' as const, label: t('logs.scope.all') },
      { value: 'steam' as const, label: t('logs.scope.steam') },
      { value: 'auth' as const, label: t('logs.scope.auth') },
      { value: 'security' as const, label: t('logs.scope.security') }
    ],
    [t]
  );

  const load = async (nextScope: Scope) => {
    setLoading(true);
    try {
      const response = await logApi.list(undefined, nextScope);
      setLogs(response.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(scope);
  }, [scope]);

  const setScope = (next: Scope) => {
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set('scope', next);
      return updated;
    });
    setMenuOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('logs.title')}</h1>
        <div className="relative">
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {t('logs.filterButton')}: {scopeOptions.find((item) => item.value === scope)?.label}
            <ChevronDown size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-base-200 bg-white p-2 shadow-lg dark:border-base-700 dark:bg-base-900">
              {scopeOptions.map((item) => (
                <button
                  key={item.value}
                  className={`block w-full rounded-lg px-2 py-2 text-left text-sm transition ${
                    scope === item.value
                      ? 'bg-accent-500 text-white'
                      : 'hover:bg-base-100 dark:hover:bg-base-800'
                  }`}
                  onClick={() => setScope(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card>
        <div className="space-y-2">
          {loading && <div className="text-sm text-base-500">{t('common.loading')}</div>}

          {!loading &&
            logs.map((item) => (
              <div key={item.id} className="rounded-xl border border-base-200 p-3 dark:border-base-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
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
                      {item.accountAlias && (
                        <span className="text-xs text-base-500">{item.accountAlias}</span>
                      )}
                    </div>
                    <div className="font-semibold">
                      {t(`logs.events.${item.eventKey}`, item.context)}
                    </div>
                  </div>
                  <div className="text-xs text-base-500">{new Date(item.createdAt).toLocaleString()}</div>
                </div>

                <div className="mt-2">
                  <Button
                    variant="secondary"
                    className="h-8 text-xs"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [item.id]: !prev[item.id]
                      }))
                    }
                  >
                    {expanded[item.id] ? t('logs.hideDetails') : t('logs.showDetails')}
                  </Button>
                </div>

                {expanded[item.id] && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-base-100 p-2 text-xs dark:bg-base-800">
                    {JSON.stringify(item.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}

          {!loading && logs.length === 0 && <div className="text-sm text-base-500">{t('logs.noLogs')}</div>}
        </div>
      </Card>
    </div>
  );
}

