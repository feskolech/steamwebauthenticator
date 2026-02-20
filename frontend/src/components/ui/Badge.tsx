import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger';

export function Badge({
  className,
  children,
  variant = 'default'
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        {
          'bg-base-200 text-base-800 dark:bg-base-700 dark:text-base-100': variant === 'default',
          'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300': variant === 'success',
          'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300': variant === 'warning',
          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300': variant === 'danger'
        },
        className
      )}
    >
      {children}
    </span>
  );
}
