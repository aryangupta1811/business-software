import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement } from 'react';

/** A short label shown on hover and on keyboard focus. The trigger keeps its own name. */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
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
