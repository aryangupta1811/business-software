import { allocatePaise, type Paise } from './money.js';
import { stateByCode, type IndianState } from './states.js';

/**
 * The GST engine (P1.12): one pure function that turns a cart into every number a bill needs.
 * The billing screen, the server's check when a bill is saved, the printed bill and the GST
 * export all call it, so they can never disagree. Rules and their sources:
 * `docs/plans/2026-11-18-p1.12-gst-engine.md`.
 *
 * Units (ADR 0008): money in whole paise, rates and percentages in basis points (18% → 1800),
 * quantities in thousandths of the unit (0.250 kg → 250). All arithmetic is on BigInt, so no
 * product can lose precision; every result must come back as a safe integer.
 */

/** Module 00 #6: regular → tax invoice; composition → bill of supply; unregistered → plain bill. */
export type TaxScheme = 'regular' | 'composition' | 'unregistered';

/** A percent (in basis points) or an amount off a line or the whole bill. */
export type Discount =
  | { readonly kind: 'percent'; readonly basisPoints: number }
  | { readonly kind: 'amount'; readonly paise: Paise };

export interface BillLineInput {
  readonly unitPricePaise: Paise;
  readonly quantityThousandths: number;
  readonly rateBasisPoints: number;
  /** True when the price already includes GST (a shelf or MRP price), false when GST is added. */
  readonly priceIncludesTax: boolean;
  readonly hsn: string;
  readonly discount?: Discount;
}

export interface BillInput {
  readonly scheme: TaxScheme;
  /** GST state code of the selling branch, from `INDIAN_STATES` (e.g. "09", Uttar Pradesh). */
  readonly supplierStateCode: string;
  /** GST state code where the supply ends: the branch's own state for a counter sale. */
  readonly placeOfSupplyStateCode: string;
  readonly lines: readonly BillLineInput[];
  readonly billDiscount?: Discount;
}

export interface TaxAmounts {
  readonly taxablePaise: Paise;
  readonly cgstPaise: Paise;
  /** SGST, or UTGST where `stateTaxName` says so. */
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  /** Taxable value plus every tax. */
  readonly totalPaise: Paise;
}

export interface BillLine extends TaxAmounts {
  readonly hsn: string;
  /** The rate charged: the item's rate, or 0 when the business charges no GST. */
  readonly rateBasisPoints: number;
  /** Price × quantity, in the line's own price basis (with or without tax), as printed on it. */
  readonly amountPaise: Paise;
  /** The item discount, in the line's own price basis, as printed on it. */
  readonly itemDiscountPaise: Paise;
  /** What the customer would pay for this line with no discount at all, tax included. */
  readonly grossPaise: Paise;
  /** What the customer would pay for this line after its item discount, before the bill discount. */
  readonly subtotalPaise: Paise;
  /** How much less the customer pays for this line because of the bill discount. */
  readonly billDiscountPaise: Paise;
}

export interface RateSummary extends TaxAmounts {
  readonly rateBasisPoints: number;
}

export interface HsnSummary extends RateSummary {
  readonly hsn: string;
}

/**
 * A worked-out bill. Every money field means what the customer pays, tax included, except the
 * taxable value and the taxes themselves, so the printed bill adds up:
 * gross − item discounts (gross − subtotal) − bill discount = total = taxable + taxes,
 * and total + round-off = grand total.
 */
export interface Bill extends TaxAmounts {
  /** Which taxes this bill charges: 'none' for composition and unregistered businesses. */
  readonly tax: 'cgst-sgst' | 'igst' | 'none';
  /** What the state half is called (UTGST in a Union Territory), or null when none is charged. */
  readonly stateTaxName: 'SGST' | 'UTGST' | null;
  readonly lines: readonly BillLine[];
  /** What the customer would pay with no discount at all. */
  readonly grossPaise: Paise;
  /** What the customer would pay after item discounts, before the bill discount. */
  readonly subtotalPaise: Paise;
  /** How much less the customer pays because of the bill discount: subtotal − total. */
  readonly billDiscountPaise: Paise;
  /** Between −49 and +50 paise, so the grand total is a whole number of rupees. */
  readonly roundOffPaise: Paise;
  readonly grandTotalPaise: Paise;
  /** One row per rate, lowest rate first. */
  readonly byRate: readonly RateSummary[];
  /** One row per HSN code and rate (the GSTR-1 HSN table's shape), by rate, then code. */
  readonly byHsn: readonly HsnSummary[];
}

