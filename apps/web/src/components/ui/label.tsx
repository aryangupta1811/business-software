import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  // jsx-a11y can't see that callers pass htmlFor, so it's checked where Label is used.
  // eslint-disable-next-line jsx-a11y/label-has-associated-control
  return <label className={cn('text-label font-medium text-foreground', className)} {...props} />;
}
