// The provider of the owner's branch choice (see branch-scope-context.ts).
import type { ActiveSession } from '@business-software/shared';
import { useMemo, useState, type ReactNode } from 'react';
import {
  clearBranchScope,
  hasPicker,
  NONE,
  ScopeContext,
  STORAGE_KEY,
  storedBranchScope,
  type Scope,
  type ScopeChoice,
} from './branch-scope-context';

export function BranchScopeProvider({
  session,
  children,
}: {
  session: ActiveSession | null;
  children: ReactNode;
}) {
  const [choice, setChoice] = useState<ScopeChoice | null>(storedBranchScope);
  const active = hasPicker(session);
  const value = useMemo<Scope>(() => {
    if (!active) return NONE;
    const current = choice ?? session.branch.id;
    return {
      param: current,
      choice: current,
      choose: (next) => {
        setChoice(next);
        try {
          sessionStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Blocked storage: the choice still holds until the tab reloads.
        }
      },
      reset: () => {
        setChoice(null);
        clearBranchScope();
      },
    };
  }, [active, choice, session]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
