// Which branch a read page shows (P1.6, ADR 0045). Writes always happen at the computer's
// branch; this only changes what Items and Stock show, and only for an owner with two or more
// branches. Remembered per tab, so a reload keeps it and a new tab starts at "this counter".
import type { ActiveSession } from '@business-software/shared';
import { createContext, useContext } from 'react';

export const STORAGE_KEY = 'business-software.branch-scope';

/** One branch's id, or `all`. */
export type ScopeChoice = string;

export function storedBranchScope(): ScopeChoice | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Forgets the choice (a logout: the next person starts at this counter's branch). */
export function clearBranchScope(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; the choice then lives only in memory.
  }
}

export interface Scope {
  /** What to send as `?branch=`; undefined when the caller has no choice to make. */
  param: ScopeChoice | undefined;
  /** What the picker shows as selected. */
  choice: ScopeChoice | null;
  choose: (choice: ScopeChoice) => void;
  /** Back to this counter's branch (the remembered branch was archived). */
  reset: () => void;
}

export const NONE: Scope = {
  param: undefined,
  choice: null,
  choose: () => undefined,
  reset: () => undefined,
};

export const ScopeContext = createContext<Scope>(NONE);

/** The owner's branch choice, for the pages that read branch data. */
export const useBranchScope = () => useContext(ScopeContext);

/** True when the picker applies: the owner, in a business with two or more live branches. */
export const hasPicker = (session: ActiveSession | null): session is ActiveSession =>
  session !== null && session.user.role === 'owner' && (session.branchCount ?? 1) > 1;
