// The only way rows get into the entry log (ADRs 0007, 0028). It takes a transaction, never the
// database, so a log row commits or rolls back with the action it describes.
import { entryLog } from './schema.js';
import type { Transaction } from './tenancy.js';

/** Every action the log knows. Each module adds its own names. */
export const ENTRY_ACTIONS = {
  'stock.adjusted': { reasonRequired: true }, // Module 01 #11
} as const satisfies Record<string, { reasonRequired: boolean }>;

export type EntryAction = keyof typeof ENTRY_ACTIONS;

export interface EntryInput {
  /** The logged-in person; `null` only for the system (e.g. the worker). */
  actorId: string | null;
  action: EntryAction;
  entityType: string;
  entityId: string;
  branchId?: string;
  reason?: string;
  /** Plain JSON; money as integer paise (ADR 0008). */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export async function recordEntry(tx: Transaction, entry: EntryInput): Promise<void> {
  // Untyped callers can pass a name the list doesn't have; it then needs no reason.
  const rules: Partial<Record<string, { reasonRequired: boolean }>> = ENTRY_ACTIONS;
  const trimmed = entry.reason?.trim();
  const reason = trimmed === undefined || trimmed === '' ? null : trimmed;
  if (reason === null && rules[entry.action]?.reasonRequired) {
    throw new Error(`Entry action "${entry.action}" needs a reason`);
  }
  // Fails here, before the insert, on anything JSON can't hold (a BigInt, a cycle).
  JSON.stringify([entry.before, entry.after]);
  await tx.insert(entryLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    branchId: entry.branchId,
    reason,
    before: entry.before,
    after: entry.after,
  });
}
