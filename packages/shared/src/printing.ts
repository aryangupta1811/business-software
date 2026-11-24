// Printing and the Bills page (P1.15, design `docs/plans/2026-11-23-p1.15-printing-design.md`;
// `02` #16, #17, #28–#34). What a saved bill looks like to a reader, the two settings that
// decide how it prints (the business's, and the computer's), and the Bills list's query.
import { z } from 'zod';
import { isCalendarDate } from './attendance.js';
import type { PaymentMode } from './billing.js';
import { branchScope, optionalText, uuid } from './fields.js';
import type { BillDocument } from './invoice.js';
import type { Paise } from './money.js';

/** `02` #17: the language a business's bills print in. The same codes as the app's languages. */
export const BILL_LANGUAGES = ['en', 'hi', 'hi-Latn'] as const;
export type BillLanguage = (typeof BILL_LANGUAGES)[number];

/** `02` #29: the receipt paper at one counter, in millimetres. */
export const RECEIPT_SIZES = [80, 58] as const;
export type ReceiptSize = (typeof RECEIPT_SIZES)[number];

/** The three layouts: two receipt widths and A4. */
export const PRINT_SIZES = ['80', '58', 'a4'] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

/** The note under every bill ("Goods once sold will not be taken back"). */
export const FOOTER_NOTE_MAX_LENGTH = 200;

/** `PUT /api/settings/printing`: the business's bill language and footer note (owner only). */
export const settingsPrintingSchema = z.strictObject({
  billLanguage: z.enum(BILL_LANGUAGES, { error: 'invalid' }),
  footerNote: optionalText(FOOTER_NOTE_MAX_LENGTH),
});
export type SettingsPrintingInput = z.infer<typeof settingsPrintingSchema>;

/** `PUT /api/devices/:id/printing`: how this counter computer prints (owner only; `02` #29, #30). */
export const devicePrintingSchema = z.strictObject({
  receiptSize: z.union([z.literal(80), z.literal(58)], { error: 'invalid' }),
  autoPrint: z.boolean({ error: 'invalid' }),
});
export type DevicePrintingInput = z.infer<typeof devicePrintingSchema>;

/** A computer's printing settings, as the session and the computers list answer them. */
export interface ComputerPrinting {
  receiptSize: ReceiptSize;
  autoPrint: boolean;
}

// ---- A saved bill, for reading and printing ----

/** The branch's details as they were when the bill was saved (`bills.seller`). */
export interface BillSellerView {
  businessName: string;
  branchName: string;
  address: string | null;
  pinCode: string | null;
  stateCode: string;
  gstin: string | null;
  drugLicence: string | null;
  fssai: string | null;
  /** The business's phone at saving; absent on a bill saved before P1.15. */
  phone?: string | null;
}

/** The customer's details as they were when the bill was saved (`bills.buyer`). */
export interface BillBuyerView {
  name: string;
  gstin: string | null;
  legalName: string | null;
  address: string | null;
  pinCode: string | null;
  stateCode: string | null;
}

export interface BillLineView {
  lineNo: number;
  itemName: string;
  itemHindiName: string | null;
  /** A built-in unit's code or the owner's own unit's name. */
  unit: string;
  hsn: string;
  rateBasisPoints: number;
  quantityThousandths: number;
  /** In the line's own price basis (with tax if `priceIncludesTax`). */
  unitPricePaise: Paise;
  priceIncludesTax: boolean;
  amountPaise: Paise;
  itemDiscountPaise: Paise;
  grossPaise: Paise;
  subtotalPaise: Paise;
  billDiscountPaise: Paise;
  taxableBeforeDiscountsPaise: Paise;
  discountOffTaxablePaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  totalPaise: Paise;
}

export interface BillPaymentView {
  mode: PaymentMode;
  amountPaise: Paise;
  /** Cash only: what the customer handed over. */
  tenderedPaise: Paise | null;
  reference: string | null;
}

/**
 * What `GET /api/bills/:id` answers and what the print template draws: only numbers that were
 * saved with the bill (ADR 0047). `language` and `footerNote` are the business's settings now,
 * not part of the saved bill.
 */
export interface BillDetailView {
  id: string;
  number: string;
  document: BillDocument;
  businessDate: string;
  /** When it was saved, ISO 8601. */
  createdAt: string;
  /** The login that saved it. */
  cashierName: string;
  seller: BillSellerView;
  buyer: BillBuyerView | null;
  /** The customer's phone now, for "Send on WhatsApp"; it is not printed. */
  customerPhone: string | null;
  tax: 'cgst-sgst' | 'igst' | 'none';
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  lines: BillLineView[];
  payments: BillPaymentView[];
  grossPaise: Paise;
  subtotalPaise: Paise;
  billDiscountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  totalPaise: Paise;
  roundOffPaise: Paise;
  grandTotalPaise: Paise;
  /** Cash handed over beyond its amount. */
  changePaise: Paise;
  language: BillLanguage;
  footerNote: string | null;
}

/** One row of the Bills page. */
export interface BillListItem {
  id: string;
  number: string;
  document: BillDocument;
  businessDate: string;
  createdAt: string;
  grandTotalPaise: Paise;
  branchId: string;
  branchCode: string;
  customerName: string | null;
  customerPhone: string | null;
  paymentModes: PaymentMode[];
}

/** `GET /api/bills`: a page, newest first; `next` is the `after` of the following page. */
export interface BillListPage {
  bills: BillListItem[];
  next: string | null;
}

const calendarDate = () =>
  z.string({ error: 'invalid' }).refine(isCalendarDate, { error: 'invalid' });

/** `GET /api/bills?q=&from=&to=&branch=&after=`: dates are business days, both included. */
export const billListQuerySchema = z
  .strictObject({
    q: optionalText(100).optional(),
    from: calendarDate().optional(),
    to: calendarDate().optional(),
    /** The owner's branch picker; staff always get their own branch (ADR 0045). */
    branch: branchScope().optional(),
    after: uuid().optional(),
  })
  .transform((query, context) => {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'before_from' });
    }
    return {
      q: query.q ?? undefined,
      from: query.from,
      to: query.to,
      branch: query.branch,
      after: query.after,
    };
  });
export type BillListQuery = z.infer<typeof billListQuerySchema>;

/** `POST /api/bills/:id/reprints`: when the copy was printed; a reprint says so (`02` #33). */
export interface ReprintView {
  reprintedAt: string;
}
