// Invoice numbers and the other small rules of saving a bill (P1.14, design
// `docs/plans/2026-11-22-p1.14-save-bill-design.md`). Quantities in thousandths (ADR 0008).
import type { TaxScheme } from './gst.js';
import type { Paise } from './money.js';

/** CGST Rule 46(b): a serial number of at most 16 characters (letters, digits, `-`, `/`). */
export const INVOICE_NUMBER_MAX_LENGTH = 16;

/** `00` #61: the business's own prefix, optional, 1 to 4 capital letters or digits. */
export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9]{1,4}$/;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR = /^(\d{4})-(\d{2})$/;

/** The Indian financial year, April to March, of a business date: `2026-27`. */
export function financialYear(businessDate: string): string {
  const match = DATE.exec(businessDate);
  const month = Number(match?.[2]);
  if (match === null || month < 1 || month > 12) {
    throw new RangeError(`Not a date: ${businessDate}`);
  }
  const start = Number(match[1]) - (month < 4 ? 1 : 0);
  return `${String(start)}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * What starts an invoice number (`00` #58, #60, #61): the business's prefix while it has one
 * branch (a one-branch business sees nothing about branches), each branch's code once it has two.
 */
export function invoiceLabel(input: {
  prefix: string | null;
  branchCode: string;
  branchCount: number;
}): string | null {
  return input.branchCount >= 2 ? input.branchCode : input.prefix;
}

/**
 * `ABC/26-27/42`, or `26-27/42` with no label (`00` #61). Throws a RangeError for a number the
 * law wouldn't accept, so a bad one can never be stored.
 */
export function invoiceNumber(input: {
  label: string | null;
  financialYear: string;
  sequence: number;
}): string {
  const [, start, end] = YEAR.exec(input.financialYear) ?? [];
  if (start === undefined || end === undefined) {
    throw new RangeError(`Not a financial year: ${input.financialYear}`);
  }
  if (input.label !== null && !INVOICE_PREFIX_PATTERN.test(input.label)) {
    throw new RangeError(`Not an invoice label: ${input.label}`);
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new RangeError(`Not an invoice sequence: ${String(input.sequence)}`);
  }
  const number = [input.label, `${start.slice(2)}-${end}`, String(input.sequence)]
    .filter((part) => part !== null)
    .join('/');
  if (number.length > INVOICE_NUMBER_MAX_LENGTH) {
    throw new RangeError(`Invoice number ${number} is longer than 16 characters`);
  }
  return number;
}

/** `00` #6: what a bill is called, from the business's GST status. */
export const BILL_DOCUMENTS = ['tax_invoice', 'bill_of_supply', 'bill'] as const;
export type BillDocument = (typeof BILL_DOCUMENTS)[number];

export function documentFor(scheme: TaxScheme): BillDocument {
  return scheme === 'regular'
    ? 'tax_invoice'
    : scheme === 'composition'
      ? 'bill_of_supply'
      : 'bill';
}

/**
 * Thousandths of the stock unit a line takes: its quantity, or quantity × the pack's size
 * (both in thousandths), rounded half up like `packPrice`.
 */
export function stockQuantity(
  quantityThousandths: number,
  packSizeThousandths: number | null,
): number {
  if (packSizeThousandths === null) return quantityThousandths;
  const product = BigInt(quantityThousandths) * BigInt(packSizeThousandths);
  return Number((2n * product + 1000n) / 2000n);
}

/** CGST Rule 46 (`02` #26): from this taxable value an unregistered buyer is named on the bill. */
export const BUYER_DETAILS_TAXABLE_PAISE = 5_000_000;

/**
 * True when a tax invoice must carry the buyer's name, address and state: a regular business,
 * a buyer without a GSTIN, and a taxable value (before GST) of ₹50,000 or more.
 */
export function needsBuyerDetails(input: {
  scheme: TaxScheme;
  taxablePaise: Paise;
  buyerGstin: string | null;
}): boolean {
  return (
    input.scheme === 'regular' &&
    input.buyerGstin === null &&
    input.taxablePaise >= BUYER_DETAILS_TAXABLE_PAISE
  );
}

/** `POST /api/bills` answers this (`201`, or `200` for a retry of a saved bill). */
export interface SavedBillView {
  id: string;
  /** As printed: `ABC/26-27/42`. */
  number: string;
  document: BillDocument;
  businessDate: string;
  grandTotalPaise: Paise;
  /** Cash handed over beyond its amount. */
  changePaise: Paise;
  /** Goods the `warn` setting let go below zero: the counter shows a warning. */
  warnings: { itemId: string; balanceAfter: number }[];
}
