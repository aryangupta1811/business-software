// Raising, changing and clearing alerts (ADR 0046). Every caller that changes what an alert is
// about, moveStock and the item screens, calls these inside its own transaction, so an alert
// can never disagree with the stock: both commit together or neither does.
import {
  ALERT_FAMILIES,
  raiseOrClear,
  stockAlert,
  type AlertState,
} from '@business-software/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alerts, itemBranchLevels, items, itemStock } from './schema.js';
import type { Transaction } from './tenancy.js';

export interface SyncScope {
  itemIds: readonly string[];
  /** Only this branch; left out, every branch that has stock of the items. */
  branchId?: string;
}

/**
 * Makes each item's open stock alert (`07` #1, #4, #17) match its stock now: raised when it
 * crosses its level, changed (low to out and back, or new numbers), cleared when it recovers.
 * An archived item has none. An item nothing has moved at a branch has no stock row there,
 * so no alert: it hasn't run out, it was never stocked. Callers hold the item's lock (moveStock
 * the stock rows, the item screens the item row), so two syncs of one item never race on the
 * "one open alert" index. Writes nothing when nothing changes, and no entry-log row ever: the
 * change that caused the alert already is one.
 */
export async function syncStockAlerts(tx: Transaction, scope: SyncScope): Promise<void> {
  if (scope.itemIds.length === 0) return;
  const branch = (column: typeof itemStock.branchId | typeof alerts.branchId) =>
    scope.branchId === undefined ? undefined : eq(column, scope.branchId);

  const stock = await tx
    .select({
      branchId: itemStock.branchId,
      itemId: itemStock.itemId,
      quantity: itemStock.quantity,
      level: itemBranchLevels.lowStockLevel,
      archivedAt: items.archivedAt,
    })
    .from(itemStock)
    .innerJoin(items, eq(items.id, itemStock.itemId))
    .leftJoin(
      itemBranchLevels,
      and(
        eq(itemBranchLevels.itemId, itemStock.itemId),
        eq(itemBranchLevels.branchId, itemStock.branchId),
      ),
    )
    .where(and(inArray(itemStock.itemId, [...scope.itemIds]), branch(itemStock.branchId)));
  const open = await tx
    .select({
      id: alerts.id,
      branchId: alerts.branchId,
      subjectId: alerts.subjectId,
      type: alerts.type,
      details: alerts.details,
    })
    .from(alerts)
    .where(
      and(
        isNull(alerts.clearedAt),
        eq(alerts.subjectType, 'item'),
        eq(alerts.family, 'stock'),
        inArray(alerts.subjectId, [...scope.itemIds]),
        branch(alerts.branchId),
      ),
    );
  const openAt = new Map(open.map((row) => [`${row.branchId}/${row.subjectId}`, row]));

  for (const row of stock) {
    const type = row.archivedAt === null ? stockAlert(row.quantity, row.level) : null;
    const wanted: AlertState | null =
      type === null ? null : { type, details: { quantity: row.quantity, level: row.level } };
    const current = openAt.get(`${row.branchId}/${row.itemId}`);
    const change = raiseOrClear(
      wanted,
      current === undefined
        ? null
        : { type: current.type as AlertState['type'], details: current.details },
    );
    switch (change.do) {
      case 'none':
        break;
      case 'raise':
        await tx.insert(alerts).values({
          branchId: row.branchId,
          type: change.type,
          family: ALERT_FAMILIES[change.type],
          subjectType: 'item',
          subjectId: row.itemId,
          details: change.details,
        });
        break;
      case 'update':
      case 'retype':
        await tx
          .update(alerts)
          .set({
            type: change.type,
            family: ALERT_FAMILIES[change.type],
            details: change.details,
            updatedAt: sql`now()`,
          })
          .where(eq(alerts.id, requireOpen(current).id));
        break;
      case 'clear':
        await tx
          .update(alerts)
          .set({ clearedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(alerts.id, requireOpen(current).id));
        break;
    }
  }
}

/** The open alert a change refers to; raiseOrClear only asks to change one that exists. */
function requireOpen<T>(current: T | undefined): T {
  if (current === undefined) throw new Error('No open alert to change');
  return current;
}
