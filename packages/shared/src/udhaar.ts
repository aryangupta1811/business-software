// The udhaar ledger's rules (P1.18, design `docs/plans/2026-11-23-p1.18-udhaar-design.md`; Module
// 03). One balance per customer, changed only by ledger entries; "oldest bills first" is worked
// out when it's read (`unpaidEntries`), never stored. Money in paise (ADR 0008). Error messages
// are codes the web app translates (ADR 0036).
import { z } from 'zod';
import { isCalendarDate } from './attendance.js';
import { ownerPasswordSchema } from './auth.js';
import { MAX_BILL_PAISE, MONEY_PAYMENT_MODES } from './billing.js';
import { optionalText, text, uuid } from './fields.js';

/**
 * What an entry is. `bill` and `advance_used` belong to a saved bill, `payment` is money taken
 * (negative), `payment_reversal` takes one back (positive), `opening` is the owner's old
 * notebook. P1.16 adds `bill_cancelled`.
 */
export const UDHAAR_ENTRY_KINDS = [
  'opening',
  'bill',
  'advance_used',
  'payment',
  'payment_reversal',
] as const;
export type UdhaarEntryKind = (typeof UDHAAR_ENTRY_KINDS)[number];

/** `03` #8, #9: past a credit limit the owner is warned, or needs their own password. */
export const OVER_CREDIT_LIMIT_SETTINGS = ['warn', 'block'] as const;
export type OverCreditLimitSetting = (typeof OVER_CREDIT_LIMIT_SETTINGS)[number];

/** `03` #5: a customer pays within this many days unless set otherwise. */
export const DEFAULT_DUE_DAYS = 30;
export const MAX_DUE_DAYS = 365;

/** `YYYY-MM-DD` plus whole days, on the calendar (no time zone, no daylight saving). */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

// ---- Which bills are still unpaid (design §4) ----

/** What `unpaidEntries` reads of a ledger entry. */
export interface LedgerEntry {
  id: string;
  kind: UdhaarEntryKind;
  /** Signed: above 0 the customer owes more, below 0 they paid. */
  amountPaise: number;
  /** For every entry above 0: the day it falls due. */
  dueDate: string | null;
  /** For a `payment_reversal`: the payment it takes back. */
  reversesEntryId: string | null;
}

export interface UnpaidEntry<E extends LedgerEntry> {
  entry: E;
  /** All of it, or the part still owed when payments have eaten into it. */
  unpaidPaise: number;
}

/**
 * The entries still unpaid, oldest first, for a customer who owes `balancePaise` (`03` #4:
 * every payment clears the oldest bill first). `entries` are all of the customer's entries,
 * oldest first. A reversed payment never happened, so it and its reversal are left out; the bills
 * it had paid are owed again. Then the newest entries above 0 that add up to the balance are the
 * unpaid ones, the last taken possibly only in part: everything older was paid. The only place
 * this rule lives; the ledger page, the overdue buckets and the reminders all call it.
 */
export function unpaidEntries<E extends LedgerEntry>(
  entries: readonly E[],
  balancePaise: number,
): UnpaidEntry<E>[] {
  const reversed = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'payment_reversal' && entry.reversesEntryId !== null
        ? [entry.reversesEntryId]
        : [],
    ),
  );
  const standing = entries.filter(
    (entry) => entry.kind !== 'payment_reversal' && !reversed.has(entry.id),
  );
  const unpaid: UnpaidEntry<E>[] = [];
  let left = balancePaise;
  for (let at = standing.length - 1; at >= 0 && left > 0; at -= 1) {
    const entry = standing[at];
    if (entry === undefined || entry.amountPaise <= 0) continue;
    const unpaidPaise = Math.min(entry.amountPaise, left);
    unpaid.unshift({ entry, unpaidPaise });
    left -= unpaidPaise;
  }
  return unpaid;
}

// ---- The credit limit (design §5; `03` #8–#10, #17, #18) ----

export type CreditLimitVerdict = 'within' | 'warn' | 'needs_approval';

/**
 * What a bill's udhaar does to the credit limit. `balanceAfterPaise` is what the customer would
 * owe once the bill is saved. Within the limit, nothing. Over it, the owner is warned or (if
 * "block") needs their password; staff always need the owner's password over the limit. With no
 * limit set the owner may give any amount and staff always need the password.
 */
export function creditLimitVerdict(input: {
  who: 'owner' | 'staff';
  setting: OverCreditLimitSetting;
  limitPaise: number | null;
  balanceAfterPaise: number;
}): CreditLimitVerdict {
  const over =
    input.limitPaise === null ? input.who === 'staff' : input.balanceAfterPaise > input.limitPaise;
  if (!over) return 'within';
  if (input.who === 'staff') return 'needs_approval';
  return input.setting === 'warn' ? 'warn' : 'needs_approval';
}

// ---- Request bodies ----

const amount = () =>
  z.int({ error: 'invalid' }).min(1, { error: 'too_small' }).max(MAX_BILL_PAISE, {
    error: 'too_big',
  });

/**
 * `POST /api/udhaar/payments` (`03` #3, #11): any amount, any time. The screen makes one key per
 * attempt and sends it again on a retry (ADR 0007 rule 7).
 */
export const udhaarPaymentSchema = z
  .strictObject({
    requestKey: uuid(),
    customerId: uuid(),
    amountPaise: amount(),
    mode: z.enum(MONEY_PAYMENT_MODES, { error: 'invalid' }),
    /** UPI or card: last digits or UTR (optional). Cheque: its number (required). */
    reference: optionalText(40)
      .optional()
      .transform((value) => value ?? null),
  })
  .superRefine((payment, context) => {
    if (payment.mode === 'cheque' && payment.reference === null) {
      context.addIssue({ code: 'custom', path: ['reference'], message: 'required' });
    }
  });
export type UdhaarPaymentInput = z.infer<typeof udhaarPaymentSchema>;

/** `POST /api/udhaar/payments/:id/reverse` (owner only, `03` #21). */
export const udhaarReversalSchema = ownerPasswordSchema.extend({ reason: text(200) });
export type UdhaarReversalInput = z.infer<typeof udhaarReversalSchema>;

/**
 * `POST /api/udhaar/opening` (owner only, `03` #20): what the old notebook says the customer
 * owed on `asOf`, once per customer. Negative is an advance already taken.
 */
export const udhaarOpeningSchema = z.strictObject({
  requestKey: uuid(),
  customerId: uuid(),
  amountPaise: z
    .int({ error: 'invalid' })
    .min(-MAX_BILL_PAISE, { error: 'too_small' })
    .max(MAX_BILL_PAISE, { error: 'too_big' })
    .refine((paise) => paise !== 0, { error: 'invalid' }),
  asOf: z.string({ error: 'required' }).refine(isCalendarDate, { error: 'invalid' }),
  reason: text(200),
});
export type UdhaarOpeningInput = z.infer<typeof udhaarOpeningSchema>;

/** `PUT /api/settings/udhaar`. */
export const settingsUdhaarSchema = z.strictObject({
  overCreditLimit: z.enum(OVER_CREDIT_LIMIT_SETTINGS, { error: 'invalid' }),
});
export type SettingsUdhaarInput = z.infer<typeof settingsUdhaarSchema>;