const SCHEMES: readonly TaxScheme[] = ['regular', 'composition', 'unregistered'];
/** HSN codes are 4, 6 or 8 digits (at least 4 on a tax invoice, Notification 78/2020-CT). */
const HSN = /^(?:\d{4}|\d{6}|\d{8})$/;
const BASIS_POINTS = 10000n;
const THOUSANDTHS = 1000n;

/** Rounding rule "half up": numerator ÷ denominator to the nearest whole, .5 going up. Both ≥ 0. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function wholeNumber(value: number, min: number, max: number, what: string): bigint {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${what} must be a whole number from ${String(min)} to ${String(max)}: ${String(value)}`,
    );
  }
  return BigInt(value);
}

function toPaise(value: bigint, what: string): Paise {
  const paise = Number(value);
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`${what} is too large to count in paise: ${value.toString()}`);
  }
  return paise;
}

function state(code: string, what: string): IndianState {
  const found = stateByCode(code);
  if (found === undefined) {
    throw new RangeError(
      `${what} must be a GST state code from INDIAN_STATES: ${JSON.stringify(code)}`,
    );
  }
  return found;
}

/** A tax invoice needs an HSN code; a bill of supply or a plain bill may leave it empty. */
function hsnCode(value: unknown, scheme: TaxScheme, what: string): string {
  if (typeof value === 'string' && (HSN.test(value) || (scheme !== 'regular' && value === ''))) {
    return value;
  }
  throw new RangeError(`${what} HSN code must be 4, 6 or 8 digits: ${JSON.stringify(value)}`);
}

function yesOrNo(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RangeError(`${what} must be true or false: ${JSON.stringify(value)}`);
  }
  return value;
}

/** How much a discount takes off `amount`; an amount discount can't be more than `amount`. */
function discountOff(discount: Discount | undefined, amount: bigint, what: string): bigint {
  if (discount === undefined) return 0n;
  if (discount.kind === 'percent') {
    const basisPoints = wholeNumber(discount.basisPoints, 0, 10000, `${what} percent`);
    return divideHalfUp(amount * basisPoints, BASIS_POINTS);
  }
  const off = wholeNumber(discount.paise, 0, Number.MAX_SAFE_INTEGER, `${what} amount`);
  if (off > amount) {
    throw new RangeError(
      `${what} of ${off.toString()} paise is more than the ${amount.toString()} paise it's taken from`,
    );
  }
  return off;
}

interface LineTax {
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
}

/**
 * GST on `net`, the line's amount after every discount (CGST Act s. 15(3)(a)).
 * CGST and SGST are each worked out on their own at half the rate, so they're always equal.
 * With a tax-inclusive price the customer pays exactly `net`: the taxes are taken out of it
 * (net × rate ÷ (100% + rate)) and any odd paisa stays in the taxable value.
 */
function taxOn(net: bigint, rate: bigint, includesTax: boolean, tax: Bill['tax']): LineTax {
  if (tax === 'none') return { taxable: net, cgst: 0n, sgst: 0n, igst: 0n };
  const base = includesTax ? BASIS_POINTS + rate : BASIS_POINTS;
  if (tax === 'igst') {
    const igst = divideHalfUp(net * rate, base);
    return { taxable: includesTax ? net - igst : net, cgst: 0n, sgst: 0n, igst };
  }
  const half = divideHalfUp(net * rate, 2n * base);
  return { taxable: includesTax ? net - 2n * half : net, cgst: half, sgst: half, igst: 0n };
}

/** What the customer pays for a line: its taxable value plus every tax. */
function payable({ taxable, cgst, sgst, igst }: LineTax): bigint {
  return taxable + cgst + sgst + igst;
}

type Totals = { -readonly [K in keyof TaxAmounts]: bigint };

function emptyTotals(): Totals {
  return { taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n, totalPaise: 0n };
}

