import { createContext, useContext } from 'react';
import type { ShortcutRegistry } from './registry';

export interface ShortcutContextValue {
  registry: ShortcutRegistry;
  /** Opens the list of shortcuts, for a button as well as the ? key. */
  openHelp: () => void;
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcutContext(): ShortcutContextValue {
  const context = useContext(ShortcutContext);
  if (!context) throw new Error('Shortcuts need a <ShortcutProvider> above them');
  return context;
}
