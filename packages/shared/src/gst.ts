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
  /** Price × quantity, in the line's own price basis (with or without tax). */
  readonly amountPaise: Paise;
  readonly itemDiscountPaise: Paise;
  /** This line's share of the bill discount. */
  readonly billDiscountPaise: Paise;
}

export interface RateSummary extends TaxAmounts {
  readonly rateBasisPoints: number;
}

export interface HsnSummary extends RateSummary {
  readonly hsn: string;
}

export interface Bill extends TaxAmounts {
  /** Which taxes this bill charges: 'none' for composition and unregistered businesses. */
  readonly tax: 'cgst-sgst' | 'igst' | 'none';
  /** What the state half is called at the place of supply. */
  readonly stateTaxName: 'SGST' | 'UTGST';
  readonly lines: readonly BillLine[];
  readonly amountPaise: Paise;
  readonly itemDiscountPaise: Paise;
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
  const tax: Bill['tax'] =
    input.scheme !== 'regular'
      ? 'none'
      : supplier.code === placeOfSupply.code
        ? 'cgst-sgst'
        : 'igst';

  // 1–2. Each line's amount (half up) and its item discount.
  const priced = input.lines.map((line, index) => {
    const what = `Line ${String(index + 1)}`;
    const price = wholeNumber(line.unitPricePaise, 0, Number.MAX_SAFE_INTEGER, `${what} price`);
    const quantity = wholeNumber(
      line.quantityThousandths,
      1,
      Number.MAX_SAFE_INTEGER,
      `${what} quantity`,
    );
    const rate = wholeNumber(line.rateBasisPoints, 0, 10000, `${what} GST rate`);
    const amount = divideHalfUp(price * quantity, THOUSANDTHS);
    toPaise(amount, `${what} amount`);
    const itemDiscount = discountOff(line.discount, amount, `${what} discount`);
    return { line, rate, amount, itemDiscount, afterItemDiscount: amount - itemDiscount };
  });

  // 3. The bill discount, worked out once on the subtotal, then shared by largest remainder.
  const subtotal = priced.reduce((sum, p) => sum + p.afterItemDiscount, 0n);
  const billDiscount = toPaise(
    discountOff(input.billDiscount, subtotal, 'The bill discount'),
    'The bill discount',
  );
  const shares = allocatePaise(
    billDiscount,
    priced.map((p) => toPaise(p.afterItemDiscount, 'A line after its discount')),
  );

  // 4–8. GST on what's left of each line.
  const lines = priced.map(({ line, rate, amount, itemDiscount, afterItemDiscount }, index) => {
    const what = `Line ${String(index + 1)}`;
    const share = BigInt(shares[index] ?? 0);
    const chargedRate = tax === 'none' ? 0n : rate;
    const { taxable, cgst, sgst, igst } = taxOn(
      afterItemDiscount - share,
      chargedRate,
      line.priceIncludesTax,
      tax,
    );
    return {
      hsn: line.hsn,
      rateBasisPoints: Number(chargedRate),
      amountPaise: toPaise(amount, `${what} amount`),
      itemDiscountPaise: toPaise(itemDiscount, `${what} discount`),
      billDiscountPaise: Number(share),
      taxablePaise: toPaise(taxable, `${what} taxable value`),
      cgstPaise: toPaise(cgst, `${what} CGST`),
      sgstPaise: toPaise(sgst, `${what} SGST`),
      igstPaise: toPaise(igst, `${what} IGST`),
      totalPaise: toPaise(taxable + cgst + sgst + igst, `${what} total`),
    } satisfies BillLine;
  });

  // 9. Totals are sums of the lines, so lines, totals and summaries always agree.
  const totals = emptyTotals();
  for (const line of lines) addLine(totals, line);
  const sumOf = (field: (line: BillLine) => number) =>
    lines.reduce((sum, line) => sum + BigInt(field(line)), 0n);

  // 11. Round off to the nearest rupee, 50 paise and up going up.
  const grandTotal = divideHalfUp(totals.totalPaise, 100n) * 100n;

  return {
    tax,
    stateTaxName: placeOfSupply.utgst ? 'UTGST' : 'SGST',
    lines,
    amountPaise: toPaise(
      sumOf((line) => line.amountPaise),
      'The bill amount',
    ),
    itemDiscountPaise: toPaise(
      sumOf((line) => line.itemDiscountPaise),
      'The item discounts',
    ),
    billDiscountPaise: billDiscount,
    ...totalsToPaise(totals, 'The bill'),
    roundOffPaise: toPaise(grandTotal - totals.totalPaise, 'The round-off'),
    grandTotalPaise: toPaise(grandTotal, 'The grand total'),
    ...summarise(lines),
  };
}
