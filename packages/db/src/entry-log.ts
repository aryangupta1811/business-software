// The only way rows get into the entry log (ADRs 0007, 0028). It takes a transaction, never the
// database, so a log row commits or rolls back with the action it describes.
import { sql } from 'drizzle-orm';
import type { Transaction } from './tenancy.js';

/** Every action the log knows. Each module adds its own names. */
export const ENTRY_ACTIONS = {
  'business.created': { reasonRequired: false }, // Module 00 #7, at signup
  'business.updated': { reasonRequired: false }, // Module 00 #10, settings
  'stock.adjusted': { reasonRequired: true }, // Module 01 #11
  // Logins (sitting 2, 06 L2; Module 00 #20). Failed logins stay with the rate limit.
  'user.logged_in': { reasonRequired: false },
  'user.logged_out': { reasonRequired: false }, // after.cause: logout, idle, replaced
  'session.locked': { reasonRequired: false }, // Module 00 #21, #38
  'session.unlocked': { reasonRequired: false },
  'device.registered': { reasonRequired: false }, // Module 00 #28, #37
  // P1.4 PR 2: account recovery and remembered computers (Module 00 #30-32, #44, #46).
  'user.email_confirmed': { reasonRequired: false },
  'user.password_changed': { reasonRequired: false },
  'user.password_reset': { reasonRequired: false }, // after.via: email, recovery_key
  'recovery_key.replaced': { reasonRequired: false },
  'device.renamed': { reasonRequired: false },
  'device.revoked': { reasonRequired: false },
  // P1.7 (Module 01 #1-3, #8, #16): items, their barcodes, categories and own units.
  'item.created': { reasonRequired: false },
  'item.updated': { reasonRequired: false },
  'item.archived': { reasonRequired: false },
  'item.restored': { reasonRequired: false },
  'item.barcode_added': { reasonRequired: false },
  'item.barcode_removed': { reasonRequired: false },
  'category.created': { reasonRequired: false },
  'category.updated': { reasonRequired: false },
  'category.archived': { reasonRequired: false },
  'category.restored': { reasonRequired: false },
  'unit.created': { reasonRequired: false },
  'unit.updated': { reasonRequired: false },
  'unit.archived': { reasonRequired: false },
  'unit.restored': { reasonRequired: false },
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
  // Untyped code could pass undefined, which Drizzle would store as NULL: "the system".
  if ((entry.actorId as string | null | undefined) === undefined) {
    throw new Error('recordEntry needs actorId (null for the system)');
  }
  // Untyped callers can pass a name the list doesn't have: stored, it would stay for good and
  // skip the reason rule. Object.hasOwn, so 'toString' and friends aren't actions.
  if (!Object.hasOwn(ENTRY_ACTIONS, entry.action)) {
    throw new Error(`Unknown entry action "${entry.action}"`);
  }
  const trimmed = entry.reason?.trim();
  const reason = trimmed === undefined || trimmed === '' ? null : trimmed;
  if (reason === null && ENTRY_ACTIONS[entry.action].reasonRequired) {
    throw new Error(`Entry action "${entry.action}" needs a reason`);
  }
  // Fails here, before the insert, on anything JSON can't hold (a BigInt, a cycle).
  const before = entry.before === undefined ? null : JSON.stringify(entry.before);
  const after = entry.after === undefined ? null : JSON.stringify(entry.after);
  // D4 (ADR 0028 note): app_runtime may not name id, business_id or created_at, so their
  // defaults always apply. Drizzle's insert names every column (sending `default` for the ones
  // left out), which PostgreSQL refuses here, so the column list is written out.
  await tx.execute(sql`
    insert into entry_log
      (branch_id, actor_id, action, entity_type, entity_id, reason, before, after)
    values (${entry.branchId ?? null}, ${entry.actorId}, ${entry.action}, ${entry.entityType},
            ${entry.entityId}, ${reason}, ${before}::jsonb, ${after}::jsonb)`);
}
