import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

type SensitiveActionModalProps = {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (password: string) => void;
};

export function SensitiveActionModal({
  open,
  title,
  description,
  busy,
  error,
  onClose,
  onConfirm
}: SensitiveActionModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!open) {
      setPassword('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-base-200 bg-white p-5 shadow-xl dark:border-base-700 dark:bg-base-900">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-base-500">{description}</p>
        <div className="mt-3">
          <Input
            autoFocus
            type="password"
            placeholder={t('auth.currentPassword')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && password.trim() && !busy) {
                onConfirm(password);
              }
            }}
          />
        </div>
        {error && <div className="mt-2 text-sm text-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(password)} disabled={busy || !password.trim()}>
            {busy ? t('auth.pleaseWait') : t('auth.confirmPassword')}
          </Button>
        </div>
      </div>
    </div>
  );
}
