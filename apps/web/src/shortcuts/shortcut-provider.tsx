import { useEffect, useState, type ReactNode } from 'react';
import { ShortcutContext } from './context';
import { ShortcutRegistry } from './registry';
import { ShortcutHelp } from './shortcut-help';

/** Listens for shortcuts on the whole page; `?` opens the list of what works here. */
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new ShortcutRegistry());
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (registry.handle(event)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [registry]);

  useEffect(
    () =>
      registry.register({
        keys: '?',
        description: 'shortcuts.openHelp',
        group: 'general',
        action: () => {
          setHelpOpen(true);
        },
      }),
    [registry],
  );

  useEffect(() => {
    registry.setPaused(helpOpen);
  }, [registry, helpOpen]);

  return (
    <ShortcutContext value={registry}>
      {children}
      <ShortcutHelp
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
        }}
      />
    </ShortcutContext>
  );
}
