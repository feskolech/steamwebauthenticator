import { MoonStar, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { useTheme } from '../hooks/useTheme';

type Props = {
  onChange?: (theme: 'light' | 'dark') => void;
};

export function ThemeToggle({ onChange }: Props) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="secondary"
      className="h-10 gap-2"
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        onChange?.(next);
      }}
      title={`${t('settings.theme')}: ${theme === 'dark' ? t('settings.dark') : t('settings.light')}`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <MoonStar size={16} />}
      <span>{t('settings.theme')}</span>
    </Button>
  );
}
