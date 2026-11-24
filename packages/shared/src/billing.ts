// The billing counter's rules (P1.13, design `docs/plans/2026-11-20-p1.13-billing-design.md`):
// the catalogue copy's shape, pricing a cart, the staff discount limit, the save request and the
// search. The screen and the server (P1.14) call the same functions, so they can't disagree.
// Money in paise, rates and shares in basis points, quantities in thousandths (ADR 0008).
import { z } from 'zod';
import type { Feature } from './business.js';
import { optionalText, uuid } from './fields.js';
import { calculateBill, type BillInput, type Discount, type TaxScheme } from './gst.js';
import { MAX_PAISE, MAX_THOUSANDTHS, packPrice, type ItemKind } from './items.js';
import type { Paise } from './money.js';
import { isStateCode } from './states.js';
import type { NegativeStockSetting } from './stock.js';
import type { BuiltInUnit } from './units.js';

/** Question 10: one switch per bill; an item with no wholesale price sells at retail. */
export const PRICE_LISTS = ['retail', 'wholesale'] as const;
export type PriceList = (typeof PRICE_LISTS)[number];

/** The ways money arrives (`02` #10); a payment recorded against udhaar uses these. */
export const MONEY_PAYMENT_MODES = ['cash', 'upi', 'card', 'cheque'] as const;
export type MoneyPaymentMode = (typeof MONEY_PAYMENT_MODES)[number];

/**
 * `02` #10, `03` #6: the four ways money arrives, then the unpaid part going on the customer's
 * udhaar, and the customer's advance used up. The last two take no cash handed over and no
 * reference.
 */
