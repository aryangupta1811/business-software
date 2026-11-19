// The only way stock changes (ADR 0007 rules 3, 4 and 6; P1.8 design §6). It takes a
// transaction, never the database, so the movements commit or roll back with the action that
// caused them, its entry log row included.
import {
  averageAfter,
  belowZeroOutcome,
  movementValue,
  stockQuantityProblem,
  type AdjustmentReason,
  type BuiltInUnit,
  type NegativeStockSetting,
  type Paise,
  type StockMovementKind,
} from '@business-software/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { items, itemStock, stockMovements } from './schema.js';
import type { Transaction } from './tenancy.js';

export interface StockLine {
  itemId: string;
  kind: StockMovementKind;
  /** Signed thousandths of the item's stock unit. */
  quantity: number;
  /**
   * Paise per stock unit for stock coming in (opening stock, later purchases). Left out or
   * null: the branch's average cost, else the item's purchase price. Stock going out always
   * leaves at the average (Module 01 #4).
   */
  unitCost?: Paise | null;
  /** Adjustments only (Module 01 #11). */
  reason?: AdjustmentReason;
  note?: string | null;
}

export interface MoveStockInput {
  branchId: string;
  actorId: string;
  /** The IST day the action belongs to (`06` #7); see `businessDate()` in shared. */
  businessDate: string;
  /**
   * What a line that takes stock below zero does: `refuse` for write-offs (owner answer 2A),
   * or the business's `negative_stock` setting for sales (#12).
   */
  belowZero: 'refuse' | NegativeStockSetting;
  /** Idempotency (ADR 0007 rule 7), for a call with one line. Bills key the bill instead. */
  requestKey?: string;
  lines: readonly StockLine[];
}

export interface MovedLine {
  movementId: string;
  itemId: string;
  quantity: number;
  balanceBefore: number;
  balanceAfter: number;
  unitCost: Paise | null;
  value: Paise | null;
  /** The branch's average cost after this line. */
  averageCost: Paise | null;
  /** Taken below zero under the `warn` setting: the counter shows a warning. */
  warned: boolean;
}

export type StockRuleCode =
  | 'not_found'
  | 'archived'
  | 'service_has_no_stock'
  | 'invalid'
  | 'whole_units_only'
  | 'opening_exists'
  | 'cost_required'
  | 'below_zero';

/** A line broke a stock rule; nothing was written. The API turns `code` into its answer. */
export class StockRuleError extends Error {
  constructor(
    readonly code: StockRuleCode,
    readonly itemId: string,
  ) {
    super(`Stock rule ${code} for item ${itemId}`);
    this.name = 'StockRuleError';
  }
}

interface ItemFacts {
  kind: string;
  stockUnit: BuiltInUnit;
  purchasePrice: Paise | null;
  archived: boolean;
}

/** A map entry the code above has just made sure of. */
function entry<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`No entry for ${key}`);
  return value;
}

interface Balance {
  quantity: number;
  averageCost: Paise | null;
  lastMovementId: string | null;
}

/**
 * Applies `lines` at one branch: locks each item's stock row in item-ID order (so two calls
 * can never deadlock), checks the rules, writes one movement per line and updates the totals.
 * Throws `StockRuleError` before writing anything if a line breaks a rule.
 */
