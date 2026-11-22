import type { BillDraft, SavedBillView } from '@business-software/shared';
import { ApiError, apiRequest } from '../api/client';
import type { PaymentRow } from './payment-panel';
import type { Approval } from './discounts';
import type { OpenBill } from './open-bill';

/** A lost answer is asked again twice more, after a short pause (P1.14 design §3.1, §6). */
const ATTEMPTS = 3;
export const RETRY_DELAY_MS = 800;

/** The save request. The open bill keeps its state code as plain text; the server checks it. */
export type SaveRequest = Omit<BillDraft, 'placeOfSupplyStateCode'> & {
  placeOfSupplyStateCode: string;
};

/**
 * The save request: the open bill, its payments and the total the cashier saw. The owner's OK
 * and the held bill only go along when they belong to this very bill.
 */
export function billDraft(
  bill: OpenBill,
  payments: readonly PaymentRow[],
  grandTotalPaise: number,
  approval: Approval | null,
  held: { id: string; billKey: string } | null,
): SaveRequest {
  return {
    ...bill,
    payments: [...payments],
    shownGrandTotalPaise: grandTotalPaise,
    ...(approval?.billKey === bill.billKey && { approvalId: approval.approvalId }),
    ...(held?.billKey === bill.billKey && { heldBillId: held.id }),
  };
}

/**
 * `POST /api/bills`. A lost answer (no connection, or no answer in time) is sent again with the
 * same bill key: the server answers the bill it already saved, so one bill is never two. An
 * answer from the server, even a refusal, is final.
 */
export async function saveBill(
  draft: SaveRequest,
  retryDelayMs = RETRY_DELAY_MS,
): Promise<SavedBillView> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await apiRequest<SavedBillView>('POST', '/api/bills', draft);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'network') || attempt >= ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

/** The lines `409 prices_changed` named, with the server's price for each (1-based). */
export type NewPrices = { line: number; unitPricePaise: number }[];

/** The bill with the server's prices on the lines it named, and the indexes that changed. */
export function applyNewPrices(
  bill: OpenBill,
  prices: NewPrices,
): { bill: OpenBill; changed: number[] } {
  const changed: number[] = [];
  const lines = bill.lines.map((line, index) => {
    const price = prices.find((candidate) => candidate.line === index + 1)?.unitPricePaise;
    if (price === undefined || price === line.shownUnitPricePaise) return line;
    changed.push(index);
    return { ...line, shownUnitPricePaise: price };
  });
  return { bill: changed.length === 0 ? bill : { ...bill, lines }, changed };
}

/** Why a save didn't happen, as the counter tells the cashier. */
export type SaveProblem =
  | { kind: 'prices_changed'; lines: NewPrices }
  | { kind: 'stock_short'; itemId: string }
  | { kind: 'items_unavailable'; lines: number[] }
  | { kind: (typeof PLAIN)[number] }
  | { kind: 'network' }
  | { kind: 'failed' };

// Codes whose message needs nothing from the answer.
const PLAIN = [
  'approval_required',
  'approval_invalid',
  'gstin_required',
  'buyer_details_required',
  'customer_unavailable',
  'wholesale_off',
  'place_of_supply',
  'held_bill_invalid',
  'invalid_quantity',
  'payments_mismatch',
  'key_reused',
] as const;

export function saveProblem(error: unknown): SaveProblem {
  if (!(error instanceof ApiError)) return { kind: 'failed' };
  const { code, detail } = error;
  if (code === 'network') return { kind: 'network' };
  if (code === 'prices_changed' && Array.isArray(detail.lines)) {
    return { kind: code, lines: detail.lines as NewPrices };
  }
  if (code === 'stock_short' && typeof detail.itemId === 'string') {
    return { kind: code, itemId: detail.itemId };
  }
  if (code === 'items_unavailable' && Array.isArray(detail.lines)) {
    return { kind: code, lines: detail.lines as number[] };
  }
  const plain = PLAIN.find((known) => known === code);
  return plain === undefined ? { kind: 'failed' } : { kind: plain };
}
