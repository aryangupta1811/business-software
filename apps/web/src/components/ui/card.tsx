import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-lg bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 pt-4', className)} {...props} />;
}

/** A card's heading: `h2` on a page, `h3` when the card sits under a section's own `h2`. */
export function CardTitle({
  className,
  children,
  level = 2,
  ...props
}: ComponentProps<'h2'> & { level?: 2 | 3 }) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <Heading className={cn('text-section font-semibold', className)} {...props}>
      {children}
    </Heading>
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}