export const PAYMENT_MODES = [...MONEY_PAYMENT_MODES, 'udhaar', 'advance'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Udhaar and advance settle part of a bill without money changing hands. */
const isLedgerMode = (mode: PaymentMode) => mode === 'udhaar' || mode === 'advance';

// ---- The catalogue copy in the browser (design §4) ----

export interface CataloguePack {
  id: string;
  unitCode: BuiltInUnit | null;
  /** The owner's own unit's name; null for a built-in unit. */
  unitName: string | null;
  /** Thousandths of the item's stock unit in one pack. */
  size: number;
  /** Null: size × the item's price. */
  sellingPrice: Paise | null;
  mrp: Paise | null;
  soldAsPack: boolean;
}

export interface CatalogueBarcode {
  code: string;
  /** Null: the code is for the stock unit. */
  packId: string | null;
}

/** A live item as the counter sees it. Never the purchase price. */
export interface CatalogueItem {
  id: string;
  archived: false;
  kind: ItemKind;
  name: string;
  hindiName: string | null;
  code: string | null;
  stockUnit: BuiltInUnit;
  sellingPrice: Paise;
  wholesalePrice: Paise | null;
  mrp: Paise | null;
  priceIncludesTax: boolean;
  gstRate: number | null;
  hsn: string | null;
  /** +1 on every save: of two copies of an item, the higher version is newer. */
  version: number;
  packs: CataloguePack[];
  barcodes: CatalogueBarcode[];
}

/** An archived item, kept so a scan of its code can say so. */
export interface ArchivedCatalogueItem {
  id: string;
  archived: true;
  name: string;
  barcodes: CatalogueBarcode[];
}

export type CatalogueEntry = CatalogueItem | ArchivedCatalogueItem;

/** Stock at the caller's branch, sent only to callers with `stock.view`. */
export interface CatalogueStock {
  itemId: string;
  quantity: number;
  lowStockLevel: number | null;
}

/** `GET /api/billing/catalogue[?since=]`. */
export interface CatalogueView {
  items: CatalogueEntry[];
  /** Null without `stock.view`. */
  stock: CatalogueStock[] | null;
  /** Ask the next sync for changes since 60 s before this (design §4, the overlap). */
  serverTime: string;
}

/** `GET /api/billing/context`: what the counter needs besides the catalogue. */
export interface BillingContext {
  /** The business's GST status, which is the GST engine's scheme. */
  scheme: TaxScheme;
  /** The caller's branch's state: the supplier's state and the default place of supply. */
  branchStateCode: string;
  /** `wholesale_price` shows the retail/wholesale switch (F8). */
  features: Feature[];
  /** What the save does with a line that takes stock below zero (P1.14). */
  negativeStock: NegativeStockSetting;
  canViewStock: boolean;
  /** `items.manage`: an unknown code offers "Add item" (question 8). */
  canManageItems: boolean;
  canViewCustomers: boolean;
  canManageCustomers: boolean;
  /** `billing.discount`: discounts up to the session's limit; above it, the owner's OK. */
  canDiscount: boolean;
}

/** `GET /api/billing/catalogue`: everything, or only what changed at or after `since`. */
export const catalogueQuerySchema = z.strictObject({
  since: z.iso.datetime({ offset: true, error: 'invalid' }).optional(),
});
export type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;

// ---- Pricing a cart (design §5) ----

/** A line on the bill, as the screen keeps it and the save request carries it. */
export interface CartLine {
  itemId: string;
  /** Null: sold in the item's stock unit. */
  packId: string | null;
  /** Of the pack, or of the stock unit. */
  quantityThousandths: number;
  /** The price the cashier saw; the server compares it with its own (design §10). */
  shownUnitPricePaise: Paise;
  discount?: Discount;
}

/**
 * The price of one stock unit or one pack. A pack has its own price or size × the item's. In a
 * wholesale bill an item's wholesale price is used, but never above the retail one, so it can't
 * pass a pack's MRP either.
 */
export function linePrice(item: CatalogueItem, packId: string | null, priceList: PriceList): Paise {
  const pack = packId === null ? null : item.packs.find((candidate) => candidate.id === packId);
  if (pack === undefined || (pack !== null && !pack.soldAsPack)) {
    throw new RangeError(`"${item.name}" isn't sold in pack ${String(packId)}`);
  }
  const retail =
    pack === null
      ? item.sellingPrice
      : (pack.sellingPrice ?? packPrice(pack.size, item.sellingPrice));
  if (priceList === 'retail' || item.wholesalePrice === null) return retail;
  const wholesale = pack === null ? item.wholesalePrice : packPrice(pack.size, item.wholesalePrice);
  return Math.min(wholesale, retail);
}

/**
 * Puts an item on the bill. The same item and pack again adds to its line (question 2), unless
 * that line has a discount: then a new line starts, so the discount isn't stretched to more units.
 */
export function addToCart(
  lines: readonly CartLine[],
  item: CatalogueItem,
  packId: string | null,
  quantityThousandths: number,
  priceList: PriceList,
): CartLine[] {
  const shownUnitPricePaise = linePrice(item, packId, priceList);
  const index = lines.findIndex(
    (line) => line.itemId === item.id && line.packId === packId && line.discount === undefined,
  );
  if (index === -1) {
    return [...lines, { itemId: item.id, packId, quantityThousandths, shownUnitPricePaise }];
  }
  return lines.map((line, at) =>
    at === index
      ? { ...line, quantityThousandths: line.quantityThousandths + quantityThousandths }
      : line,
  );
}

export interface CartPricing {
  priceList: PriceList;
  placeOfSupplyStateCode: string;
  lines: readonly CartLine[];
  billDiscount?: Discount;
}

export interface PricingContext {
  scheme: TaxScheme;
  /** The selling branch's state. */
  supplierStateCode: string;
  catalogue: ReadonlyMap<string, CatalogueEntry>;
}

/**
 * The GST engine's input for a cart, every price taken from the catalogue (never from the price
 * shown). Throws a RangeError for an item it can't price: missing, archived, or with no GST rate
 * or HSN on a tax invoice (`02` #21, #24).
 */
export function cartToBillInput(cart: CartPricing, context: PricingContext): BillInput {
  const lines = cart.lines.map((line, index) => {
    const item = context.catalogue.get(line.itemId);
    if (item === undefined || item.archived) {
      throw new RangeError(`Line ${String(index + 1)}: item ${line.itemId} can't be sold`);
    }
    if (context.scheme === 'regular' && (item.gstRate === null || item.hsn === null)) {
      throw new RangeError(`Line ${String(index + 1)}: "${item.name}" has no GST rate or HSN`);
    }
    return {
      unitPricePaise: linePrice(item, line.packId, cart.priceList),
      quantityThousandths: line.quantityThousandths,
      rateBasisPoints: item.gstRate ?? 0,
      priceIncludesTax: item.priceIncludesTax,
      hsn: item.hsn ?? '',
      ...(line.discount === undefined ? {} : { discount: line.discount }),
    };
  });
  return {
    scheme: context.scheme,
    supplierStateCode: context.supplierStateCode,
    placeOfSupplyStateCode: cart.placeOfSupplyStateCode,
    lines,
    ...(cart.billDiscount === undefined ? {} : { billDiscount: cart.billDiscount }),
  };
}

// ---- The staff discount limit (02 #12, design §6, question 4) ----

/** A line's discount on its own price, and the whole bill's share of the gross. */
export interface DiscountLimits {
  lineBasisPoints: number;
  billBasisPoints: number;
}

const BASIS_POINTS = 10_000;

/** a × b ÷ 10,000, half up, on BigInt so no product loses precision. */
function shareOf(paise: number, basisPoints: number): bigint {
  return (2n * BigInt(paise) * BigInt(basisPoints) + 10_000n) / 20_000n;
}

/** The smallest whole basis points b with part ≤ whole × b ÷ 10,000. */
function shareUp(part: number, whole: number): number {
  if (part <= 0 || whole <= 0) return 0;
  return Number((BigInt(part) * 10_000n + BigInt(whole) - 1n) / BigInt(whole));
}

function hasDiscount(input: BillInput): boolean {
  return (
    input.billDiscount !== undefined || input.lines.some((line) => line.discount !== undefined)
  );
}

function linesWithin(input: BillInput, lineBasisPoints: number): boolean {
  // Measured on the line's own price (with or without tax, as entered), so GST's rounding of the
  // tax halves can't push an exact 10% over 10%.
  return calculateBill(input).lines.every(
    (line) => BigInt(line.itemDiscountPaise) <= shareOf(line.amountPaise, lineBasisPoints),
  );
}

/**
 * The bill is within `billBasisPoints` when the customer pays at least what that percent off
 * every line would leave: the same sum the engine would do for such a discount, so a percent
 * exactly at the limit always passes, and a rupee more never does.
 */
function billWithin(input: BillInput, billBasisPoints: number): boolean {
  const paid = calculateBill(input).totalPaise;
  const reference = calculateBill({
    ...input,
    lines: input.lines.map((line) => ({
      unitPricePaise: line.unitPricePaise,
      quantityThousandths: line.quantityThousandths,
      rateBasisPoints: line.rateBasisPoints,
      priceIncludesTax: line.priceIncludesTax,
      hsn: line.hsn,
    })),
    billDiscount: { kind: 'percent', basisPoints: Math.min(billBasisPoints, BASIS_POINTS) },
  }).totalPaise;
  return paid >= reference;
}

/**
 * True when every discount on the bill is within the limit: each line's own discount, and the
 * whole bill's. `null` is the owner, who has no limit. An owner's OK records both numbers.
 */
export function discountWithinLimit(
  input: BillInput,
  limit: number | DiscountLimits | null,
): boolean {
  if (limit === null || !hasDiscount(input)) return true;
  const { lineBasisPoints, billBasisPoints } =
    typeof limit === 'number' ? { lineBasisPoints: limit, billBasisPoints: limit } : limit;
  return linesWithin(input, lineBasisPoints) && billWithin(input, billBasisPoints);
}

/**
 * The limits an owner's OK must give for this bill: the biggest line discount on its own price,
 * and the whole bill's share of the gross, each rounded up until the bill passes.
 */
export function discountShares(input: BillInput): DiscountLimits {
  if (!hasDiscount(input)) return { lineBasisPoints: 0, billBasisPoints: 0 };
  const bill = calculateBill(input);
  const lineBasisPoints = Math.max(
    0,
    ...bill.lines.map((line) => shareUp(line.itemDiscountPaise, line.amountPaise)),
  );
  let billBasisPoints = shareUp(bill.grossPaise - bill.totalPaise, bill.grossPaise);
  while (billBasisPoints < BASIS_POINTS && !billWithin(input, billBasisPoints)) {
    billBasisPoints += 1;
  }
  return { lineBasisPoints, billBasisPoints };
}

// ---- The save request (design §10) and a held bill's cart (§9) ----

/** ₹1 lakh crore: far above any bill, far below 2^53. */
export const MAX_BILL_PAISE = 10_000_000_000_000;
const MAX_LINES = 500;

const discountSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('percent'),
      basisPoints: z
        .int({ error: 'invalid' })
        .min(1, { error: 'too_small' })
        .max(BASIS_POINTS, { error: 'too_big' }),
    }),
    z.strictObject({
      kind: z.literal('amount'),
      paise: z.int({ error: 'invalid' }).min(1, { error: 'too_small' }).max(MAX_BILL_PAISE, {
        error: 'too_big',
      }),
    }),
  ],
  { error: 'invalid' },
);

