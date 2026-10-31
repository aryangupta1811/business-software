import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useShortcutContext } from './context';
import type { Shortcut } from './registry';

/** Makes a shortcut work while the calling component is on screen. */
export function useShortcut({ keys, description, group, action }: Shortcut): void {
  const { registry } = useShortcutContext();
  // The latest action, so a re-render with a new function doesn't re-register.
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });
  useEffect(
    () =>
      registry.register({
        keys,
        description,
        group,
        action: () => {
          actionRef.current();
        },
      }),
    [registry, keys, description, group],
  );
}

/** The shortcuts that work right now, re-rendering when they change. */
export function useActiveShortcuts(): readonly Shortcut[] {
  const { registry } = useShortcutContext();
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.active(),
  );
}

/** Opens the shortcut list, for a visible button: mouse users never press ? by chance. */
export function useOpenShortcutHelp(): () => void {
  return useShortcutContext().openHelp;
}
