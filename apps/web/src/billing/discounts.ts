import {
  cartToBillInput,
  discountShares,
  discountWithinLimit,
  parseRupees,
  type ActiveSession,
  type BillingContext,
  type Discount,
  type DiscountLimits,
} from '@business-software/shared';
import type { CatalogueCopy } from './catalogue-copy';
import { lineProblem, type OpenBill } from './open-bill';

/** An owner's OK for this bill's discounts (design §6): up to these shares, until it expires. */
export interface Approval extends DiscountLimits {
  approvalId: string;
  billKey: string;
  expiresAt: string;
}

/**
 * The most this person may discount without the owner (`02` #12): null for the owner (no
 * limit); a staff login's own limit, or 0 without `billing.discount` (they can still ask).
 */
export function discountLimit(session: ActiveSession, context: BillingContext): number | null {
  if (session.discountLimitBasisPoints === null) return null;
  return context.canDiscount ? session.discountLimitBasisPoints : 0;
}

/**
 * The shares an owner's OK must cover, or null when the bill needs none: within the person's
 * limit, or within a live approval for this very bill. Not checked while a line can't be priced.
 */
export function approvalNeeded(
  bill: OpenBill,
  context: BillingContext,
  copy: CatalogueCopy,
  limit: number | null,
  approval: Approval | null,
  now: number,
): DiscountLimits | null {
  if (limit === null || bill.lines.length === 0) return null;
  if (bill.lines.some((line) => lineProblem(line, copy, context.scheme) !== null)) return null;
  const input = cartToBillInput(bill, {
    scheme: context.scheme,
    supplierStateCode: context.branchStateCode,
    catalogue: copy.entries,
  });
  if (discountWithinLimit(input, limit)) return null;
  if (
    approval !== null &&
    approval.billKey === bill.billKey &&
    Date.parse(approval.expiresAt) > now &&
    discountWithinLimit(input, approval)
  ) {
    return null;
  }
  return discountShares(input);
}

const PERCENT = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/;

/**
 * A typed discount: a percent (up to two decimals, at most 100) or rupees. Empty or zero means
 * no discount (null); anything else that doesn't read is 'invalid'.
 */
export function parseDiscount(kind: Discount['kind'], typed: string): Discount | null | 'invalid' {
  if (typed.trim() === '') return null;
  if (kind === 'percent') {
    const match = PERCENT.exec(typed);
    if (match === null) return 'invalid';
    const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    if (basisPoints > 10_000) return 'invalid';
    return basisPoints === 0 ? null : { kind: 'percent', basisPoints };
  }
  const paise = parseRupees(typed);
  if (paise === null) return 'invalid';
  return paise === 0 ? null : { kind: 'amount', paise };
}

/** How a discount reads back in its box: 12.5 for 1,250 bp, 20.00 for 2,000 paise. */
export function discountText(discount: Discount | undefined): string {
  if (discount === undefined) return '';
  if (discount.kind === 'percent') return String(discount.basisPoints / 100);
  return (discount.paise / 100).toFixed(2);
}

/** Puts `discount` on a line (or takes it off with null). */
export function withLineDiscount(
  bill: OpenBill,
  index: number,
  discount: Discount | null,
): OpenBill {
  return {
    ...bill,
    lines: bill.lines.map((line, at) => {
      if (at !== index) return line;
      const rest = { ...line };
      delete rest.discount;
      return discount === null ? rest : { ...rest, discount };
    }),
  };
}

/** Puts `discount` on the whole bill (or takes it off with null). */
export function withBillDiscount(bill: OpenBill, discount: Discount | null): OpenBill {
  const rest = { ...bill };
  delete rest.billDiscount;
  return discount === null ? rest : { ...rest, billDiscount: discount };
}

// An owner's OK lives with its bill in this tab, so a reload keeps it (the server keeps it too).
const PREFIX = 'bill-approval:';

export function saveApproval(approval: Approval): void {
  try {
    sessionStorage.setItem(PREFIX + approval.billKey, JSON.stringify(approval));
  } catch {
    // Storage blocked: the OK lasts until the page closes.
  }
}

export function loadApproval(billKey: string): Approval | null {
  try {
    const stored = sessionStorage.getItem(PREFIX + billKey);
    if (stored === null) return null;
    const value = JSON.parse(stored) as Partial<Approval>;
    return typeof value.approvalId === 'string' &&
      value.billKey === billKey &&
      typeof value.expiresAt === 'string' &&
      typeof value.lineBasisPoints === 'number' &&
      typeof value.billBasisPoints === 'number'
      ? (value as Approval)
      : null;
  } catch {
    return null;
  }
}
