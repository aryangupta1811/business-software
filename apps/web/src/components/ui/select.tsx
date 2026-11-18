import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** A native select, styled like Input: typing a letter jumps to it, as everywhere else. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-body text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