function addLine(totals: Totals, line: BillLine): void {
  totals.taxablePaise += BigInt(line.taxablePaise);
  totals.cgstPaise += BigInt(line.cgstPaise);
  totals.sgstPaise += BigInt(line.sgstPaise);
  totals.igstPaise += BigInt(line.igstPaise);
  totals.totalPaise += BigInt(line.totalPaise);
}

function totalsToPaise(totals: Totals, what: string): TaxAmounts {
  return {
    taxablePaise: toPaise(totals.taxablePaise, `${what} taxable value`),
    cgstPaise: toPaise(totals.cgstPaise, `${what} CGST`),
    sgstPaise: toPaise(totals.sgstPaise, `${what} SGST`),
    igstPaise: toPaise(totals.igstPaise, `${what} IGST`),
    totalPaise: toPaise(totals.totalPaise, `${what} total`),
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function summarise(lines: readonly BillLine[]): Pick<Bill, 'byRate' | 'byHsn'> {
  const byRate = new Map<number, Totals>();
  const byHsn = new Map<string, { hsn: string; rateBasisPoints: number; totals: Totals }>();
  for (const line of lines) {
    const rateTotals = byRate.get(line.rateBasisPoints) ?? emptyTotals();
    byRate.set(line.rateBasisPoints, rateTotals);
    addLine(rateTotals, line);

    const key = `${String(line.rateBasisPoints)}|${line.hsn}`;
    const hsnRow = byHsn.get(key) ?? {
      hsn: line.hsn,
      rateBasisPoints: line.rateBasisPoints,
      totals: emptyTotals(),
    };
    byHsn.set(key, hsnRow);
    addLine(hsnRow.totals, line);
  }
  return {
    byRate: [...byRate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rateBasisPoints, totals]) => ({
        rateBasisPoints,
        ...totalsToPaise(totals, 'A rate summary'),
      })),
    byHsn: [...byHsn.values()]
      .sort((a, b) => a.rateBasisPoints - b.rateBasisPoints || compareText(a.hsn, b.hsn))
      .map(({ hsn, rateBasisPoints, totals }) => ({
        hsn,
        rateBasisPoints,
        ...totalsToPaise(totals, 'An HSN summary'),
      })),
  };
}

