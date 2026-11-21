// Which branch a read page shows (P1.6, ADR 0045). Writes never come through here: they happen
// at the computer's branch, `Caller.branchId`. The owner may look at any branch, or at all of
// them where the page can add them up; staff always get the branch they are logged in at,
// whatever they send. An id that isn't one of this business's branches matches no rows (row-level
// security hides the others), so it shows an empty page, never another business's data.
import type { Caller } from '../http/session.js';

/** One branch's id, or the word `all` for every branch. */
export type BranchScope = string;

/**
 * The branch a read shows. `fallback` is what the owner gets with no `?branch=`: the
 * computer's branch for lists and history, `all` for a page that already shows every branch.
 */
export function branchScope(
  caller: Caller,
  requested: string | undefined,
  fallback: 'caller' | 'all',
): BranchScope {
  if (caller.role !== 'owner') return caller.branchId;
  return requested ?? (fallback === 'all' ? 'all' : caller.branchId);
}
