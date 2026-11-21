import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  heldBills,
  isNull,
  recordEntry,
  sql,
  users,
  type Database,
  type SQL,
  type Transaction,
} from '@business-software/db';
import type {
  BillCart,
  HeldBillView,
  HoldBillInput,
  ResumedBillView,
} from '@business-software/shared';
import { DATABASE } from '../database.module.js';
import { inBusiness } from '../items/conflicts.js';
import type { Caller } from '../http/session.js';

type HeldBillRecord = typeof heldBills.$inferSelect;

const isOpen = and(isNull(heldBills.resumedAt), isNull(heldBills.discardedAt));

/** What a discarded bill leaves in the log (question 7): enough to see what was thrown away. */
export function discardedEntry(
  draft: BillCart,
  totalPaise: number,
  held: { id: string; label: string | null } | null,
): Record<string, unknown> {
  return {
    heldBillId: held?.id ?? null,
    label: held?.label ?? null,
    lines: draft.lines,
    lineCount: draft.lines.length,
    totalPaise,
  };
}

/**
 * Held bills (P1.13 design §9; `02` #8): kept on the server per branch, so any counter of the
 * branch can bring one back and a closed Chrome loses nothing. They never touch stock. Closed by
 * resuming or discarding, never deleted.
 */
@Injectable()
export class HeldBillsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** The caller's branch's open held bills, newest first. */
  list(caller: Caller): Promise<HeldBillView[]> {
    return inBusiness(this.database, caller, (tx) =>
      this.views(tx, and(eq(heldBills.branchId, caller.branchId), isOpen)),
    );
  }

  /** Holds the open bill. A retry (the same bill key still held) answers the first copy. */
  hold(caller: Caller, input: HoldBillInput): Promise<HeldBillView> {
    return inBusiness(this.database, caller, async (tx) => {
      const [inserted] = await tx
        .insert(heldBills)
        .values({
          branchId: caller.branchId,
          billKey: input.draft.billKey,
          label: input.label,
          draft: input.draft,
          totalPaise: input.shownTotalPaise,
          lineCount: input.draft.lines.length,
          heldBy: caller.userId,
        })
        .onConflictDoNothing()
        .returning({ id: heldBills.id });
      let id = inserted?.id;
      if (id === undefined) {
        // A retry: the first copy is still held. At another branch, the key isn't this bill's.
        const [first] = await tx
          .select({ id: heldBills.id, branchId: heldBills.branchId })
          .from(heldBills)
          .where(and(eq(heldBills.billKey, input.draft.billKey), isOpen));
        if (first?.branchId !== caller.branchId) {
          throw new ConflictException({ code: 'bill_key_taken' });
        }
        id = first.id;
      }
      const [view] = await this.views(tx, eq(heldBills.id, id));
      if (view === undefined) throw new Error('Held bill not found after holding it');
      return view;
    });
  }

  /** Brings a held bill back to this counter and closes it; a second resume answers 409. */
  resume(caller: Caller, id: string): Promise<ResumedBillView> {
    return inBusiness(this.database, caller, async (tx) => {
      const row = await this.close(tx, caller, id, { resumedAt: new Date() });
      return { draft: row.draft as BillCart };
    });
  }

  /** Throws a held bill away: closed, never deleted, and logged with what was on it. */
  discard(caller: Caller, id: string): Promise<{ billKey: string }> {
    return inBusiness(this.database, caller, async (tx) => {
      const row = await this.close(tx, caller, id, { discardedAt: new Date() });
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'bill.draft_discarded',
        entityType: 'bill',
        entityId: row.billKey,
        branchId: caller.branchId,
        after: discardedEntry(row.draft as BillCart, row.totalPaise, row),
      });
      return { billKey: row.billKey };
    });
  }

  /** Closes an open held bill of the caller's branch: 404 if there's none, 409 if closed. */
  private async close(
    tx: Transaction,
    caller: Caller,
    id: string,
    how: { resumedAt: Date } | { discardedAt: Date },
  ): Promise<HeldBillRecord> {
    const mine = and(eq(heldBills.id, id), eq(heldBills.branchId, caller.branchId));
    const [row] = await tx
      .update(heldBills)
      .set({ ...how, closedBy: caller.userId, updatedAt: new Date() })
      .where(and(mine, isOpen))
      .returning();
    if (row !== undefined) return row;
    const [exists] = await tx.select({ id: heldBills.id }).from(heldBills).where(mine);
    if (exists === undefined) throw new NotFoundException({ code: 'not_found' });
    throw new ConflictException({ code: 'held_bill_closed' });
  }

  private async views(tx: Transaction, where: SQL | undefined): Promise<HeldBillView[]> {
    const rows = await tx
      .select({
        bill: heldBills,
        heldByName: sql<string>`coalesce(${users.name}, ${users.email}, ${users.username})`,
      })
      .from(heldBills)
      .innerJoin(users, eq(users.id, heldBills.heldBy))
      .where(where)
      .orderBy(desc(heldBills.id));
    return rows.map(({ bill, heldByName }) => ({
      id: bill.id,
      label: bill.label,
      lineCount: bill.lineCount,
      totalPaise: bill.totalPaise,
      heldBy: { id: bill.heldBy, name: heldByName },
      heldAt: bill.createdAt.toISOString(),
    }));
  }
}