/** Works out a whole bill. Throws a RangeError for input it can't price, rather than guessing. */
export function calculateBill(input: BillInput): Bill {
  if (!SCHEMES.includes(input.scheme)) {
    throw new RangeError(`Unknown GST scheme: ${JSON.stringify(input.scheme)}`);
  }
  const supplier = state(input.supplierStateCode, 'The supplier state');
  const placeOfSupply = state(input.placeOfSupplyStateCode, 'The place of supply');
  const sameState = supplier.code === placeOfSupply.code;
  if (input.scheme !== 'regular' && !sameState) {
    // CGST Act s. 10(2)(c): no inter-state supplies under composition; s. 24(i): a seller of
    // goods to another state must register.
    throw new RangeError(`A ${input.scheme} business can't sell to another state`);
  }
  const tax: Bill['tax'] = input.scheme !== 'regular' ? 'none' : sameState ? 'cgst-sgst' : 'igst';

  // 1–2. Each line's amount (half up) and its item discount, then what the customer would pay.
  const priced = input.lines.map((line, index) => {
    const what = `Line ${String(index + 1)}`;
    const price = wholeNumber(line.unitPricePaise, 0, Number.MAX_SAFE_INTEGER, `${what} price`);
    const quantity = wholeNumber(
      line.quantityThousandths,
      1,
      Number.MAX_SAFE_INTEGER,
      `${what} quantity`,
    );
    const itemRate = wholeNumber(line.rateBasisPoints, 0, 10000, `${what} GST rate`);
    const includesTax = yesOrNo(line.priceIncludesTax, `${what} priceIncludesTax`);
    const hsn = hsnCode(line.hsn, input.scheme, what);
    const rate = tax === 'none' ? 0n : itemRate;
    const amount = divideHalfUp(price * quantity, THOUSANDTHS);
    const itemDiscount = discountOff(line.discount, amount, `${what} discount`);
    const afterItemDiscount = amount - itemDiscount;
    const beforeBillDiscount = taxOn(afterItemDiscount, rate, includesTax, tax);
    return {
      what,
      hsn,
      rate,
      includesTax,
      amount,
      itemDiscount,
      afterItemDiscount,
      gross: payable(taxOn(amount, rate, includesTax, tax)),
      subtotal: payable(beforeBillDiscount),
      beforeBillDiscount,
    };
  });

  // 3–8. The bill discount, then GST on what's left of each line.
  const billDiscount = input.billDiscount;
  let taxes: LineTax[];
  if (billDiscount === undefined) {
    taxes = priced.map((p) => p.beforeBillDiscount);
  } else if (billDiscount.kind === 'percent') {
    // Worked out once on the subtotal and shared by each line's own-basis value, so every line
    // loses that percent of its own price.
    const ownSubtotal = priced.reduce((sum, p) => sum + p.afterItemDiscount, 0n);
    const off = discountOff(billDiscount, ownSubtotal, 'The bill discount');
    const shares = allocatePaise(
      toPaise(off, 'The bill discount'),
      priced.map((p) => toPaise(p.afterItemDiscount, `${p.what} after its discount`)),
    );
    taxes = priced.map((p, index) =>
      taxOn(p.afterItemDiscount - BigInt(shares[index] ?? 0), p.rate, p.includesTax, tax),
    );
  } else {
    // Owner's decision 2026-11-18: ₹X off the bill means the customer pays exactly ₹X less.
    // X is shared by what the customer pays for each line. A line's new price is then treated
    // as tax-inclusive, so its tax is taken out of it and its total drops by exactly its share.
    const subtotal = priced.reduce((sum, p) => sum + p.subtotal, 0n);
    const off = discountOff(billDiscount, subtotal, 'The bill discount');
    const shares = allocatePaise(
      toPaise(off, 'The bill discount'),
      priced.map((p) => toPaise(p.subtotal, `${p.what} subtotal`)),
    );
    taxes = priced.map((p, index) => {
      const share = BigInt(shares[index] ?? 0);
      return share === 0n ? p.beforeBillDiscount : taxOn(p.subtotal - share, p.rate, true, tax);
    });
  }

  const lines = priced.map((p, index): BillLine => {
    const lineTax = taxes[index] ?? p.beforeBillDiscount;
    const total = payable(lineTax);
    return {
      hsn: p.hsn,
      rateBasisPoints: Number(p.rate),
      amountPaise: toPaise(p.amount, `${p.what} amount`),
      itemDiscountPaise: toPaise(p.itemDiscount, `${p.what} discount`),
      grossPaise: toPaise(p.gross, `${p.what} gross`),
      subtotalPaise: toPaise(p.subtotal, `${p.what} subtotal`),
      billDiscountPaise: toPaise(p.subtotal - total, `${p.what} bill discount`),
      taxablePaise: toPaise(lineTax.taxable, `${p.what} taxable value`),
      cgstPaise: toPaise(lineTax.cgst, `${p.what} CGST`),
      sgstPaise: toPaise(lineTax.sgst, `${p.what} SGST`),
      igstPaise: toPaise(lineTax.igst, `${p.what} IGST`),
      totalPaise: toPaise(total, `${p.what} total`),
    };
  });

  // 9. Totals are sums of the lines, so lines, totals and summaries always agree.
  const totals = emptyTotals();
  for (const line of lines) addLine(totals, line);
  const sumOf = (field: (line: BillLine) => number, what: string) =>
    toPaise(
      lines.reduce((sum, line) => sum + BigInt(field(line)), 0n),
      what,
    );

  // 11. Round off to the nearest rupee, 50 paise and up going up.
  const grandTotal = divideHalfUp(totals.totalPaise, 100n) * 100n;

  return {
    tax,
    stateTaxName: tax === 'cgst-sgst' ? (placeOfSupply.utgst ? 'UTGST' : 'SGST') : null,
    lines,
    grossPaise: sumOf((line) => line.grossPaise, 'The bill gross'),
    subtotalPaise: sumOf((line) => line.subtotalPaise, 'The bill subtotal'),
    billDiscountPaise: sumOf((line) => line.billDiscountPaise, 'The bill discount'),
    ...totalsToPaise(totals, 'The bill'),
    roundOffPaise: toPaise(grandTotal - totals.totalPaise, 'The round-off'),
    grandTotalPaise: toPaise(grandTotal, 'The grand total'),
    ...summarise(lines),
  };
}
