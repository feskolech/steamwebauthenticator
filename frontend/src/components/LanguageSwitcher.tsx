import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';

type Props = {
  onChange?: (lang: 'en' | 'ru') => void;
};

export function LanguageSwitcher({ onChange }: Props) {
  const { i18n, t } = useTranslation();
  const current = i18n.language.startsWith('ru') ? 'ru' : 'en';

  const next = current === 'en' ? 'ru' : 'en';

  return (
    <Button
      variant="secondary"
      className="h-10 gap-2"
      onClick={() => {
        void i18n.changeLanguage(next);
        onChange?.(next);
      }}
      title={`${t('settings.language')}: ${current.toUpperCase()}`}
    >
      <Globe size={16} />
      {current.toUpperCase()}
    </Button>
  );
}