const cartLineSchema = z.strictObject({
  itemId: uuid(),
  packId: uuid().nullable(),
  quantityThousandths: z
    .int({ error: 'invalid' })
    .min(1, { error: 'too_small' })
    .max(MAX_THOUSANDTHS, { error: 'too_big' }),
  shownUnitPricePaise: z
    .int({ error: 'invalid' })
    .min(0, { error: 'too_small' })
    .max(MAX_PAISE, { error: 'too_big' }),
  discount: discountSchema.optional(),
});

const cartShape = {
  /** The bill's idempotency key, made when it was started (ADR 0007). */
  billKey: uuid(),
  priceList: z.enum(PRICE_LISTS, { error: 'invalid' }),
  customerId: uuid().nullable(),
  placeOfSupplyStateCode: z
    .string({ error: 'required' })
    .refine((code) => isStateCode(code), { error: 'invalid' }),
  lines: z
    .array(cartLineSchema, { error: 'invalid' })
    .min(1, { error: 'required' })
    .max(MAX_LINES, { error: 'too_many' }),
  billDiscount: discountSchema.optional(),
};

/** A held bill's cart (design §9): the save request without its payments. */
export const billCartSchema = z.strictObject(cartShape);
export type BillCart = z.infer<typeof billCartSchema>;

