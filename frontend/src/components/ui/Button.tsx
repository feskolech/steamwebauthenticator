import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        {
          'bg-accent-500 text-white hover:bg-accent-600': variant === 'primary',
          'border border-base-200 bg-white/80 text-base-800 hover:bg-base-100 dark:border-base-700 dark:bg-base-800 dark:text-base-100 dark:hover:bg-base-700':
            variant === 'secondary',
          'bg-danger text-white hover:bg-red-700': variant === 'danger'
        },
        className
      )}
      {...props}
    />
  );
}
