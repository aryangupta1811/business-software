import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ShortcutContext } from './context';
import { ShortcutRegistry } from './registry';
import { ShortcutHelp } from './shortcut-help';

/** Listens for shortcuts on the whole page; `?` opens the list of what works here. */
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new ShortcutRegistry());
  const [helpOpen, setHelpOpen] = useState(false);
  const context = useMemo(
    () => ({
      registry,
      openHelp: () => {
        setHelpOpen(true);
      },
    }),
    [registry],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      registry.handle(event);
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
        action: context.openHelp,
      }),
    [registry, context],
  );

  return (
    <ShortcutContext value={context}>
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