const amount = () =>
  z.int({ error: 'invalid' }).min(0, { error: 'too_small' }).max(MAX_BILL_PAISE, {
    error: 'too_big',
  });

const paymentSchema = z.strictObject({
  mode: z.enum(PAYMENT_MODES, { error: 'invalid' }),
  amountPaise: amount().min(1, { error: 'too_small' }),
  /** Cash only: what the customer handed over, for the change. */
  tenderedPaise: amount().optional(),
  /** UPI or card: last digits or UTR (optional). Cheque: its number (required). */
  reference: optionalText(40).optional(),
});

/** One payment as the rules read it: the draft's payment, or a row the payment panel builds. */
export interface PaymentRule {
  mode: PaymentMode;
  amountPaise: number;
  tenderedPaise?: number | undefined;
  reference?: string | null | undefined;
}

export type PaymentIssue =
  | {
      /** The payment it's about. */
      index: number;
      field: 'tenderedPaise' | 'reference';
      code: 'cash_only' | 'too_small' | 'required' | 'not_allowed';
    }
  | { index: null; field: null; code: 'payments_mismatch' };

/**
 * The rules for the payments of a bill, in one place for the save request and the payment
 * panel: only cash is handed over (and not less than its amount), a cheque needs its number,
 * udhaar and advance take no reference, and the amounts add up to exactly the bill (`02` #11). Only cash can be handed over in
 * excess, and that's `tenderedPaise`, not the amount.
 */
export function paymentIssues(payments: readonly PaymentRule[], totalPaise: Paise): PaymentIssue[] {
  const issues: PaymentIssue[] = [];
  payments.forEach((payment, index) => {
    if (payment.tenderedPaise !== undefined) {
      if (payment.mode !== 'cash') {
        issues.push({ index, field: 'tenderedPaise', code: 'cash_only' });
      } else if (payment.tenderedPaise < payment.amountPaise) {
        issues.push({ index, field: 'tenderedPaise', code: 'too_small' });
      }
    }
    if (payment.mode === 'cheque' && (payment.reference ?? null) === null) {
      issues.push({ index, field: 'reference', code: 'required' });
    }
    if (isLedgerMode(payment.mode) && (payment.reference ?? null) !== null) {
      issues.push({ index, field: 'reference', code: 'not_allowed' });
    }
  });
  const paid = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  if (paid !== totalPaise) issues.push({ index: null, field: null, code: 'payments_mismatch' });
  return issues;
}

/** `POST /api/bills` (P1.14 implements it). The server re-prices and re-checks everything. */
export const billDraftSchema = z
  .strictObject({
    ...cartShape,
    payments: z.array(paymentSchema, { error: 'invalid' }).max(10, { error: 'too_many' }),
    /** An owner's OK for a discount above the cashier's limit (design §6). */
    approvalId: uuid().optional(),
    /** An owner's OK for udhaar over the credit limit (P1.18 design §5): its own approval. */
    creditApprovalId: uuid().optional(),
    /** The held bill this one was resumed from (design §9). */
    heldBillId: uuid().optional(),
    shownGrandTotalPaise: amount(),
  })
  .superRefine((draft, context) => {
    for (const issue of paymentIssues(draft.payments, draft.shownGrandTotalPaise)) {
      context.addIssue({
        code: 'custom',
        path: issue.index === null ? ['payments'] : ['payments', issue.index, issue.field],
        message: issue.code,
      });
    }
  });
export type BillDraft = z.infer<typeof billDraftSchema>;

// ---- Search in the catalogue copy (design §4) ----

export interface Searchable {
  name: string;
  hindiName: string | null;
  code: string | null;
}

