// Alerts (Module 07; design `docs/plans/2026-11-22-p2.7-alerts-design.md`). The rules are pure
// so the database code, the API and the tests share one answer to "is this item low?".
import { z } from 'zod';
import type { BusinessType, Permission } from './business.js';
import { isLow } from './stock.js';

/** Every alert type. Later modules add theirs (expiring soon, overdue udhaar...). */
export const ALERT_TYPES = ['low_stock', 'out_of_stock'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** What an alert is about. `batch`, `customer` and `entry` join with their modules. */
export const ALERT_SUBJECT_TYPES = ['item'] as const;
export type AlertSubjectType = (typeof ALERT_SUBJECT_TYPES)[number];

/**
 * Types of one family are one alert that changes type (question 3A): an item is never "low"
 * and "out" at once. The database allows one open alert per subject, branch and family.
 */
export const ALERT_FAMILIES = {
  low_stock: 'stock',
  out_of_stock: 'stock',
} as const satisfies Record<AlertType, string>;

/** Who may see a type (question 1A: stock alerts need `stock.view`). */
export const ALERT_PERMISSIONS = {
  low_stock: 'stock.view',
  out_of_stock: 'stock.view',
} as const satisfies Record<AlertType, Permission>;

/**
 * The types each business type shows in the app at signup (Module 00 #1); the owner can
 * change any later (`07` #3). Each list is in `ALERT_TYPES` order, the order settings saves in.
 */
export const ALERT_PRESETS: Record<BusinessType, readonly AlertType[]> = {
  kirana: ['low_stock', 'out_of_stock'],
  medical: ['low_stock', 'out_of_stock'],
  clothing: ['low_stock', 'out_of_stock'],
  electronics: ['low_stock', 'out_of_stock'],
  hardware: ['low_stock', 'out_of_stock'],
};

/** What the bell shows for a stock alert, fixed when it is raised or changed. */
export interface StockAlertDetails {
  /** Thousandths of the item's stock unit. */
  quantity: number;
  /** The branch's low-stock level; null when none is set. */
  level: number | null;
}

/** An alert as it should be, or is: its type and what it says. */
export interface AlertState {
  type: AlertType;
  details: StockAlertDetails;
}

/**
 * The stock alert an item should have at a branch (`07` #4, #17): out of stock at 0 or below
 * whatever the level, low at or under a level above 0, else none.
 */
export function stockAlert(
  quantity: number,
  level: number | null,
): 'low_stock' | 'out_of_stock' | null {
  if (quantity <= 0) return 'out_of_stock';
  return isLow(quantity, level) ? 'low_stock' : null;
}

export type AlertChange =
  | { do: 'none' }
  | ({ do: 'raise' } & AlertState)
  /** Same type, new numbers: the bell shows the stock now. The alert stays the one raised. */
  | ({ do: 'update' } & AlertState)
  /** Low becomes out or back: one alert changes type (question 3A). */
  | ({ do: 'retype' } & AlertState)
  | { do: 'clear' };

/** What to do to the open alert (or none) so it matches what the stock says it should be. */
export function raiseOrClear(wanted: AlertState | null, open: AlertState | null): AlertChange {
  if (wanted === null) return open === null ? { do: 'none' } : { do: 'clear' };
  if (open === null) return { do: 'raise', ...wanted };
  if (open.type !== wanted.type) return { do: 'retype', ...wanted };
  const same =
    open.details.quantity === wanted.details.quantity &&
    open.details.level === wanted.details.level;
  return same ? { do: 'none' } : { do: 'update', ...wanted };
}

/** The app switches (`07` #3): the types the business sees in the bell. Off still records. */
export const settingsAlertsSchema = z.strictObject({
  types: z
    .array(z.enum(ALERT_TYPES, { error: 'invalid' }), { error: 'invalid' })
    .refine((types) => new Set(types).size === types.length, { error: 'duplicate' })
    // One fixed order, so a reordered list isn't a change (and no entry-log row).
    .transform((types) => ALERT_TYPES.filter((type) => types.includes(type))),
});
export type SettingsAlertsInput = z.infer<typeof settingsAlertsSchema>;

// ---- What the API answers ----

/** One open alert in the bell. */
export interface AlertView {
  id: string;
  type: AlertType;
  subjectType: AlertSubjectType;
  /** The item's id: the bell links to its Stock page. */
  subjectId: string;
  itemName: string;
  itemHindiName: string | null;
  stockUnit: string;
  branchId: string;
  branchName: string;
  details: StockAlertDetails;
  raisedAt: string;
}

/** `GET /api/alerts`: exact counts per type, and the newest rows (up to `ALERT_LIST_LIMIT`). */
export interface AlertList {
  counts: Partial<Record<AlertType, number>>;
  total: number;
  alerts: AlertView[];
}

export const ALERT_LIST_LIMIT = 200;
