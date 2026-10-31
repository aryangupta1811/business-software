import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-body text-foreground placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