/**
 * Lower case, Latin accents dropped, spaces squeezed. Only the combining marks for Latin
 * letters (U+0300–U+036F) go: Devanagari's vowel signs are combining marks too, and must stay.
 */
function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A search over the catalogue copy, built once per copy. Ranks an exact code first, then a name
 * that starts with the query, then a word that does, then any match in the name, Hindi name or
 * code; within a rank, the catalogue's own order. Transliteration isn't in v1.
 */
export function createCatalogueSearch<T extends Searchable>(
  items: readonly T[],
): (query: string, limit?: number) => T[] {
  const keys = items.map((item) => {
    const names = [item.name, item.hindiName ?? ''].map(normalise);
    return {
      item,
      code: normalise(item.code ?? ''),
      names,
      words: names.flatMap((name) => name.split(' ').slice(1)),
    };
  });
  return (query, limit = 20) => {
    const q = normalise(query);
    if (q === '') return [];
    const ranked: { rank: number; item: T }[] = [];
    for (const key of keys) {
      let rank: number;
      if (key.code === q) rank = 0;
      else if (key.names.some((name) => name.startsWith(q))) rank = 1;
      else if (key.words.some((word) => word.startsWith(q))) rank = 2;
      else if (key.code.includes(q) || key.names.some((name) => name.includes(q))) rank = 3;
      else continue;
      ranked.push({ rank, item: key.item });
    }
    // Array sort is stable, so equal ranks keep the catalogue's order.
    return ranked
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
      .map((entry) => entry.item);
  };
}

// ---- Held bills (design §9) and owner approvals (§6) ----

/** `POST /api/held-bills`: hold the open bill and serve the next customer. */
export const holdBillSchema = z.strictObject({
  /** Something to find it by ("blue shirt uncle"). */
  label: optionalText(40),
  draft: billCartSchema,
  /** For the held-bills list only; nothing is ever billed from it (the save re-prices). */
  shownTotalPaise: amount(),
});
export type HoldBillInput = z.infer<typeof holdBillSchema>;

/** `POST /api/billing/discard`: a full open bill cleared without saving, kept in the log. */
export const discardBillSchema = z.strictObject({
  draft: billCartSchema,
  shownTotalPaise: amount(),
});
export type DiscardBillInput = z.infer<typeof discardBillSchema>;

/** A held bill in the branch's list (`GET /api/held-bills`). */
export interface HeldBillView {
  id: string;
  label: string | null;
  lineCount: number;
  totalPaise: Paise;
  heldBy: { id: string; name: string };
  heldAt: string;
}

/** What resuming a held bill answers: its cart, to be re-priced from the catalogue copy. */
export interface ResumedBillView {
  draft: BillCart;
}

/** A discount above a cashier's limit (`02` #12), or udhaar over a credit limit (`03` #9, #18). */
export const APPROVAL_KINDS = ['discount', 'credit_limit'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** An owner's OK lasts this long, for one bill, and is used up by its save (question 5). */
export const APPROVAL_MINUTES = 30;

const share = () =>
  z.int({ error: 'invalid' }).min(0, { error: 'too_small' }).max(BASIS_POINTS, {
    error: 'too_big',
  });

const ownerPassword = () =>
  z.string({ error: 'required' }).min(1, { error: 'required' }).max(128, { error: 'too_long' });

/**
 * `POST /api/billing/approvals`: the owner types their password at the counter to allow the
 * discounts shown (`discountShares`) or the most udhaar to put on the bill, for this bill only.
 * The password is sent once, never kept, and is exactly as typed (ADR 0035).
 */
export const approvalSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .strictObject({
        billKey: uuid(),
        kind: z.literal('discount'),
        lineBasisPoints: share(),
        billBasisPoints: share(),
        ownerPassword: ownerPassword(),
      })
      .refine((value) => value.lineBasisPoints > 0 || value.billBasisPoints > 0, {
        path: ['billBasisPoints'],
        error: 'too_small',
      }),
    z.strictObject({
      billKey: uuid(),
      kind: z.literal('credit_limit'),
      /** The most udhaar the owner allows on this bill. */
      amountPaise: z
        .int({ error: 'invalid' })
        .min(1, { error: 'too_small' })
        .max(MAX_BILL_PAISE, { error: 'too_big' }),
      ownerPassword: ownerPassword(),
    }),
  ],
  { error: 'invalid' },
);
export type ApprovalInput = z.infer<typeof approvalSchema>;

export interface ApprovalView {
  approvalId: string;
  expiresAt: string;
}
