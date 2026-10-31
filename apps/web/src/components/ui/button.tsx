import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,filter] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Hover darkens rather than lightens, so white text never loses contrast.
        primary: 'bg-primary text-on-primary hover:brightness-95',
        secondary: 'bg-surface-muted text-foreground hover:brightness-95',
        ghost: 'text-foreground hover:bg-surface-muted',
        danger: 'bg-danger-strong text-on-primary hover:brightness-95',
      },
      size: {
        default: 'h-10 px-4 text-body',
        sm: 'h-8 px-3 text-label',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
