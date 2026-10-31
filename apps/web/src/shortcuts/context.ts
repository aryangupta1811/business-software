import { createContext, useContext } from 'react';
import type { ShortcutRegistry } from './registry';

export const ShortcutContext = createContext<ShortcutRegistry | null>(null);

export function useShortcutRegistry(): ShortcutRegistry {
  const registry = useContext(ShortcutContext);
  if (!registry) throw new Error('Shortcuts need a <ShortcutProvider> above them');
  return registry;
}
