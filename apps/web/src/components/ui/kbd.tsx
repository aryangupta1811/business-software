import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/** A key on the keyboard, shown next to the action it triggers. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border bg-surface px-1.5 font-sans text-label font-medium text-muted',
        className,
      )}
      {...props}
    />
  );
}

/** Keys pressed together, e.g. Alt and H. */
export function KbdGroup({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('inline-flex items-center gap-1', className)} {...props} />;
}
