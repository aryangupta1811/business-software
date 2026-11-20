// What the stock dialogs send (P1.8, design §5 and §7), checked here with the API's own rules
// so a mistake shows under its field before anything is sent. The API checks again.
import {
  ADJUSTMENT_REASONS,
  adjustmentSchema,
  fieldErrors,
  openingStockSchema,
  parseRupees,
  REASON_DIRECTIONS,
  stockQuantityProblem,
  type AdjustmentInput,
  type AdjustmentReason,
  type BuiltInUnit,
  type FieldErrors,
  type OpeningStockInput,
} from '@business-software/shared';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';
import { formatQuantity, parseQuantity } from './item-form';
import { unitName } from './labels';

/** -500 → "-0.5", 12500 → "12.5": thousandths as a person reads them, with a sign. */
export function quantityText(thousandths: number): string {
  return `${thousandths < 0 ? '-' : ''}${formatQuantity(Math.abs(thousandths))}`;
}

/** A quantity in thousandths with its unit: "12.5 kg", "-2 piece". */
export const stockText = (t: TFunction, quantity: number, unit: BuiltInUnit): string =>
  `${quantityText(quantity)} ${unitName(t, unit)}`;

export type Direction = 'remove' | 'add';

/** The reasons that allow a direction: only a count mismatch adds stock (owner answer 3B). */
export function reasonsFor(direction: Direction): AdjustmentReason[] {
  return direction === 'add'
    ? ADJUSTMENT_REASONS.filter((reason) => REASON_DIRECTIONS[reason] === 'both')
    : [...ADJUSTMENT_REASONS];
}

/** A typed quantity in the stock unit, as positive thousandths, or the field's error code. */
function typedQuantity(unit: BuiltInUnit, typed: string): number | { error: string } {
  if (typed.trim() === '') return { error: 'required' };
  const quantity = parseQuantity(typed);
  if (quantity === null) return { error: 'invalid' };
  if (quantity === 0) return { error: 'too_small' };
  const problem = stockQuantityProblem(unit, quantity);
  return problem === null ? quantity : { error: problem };
}

type Checked<T> = { body: T } | { errors: FieldErrors };

export interface AdjustForm {
  direction: Direction;
  reason: string;
  quantity: string;
  note: string;
}

export function adjustmentBody(
  form: AdjustForm,
  unit: BuiltInUnit,
  requestKey: string,
): Checked<AdjustmentInput> {
  const quantity = typedQuantity(unit, form.quantity);
  const parsed = adjustmentSchema.safeParse({
    quantity:
      typeof quantity === 'number' ? (form.direction === 'remove' ? -quantity : quantity) : 1,
    reason: form.reason === '' ? undefined : form.reason,
    note: form.note,
    requestKey,
  });
  const errors: FieldErrors = parsed.success ? {} : fieldErrors(parsed.error);
  if (typeof quantity !== 'number') errors.quantity = quantity.error;
  return Object.keys(errors).length === 0 && parsed.success ? { body: parsed.data } : { errors };
}

export interface OpeningForm {
  quantity: string;
  /** Rupees as typed; left out entirely for a caller who may not see costs. */
  unitCost?: string;
}

export function openingBody(
  form: OpeningForm,
  unit: BuiltInUnit,
  requestKey: string,
): Checked<OpeningStockInput> {
  const errors: FieldErrors = {};
  const quantity = typedQuantity(unit, form.quantity);
  if (typeof quantity !== 'number') errors.quantity = quantity.error;
  let unitCost: number | undefined;
  if (form.unitCost !== undefined) {
    const paise = parseRupees(form.unitCost);
    if (form.unitCost.trim() === '') errors.unitCost = 'required';
    else if (paise === null) errors.unitCost = 'invalid';
    else unitCost = paise;
  }
  if (typeof quantity !== 'number' || Object.keys(errors).length > 0) return { errors };
  const parsed = openingStockSchema.safeParse({
    quantity,
    ...(unitCost !== undefined && { unitCost }),
    requestKey,
  });
  return parsed.success ? { body: parsed.data } : { errors: fieldErrors(parsed.error) };
}

/** The longest a busy answer may make the dialog wait, whatever its header says. */
const MAX_BUSY_WAIT_SECONDS = 3;

export function busyWaitMs(retryAfterSeconds: number | undefined): number {
  return Math.min(retryAfterSeconds ?? 1, MAX_BUSY_WAIT_SECONDS) * 1000;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Sends a stock change. When another counter holds the item's row (`503 busy`, design §7), it
 * waits as asked and sends the very same body once more: the request key makes a second copy
 * harmless, so a change that did land is answered, not made twice (ADR 0007 rule 7).
 */
export async function sendStockChange<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'busy') throw error;
    await wait(busyWaitMs(error.retryAfterSeconds));
    return send();
  }
}
