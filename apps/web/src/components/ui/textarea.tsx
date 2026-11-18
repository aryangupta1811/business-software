import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** A multi-line Input, for addresses and notes. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={3}
      className={cn(
        'w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