export async function moveStock(tx: Transaction, input: MoveStockInput): Promise<MovedLine[]> {
  if (input.requestKey !== undefined && input.lines.length !== 1) {
    throw new Error('moveStock takes a request key for one line only');
  }
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))].sort();
  if (itemIds.length === 0) return [];

  // FOR SHARE: no one archives or edits these items until this transaction ends. Shared
  // locks don't block each other, so two bills with the same items both proceed.
  const itemRows = await tx
    .select({
      id: items.id,
      kind: items.kind,
      stockUnit: items.stockUnit,
      purchasePrice: items.purchasePrice,
      archivedAt: items.archivedAt,
    })
    .from(items)
    .where(inArray(items.id, itemIds))
    .orderBy(asc(items.id))
    .for('share');
  const facts = new Map<string, ItemFacts>(
    itemRows.map((row) => [
      row.id,
      {
        kind: row.kind,
        stockUnit: row.stockUnit as BuiltInUnit,
        purchasePrice: row.purchasePrice,
        archived: row.archivedAt !== null,
      },
    ]),
  );
  // Rules that need only the item, before any stock row is created.
  for (const line of input.lines) {
    const item = facts.get(line.itemId);
    if (item === undefined) throw new StockRuleError('not_found', line.itemId);
    if (item.kind !== 'goods') throw new StockRuleError('service_has_no_stock', line.itemId);
    if (item.archived) throw new StockRuleError('archived', line.itemId);
    const problem = stockQuantityProblem(item.stockUnit, line.quantity);
    if (problem !== null) throw new StockRuleError(problem, line.itemId);
    if (line.kind === 'opening' && line.quantity < 0) {
      throw new StockRuleError('invalid', line.itemId);
    }
  }

  // The first movement of an item at a branch makes its row. Rows are inserted and then
  // locked in item-ID order, the order every caller uses (ADR 0007 rule 6).
  await tx
    .insert(itemStock)
    .values(itemIds.map((itemId) => ({ branchId: input.branchId, itemId })))
    .onConflictDoNothing({ target: [itemStock.businessId, itemStock.branchId, itemStock.itemId] });
  const stockRows = await tx
    .select({
      itemId: itemStock.itemId,
      quantity: itemStock.quantity,
      averageCost: itemStock.averageCost,
      lastMovementId: itemStock.lastMovementId,
    })
    .from(itemStock)
    .where(and(eq(itemStock.branchId, input.branchId), inArray(itemStock.itemId, itemIds)))
    .orderBy(asc(itemStock.itemId))
    .for('update');
  const balances = new Map<string, Balance>(stockRows.map((row) => [row.itemId, { ...row }]));

  const moved: MovedLine[] = [];
  for (const line of input.lines) {
    const item = entry(facts, line.itemId);
    const balance = entry(balances, line.itemId);
    if (line.kind === 'opening' && balance.lastMovementId !== null) {
      throw new StockRuleError('opening_exists', line.itemId);
    }
    const balanceAfter = balance.quantity + line.quantity;
    const outcome = belowZeroOutcome(input.belowZero, line.quantity, balanceAfter);
    if (outcome === 'refuse') throw new StockRuleError('below_zero', line.itemId);

    const known = balance.averageCost ?? item.purchasePrice;
    const unitCost = line.quantity > 0 ? (line.unitCost ?? known) : known;
    if (line.kind === 'opening' && unitCost === null) {
      throw new StockRuleError('cost_required', line.itemId);
    }
    const value = unitCost === null ? null : movementValue(line.quantity, unitCost);
    const averageCost = averageAfter(
      balance.quantity,
      balance.averageCost,
      line.quantity,
      unitCost,
    );

    const [row] = await tx
      .insert(stockMovements)
      .values({
        branchId: input.branchId,
        itemId: line.itemId,
        kind: line.kind,
        quantity: line.quantity,
        unitCost,
        value,
        balanceAfter,
        businessDate: input.businessDate,
        reason: line.reason ?? null,
        note: line.note ?? null,
        actorId: input.actorId,
        requestKey: input.requestKey ?? null,
      })
      .returning({ id: stockMovements.id });
    if (row === undefined) throw new Error('No movement row returned');

    moved.push({
      movementId: row.id,
      itemId: line.itemId,
      quantity: line.quantity,
      balanceBefore: balance.quantity,
      balanceAfter,
      unitCost,
      value,
      averageCost,
      warned: outcome === 'warn',
    });
    balances.set(line.itemId, { quantity: balanceAfter, averageCost, lastMovementId: row.id });
  }

  for (const itemId of itemIds) {
    const balance = entry(balances, itemId);
    await tx
      .update(itemStock)
      .set({
        quantity: balance.quantity,
        averageCost: balance.averageCost,
        lastMovementId: balance.lastMovementId,
        updatedAt: new Date(),
      })
      .where(and(eq(itemStock.branchId, input.branchId), eq(itemStock.itemId, itemId)));
  }
  return moved;
}

export interface StockMismatch {
  branchId: string;
  itemId: string;
  quantity: number;
  /** The sum of the item's movements at the branch. */
  moved: number;
  /** The balance after the movement the row says came last; null if there is none. */
  lastBalance: number | null;
}

/**
 * Totals that disagree with their ledger, in the current business: a total that isn't the sum
 * of its movements, or isn't the balance after its last one. Empty means the ledger holds.
 * Tests run it after every stock test; it is also the evening check's one-line audit.
 */
export async function findStockMismatches(tx: Transaction): Promise<StockMismatch[]> {
  const { rows } = await tx.execute<{
    branch_id: string;
    item_id: string;
    quantity: string;
    moved: string;
    last_balance: string | null;
  }>(sql`
    select s.branch_id, s.item_id, s.quantity,
           coalesce((select sum(m.quantity) from stock_movements m
                      where m.branch_id = s.branch_id and m.item_id = s.item_id), 0) as moved,
           (select m.balance_after from stock_movements m where m.id = s.last_movement_id)
             as last_balance
      from item_stock s
     where s.quantity <> coalesce((select sum(m.quantity) from stock_movements m
                                    where m.branch_id = s.branch_id and m.item_id = s.item_id), 0)
        or s.quantity is distinct from coalesce(
             (select m.balance_after from stock_movements m where m.id = s.last_movement_id), 0)
    union all
    select m.branch_id, m.item_id, 0, sum(m.quantity), null
      from stock_movements m
     where not exists (select 1 from item_stock s
                        where s.branch_id = m.branch_id and s.item_id = m.item_id)
     group by m.branch_id, m.item_id`);
  return rows.map((row) => ({
    branchId: row.branch_id,
    itemId: row.item_id,
    quantity: Number(row.quantity),
    moved: Number(row.moved),
    lastBalance: row.last_balance === null ? null : Number(row.last_balance),
  }));
}
