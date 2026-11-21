// Stock (Module 01 #4, #9–12; design `docs/plans/2026-11-20-p1.8-stock-ledger-design.md`).
// Quantities are signed whole thousandths of the item's stock unit, money whole paise (ADR 0008).
import { z } from 'zod';
import { optionalText, uuid } from './fields.js';
import type { Paise } from './money.js';
import type { BuiltInUnit } from './units.js';

/** What a stock movement can be. Sales, purchases, transfers and counts add theirs later. */
export const STOCK_MOVEMENT_KINDS = ['opening', 'adjustment'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** Module 01 #12 (owner answer 1A): one switch for the whole business, `warn` by default. */
export const NEGATIVE_STOCK_SETTINGS = ['warn', 'block'] as const;
export type NegativeStockSetting = (typeof NEGATIVE_STOCK_SETTINGS)[number];

/** Module 01 #11 (owner answer 3B). */
export const ADJUSTMENT_REASONS = [
  'damaged',
  'expired',
  'theft',
  'own_use',
  'count_mismatch',
  'other',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Only a count mismatch can add stock: after opening stock, stock comes in by purchase (#10). */
export const REASON_DIRECTIONS: Record<AdjustmentReason, 'down' | 'both'> = {
  damaged: 'down',
  expired: 'down',
  theft: 'down',
  own_use: 'down',
  count_mismatch: 'both',
  other: 'down',
};

/** A billion units: far above any stock, far below 2^53 (as in items). */
const MAX_THOUSANDTHS = 1_000_000_000_000;
/** ₹10 crore (as in items). */
const MAX_PAISE = 10_000_000_000;

/** Stock units counted whole (owner answer 6A): half a piece is always a typing mistake. */
const WHOLE_UNITS: ReadonlySet<BuiltInUnit> = new Set([
  'piece',
  'pair',
  'dozen',
  'box',
  'pack',
  'bag',
]);

/** Why a quantity can't move stock in `unit`, or null when it can. */
export function stockQuantityProblem(
  unit: BuiltInUnit,
  quantity: number,
): 'invalid' | 'whole_units_only' | null {
  if (!Number.isSafeInteger(quantity) || quantity === 0) return 'invalid';
  if (WHOLE_UNITS.has(unit) && quantity % 1_000 !== 0) return 'whole_units_only';
  return null;
}

/** |a| / b rounded half up, in BigInt so products past 2^53 stay exact. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** A movement's value: quantity × unit cost per stock unit, to the paisa, half away from zero. */
export function movementValue(quantity: number, unitCost: Paise): Paise {
  const magnitude = divideHalfUp(BigInt(Math.abs(quantity)) * BigInt(unitCost), 1_000n);
  return Number(quantity < 0 ? -magnitude : magnitude);
}

/**
 * The average cost per stock unit after a movement (Module 01 #4). Stock in at a known cost
 * weighs the old stock and the new; when there was no stock (or less than none), or its cost
 * was unknown, the incoming cost stands for all of it. Stock out leaves it unchanged.
 */
export function averageAfter(
  oldQuantity: number,
  oldAverage: Paise | null,
  quantity: number,
  unitCost: Paise | null,
): Paise | null {
  if (quantity <= 0 || unitCost === null) return oldAverage;
  if (oldQuantity <= 0 || oldAverage === null) return unitCost;
  const total = BigInt(oldQuantity) * BigInt(oldAverage) + BigInt(quantity) * BigInt(unitCost);
  return Number(divideHalfUp(total, BigInt(oldQuantity + quantity)));
}

/**
 * What a movement may do when it takes stock below zero. `refuse` is for write-offs (owner
 * answer 2A); `warn` and `block` are the business's setting for sales (#12, P1.14). A movement
 * that adds stock, or ends at zero or above, is always fine.
 */
export function belowZeroOutcome(
  policy: 'refuse' | NegativeStockSetting,
  quantity: number,
  balanceAfter: number,
): 'ok' | 'warn' | 'refuse' {
  if (quantity >= 0 || balanceAfter >= 0) return 'ok';
  return policy === 'warn' ? 'warn' : 'refuse';
}

/** Module 07 #4: at or below the branch's level. A level of 0 (or none) means no alert. */
export function isLow(quantity: number, level: number | null): boolean {
  return level !== null && level > 0 && quantity <= level;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The day in India (IST, no daylight saving) an instant belongs to, as `YYYY-MM-DD`. */
export function businessDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// ---- Request bodies ----

const choose = (issue: { input?: unknown }) =>
  issue.input === undefined || issue.input === null || issue.input === '' ? 'choose' : 'invalid';

/** Opening stock (#9, owner answer 4A). `unitCost` is left out by callers without `items.view_cost`. */
export const openingStockSchema = z.strictObject({
  quantity: z
    .int({ error: 'invalid' })
    .min(1, { error: 'too_small' })
    .max(MAX_THOUSANDTHS, { error: 'too_big' }),
  /** Paise per stock unit. Null or left out: the item's known cost (its purchase price). */
  unitCost: z
    .int({ error: 'invalid' })
    .min(0, { error: 'too_small' })
    .max(MAX_PAISE, { error: 'too_big' })
    .nullable()
    .optional(),
  /** The screen makes one per attempt and sends it again on a retry (ADR 0007 rule 7). */
  requestKey: uuid(),
});
export type OpeningStockInput = z.infer<typeof openingStockSchema>;

/** An adjustment (#11): a signed change, a reason that allows its direction, an optional note. */
export const adjustmentSchema = z
  .strictObject({
    quantity: z
      .int({ error: 'invalid' })
      .min(-MAX_THOUSANDTHS, { error: 'too_small' })
      .max(MAX_THOUSANDTHS, { error: 'too_big' })
      .refine((quantity) => quantity !== 0, { error: 'invalid' }),
    reason: z.enum(ADJUSTMENT_REASONS, { error: choose }),
    note: optionalText(200),
    requestKey: uuid(),
  })
  .superRefine((value, context) => {
    // Zod runs this even when a field failed its own check, so compare only valid values.
    const reason: unknown = value.reason;
    if (typeof reason !== 'string' || !Object.hasOwn(REASON_DIRECTIONS, reason)) return;
    if (
      REASON_DIRECTIONS[reason as AdjustmentReason] === 'down' &&
      Number.isSafeInteger(value.quantity) &&
      value.quantity > 0
    ) {
      context.addIssue({ code: 'custom', path: ['quantity'], message: 'wrong_direction' });
    }
    if (reason === 'other' && value.note === null) {
      context.addIssue({ code: 'custom', path: ['note'], message: 'required' });
    }
  });
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

/** The history's filters (`GET /api/items/:id/stock/movements`). */
export const movementQuerySchema = z.strictObject({
  branch: uuid().optional(),
  /** The last movement id of the previous page. */
  after: uuid().optional(),
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

// ---- What the API answers ----

export interface BranchStockView {
  branchId: string;
  branchName: string;
  quantity: number;
  /** The branch's low-stock level, or null when none is set. */
  lowStockLevel: number | null;
  low: boolean;
  /** Opening stock can still be typed: nothing has moved this item at this branch (4A). */
  canOpen: boolean;
  /** Absent, not null, for a caller without `items.view_cost`. */
  averageCost?: Paise | null;
  value?: Paise | null;
}

export interface ItemStockView {
  itemId: string;
  stockUnit: BuiltInUnit;
  branches: BranchStockView[];
}

export interface MovementView {
  id: string;
  branchId: string;
  kind: StockMovementKind;
  quantity: number;
  balanceAfter: number;
  /** Absent for a caller without `items.view_cost`. */
  unitCost?: Paise | null;
  value?: Paise | null;
  reason: AdjustmentReason | null;
  note: string | null;
  businessDate: string;
  actorId: string;
  /** The person's name, else their username; null for an owner who hasn't set a name. */
  actorName: string | null;
  /** So the page can still say who it was when there is no name: "Owner". */
  actorRole: 'owner' | 'staff';
  createdAt: string;
}

export interface MovementPage {
  movements: MovementView[];
  /** Pass as `after` for the next page; null on the last one. */
  next: string | null;
}
