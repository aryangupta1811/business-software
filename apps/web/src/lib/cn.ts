import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Our text sizes replace Tailwind's (styles.css). Without this, tailwind-merge reads
// `text-body` as a colour and drops it when a `text-muted` comes later, or the reverse.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { 'font-size': [{ text: ['label', 'body', 'section', 'title', 'figure'] }] },
  },
});

/** Joins class names; a later Tailwind class wins over an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
