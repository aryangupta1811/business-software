import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement } from 'react';

/**
 * A short label shown on hover and on keyboard focus. The trigger keeps its own name.
 * When the label only repeats that name (an icon button), `repeatsName` keeps it from also
 * becoming the button's description, so screen readers don't read it twice: Radix always
 * adds `aria-describedby` to its trigger, so the trigger becomes a wrapper, which focus and
 * pointer events still reach by bubbling.
 */
export function Tooltip({
  label,
  repeatsName = false,
  children,
}: {
  label: string;
  repeatsName?: boolean;
  children: ReactElement;
}) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          {repeatsName ? <span className="inline-flex">{children}</span> : children}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className="z-50 rounded-md bg-foreground px-2 py-1 text-label text-background"
          >
            {label}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
