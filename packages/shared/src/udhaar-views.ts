// The udhaar views (P1.19; Module 03 #12, #13, #15): overdue buckets, what was collected lately,
// who owes the most, and the reminder list. Every number reads `unpaidEntries` (design §4), never
// a stored allocation of payments to bills, so none of it can drift from the ledger. Money in
// paise (ADR 0008), dates `YYYY-MM-DD` IST days (`06` #7).
import { z } from 'zod';
import { addDays } from './udhaar.js';
import { uuid } from './fields.js';

/** Calendar days from `from` to `to`; negative when `to` is the earlier day. No time zone or daylight saving. */
export function daysBetween(from: string, to: string): number {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return Math.round(days);
}

/** `03` #12: how late an unpaid amount is. Not yet due (or due today) is in no bucket. */
export const OVERDUE_BUCKETS = ['days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'] as const;
export type OverdueBucket = (typeof OVERDUE_BUCKETS)[number];

/** The bucket for an amount `daysLate` days past its due date; null when it isn't late. */
export function overdueBucket(daysLate: number): OverdueBucket | null {
  if (daysLate <= 0) return null;
  if (daysLate <= 30) return 'days_1_30';
  if (daysLate <= 60) return 'days_31_60';
  if (daysLate <= 90) return 'days_61_90';
  return 'days_over_90';
}

/** One part of the unpaid list: what `unpaidEntries` says is still owed, and its due date. */
export interface DueAmount {
  dueDate: string | null;
  unpaidPaise: number;
}

export interface OverdueBreakdown {
  /** Unpaid, and not yet past its due date. */
  notDuePaise: number;
  /** Unpaid and past its due date: the sum of the buckets. */
  overduePaise: number;
  buckets: Record<OverdueBucket, number>;
  /** The earliest due date among the late amounts; null when nothing is late. */
  oldestOverdueDueDate: string | null;
}

/** Splits unpaid amounts (from `unpaidEntries`) by how late each is on `today`. */
export function overdueBreakdown(items: readonly DueAmount[], today: string): OverdueBreakdown {
  const buckets: Record<OverdueBucket, number> = {
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_over_90: 0,
  };
  let notDuePaise = 0;
  let overduePaise = 0;
  let oldest: string | null = null;
  for (const { dueDate, unpaidPaise } of items) {
    const bucket = dueDate === null ? null : overdueBucket(daysBetween(dueDate, today));
    if (dueDate === null || bucket === null) {
      notDuePaise += unpaidPaise;
      continue;
    }
    buckets[bucket] += unpaidPaise;
    overduePaise += unpaidPaise;
    if (oldest === null || dueDate < oldest) oldest = dueDate;
  }
  return { notDuePaise, overduePaise, buckets, oldestOverdueDueDate: oldest };
}

/** `03` #13: "collected this week" is the last seven days, today included. */
export const COLLECTED_DAYS = 7;

/** The first day of that window. */
export function collectedFrom(today: string): string {
  return addDays(today, -(COLLECTED_DAYS - 1));
}

/** At most this many customers in "who owes the most". */
export const TOP_OWING_COUNT = 5;

/** `POST /api/udhaar/reminders/prepared`: the owner opened WhatsApp for this customer's reminder. */
export const reminderPreparedSchema = z.strictObject({ customerId: uuid() });
export type ReminderPreparedInput = z.infer<typeof reminderPreparedSchema>;

// ---- What `GET /api/udhaar/summary` answers ----

export interface UdhaarOwingRow {
  id: string;
  name: string;
  phone: string | null;
  balancePaise: number;
  /** Of that, what is past its due date. */
  overduePaise: number;
}

export interface UdhaarReminderRow extends UdhaarOwingRow {
  /** The earliest due date among the late amounts. */
  oldestDueDate: string;
  daysLate: number;
}

export interface UdhaarBucketView {
  bucket: OverdueBucket;
  paise: number;
  /** How many customers have something in this bucket. */
  customers: number;
}

export interface UdhaarSummaryView {
  /** The shop's day the numbers are as of. */
  today: string;
  /** Everything customers owe: not yet due plus overdue. Advances are not netted off. */
  owedPaise: number;
  notDuePaise: number;
  overduePaise: number;
  buckets: UdhaarBucketView[];
  collected: {
    fromDate: string;
    toDate: string;
    paise: number;
    /** How many payments, reversed ones left out. */
    payments: number;
  };
  /** The customers who owe the most, biggest first. */
  topOwing: UdhaarOwingRow[];
  /** Everyone with something overdue, the longest overdue first. */
  reminders: UdhaarReminderRow[];
}
