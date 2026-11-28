import { describe, expect, it } from 'vitest';
import {
  COLLECTED_DAYS,
  collectedFrom,
  daysBetween,
  OVERDUE_BUCKETS,
  overdueBreakdown,
  overdueBucket,
  reminderPreparedSchema,
  unpaidEntries,
  type LedgerEntry,
} from './index.js';

describe('daysBetween', () => {
  it('counts calendar days, across months, leap days and years', () => {
    expect(daysBetween('2026-11-20', '2026-11-28')).toBe(8);
    expect(daysBetween('2026-11-28', '2026-11-28')).toBe(0);
    expect(daysBetween('2026-12-05', '2026-11-28')).toBe(-7);
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(3);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });
});

describe('overdueBucket (03 #12)', () => {
  it.each([
    [-5, null],
    [0, null],
    [1, 'days_1_30'],
    [30, 'days_1_30'],
    [31, 'days_31_60'],
    [60, 'days_31_60'],
    [61, 'days_61_90'],
    [90, 'days_61_90'],
    [91, 'days_over_90'],
    [400, 'days_over_90'],
  ])('%i days late is in %s', (late, bucket) => {
    expect(overdueBucket(late)).toBe(bucket);
  });

  it('has the four buckets, oldest last', () => {
    expect(OVERDUE_BUCKETS).toEqual(['days_1_30', 'days_31_60', 'days_61_90', 'days_over_90']);
  });
});

describe('overdueBreakdown', () => {
  const today = '2026-11-28';

  it('puts what is not due yet apart, and each late amount in its bucket', () => {
    const breakdown = overdueBreakdown(
      [
        { dueDate: '2026-11-28', unpaidPaise: 100 }, // due today: not late
        { dueDate: '2026-12-20', unpaidPaise: 200 },
        { dueDate: '2026-11-18', unpaidPaise: 300 }, // 10 late
        { dueDate: '2026-10-15', unpaidPaise: 400 }, // 44 late
        { dueDate: '2026-09-20', unpaidPaise: 500 }, // 69 late
        { dueDate: '2026-06-01', unpaidPaise: 600 }, // 180 late
        { dueDate: '2026-11-10', unpaidPaise: 50 }, // 18 late
      ],
      today,
    );
    expect(breakdown).toEqual({
      notDuePaise: 300,
      overduePaise: 1_850,
      buckets: { days_1_30: 350, days_31_60: 400, days_61_90: 500, days_over_90: 600 },
      oldestOverdueDueDate: '2026-06-01',
    });
  });

  it('is all zero with nothing unpaid', () => {
    expect(overdueBreakdown([], today)).toEqual({
      notDuePaise: 0,
      overduePaise: 0,
      buckets: { days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0 },
      oldestOverdueDueDate: null,
    });
  });

  it('has no oldest overdue date when everything is still within its due date', () => {
    expect(
      overdueBreakdown([{ dueDate: '2026-11-28', unpaidPaise: 100 }], today).oldestOverdueDueDate,
    ).toBeNull();
  });

  it('reads the buckets from unpaidEntries, so a payment clears the oldest first and a late opening is the oldest', () => {
    // A bill due 2026-12-10 (not late), then a payment, then an opening balance entered later
    // that fell due 100 days ago. 1,000 owed on the bill and 800 on the opening, 400 paid.
    const entry = (
      id: string,
      kind: LedgerEntry['kind'],
      amountPaise: number,
      dueDate: string | null,
    ): LedgerEntry => ({ id, kind, amountPaise, dueDate, reversesEntryId: null });
    const entries = [
      entry('1', 'bill', 1_000, '2026-12-10'),
      entry('2', 'payment', -400, null),
      entry('3', 'opening', 800, '2026-08-20'),
    ];
    const unpaid = unpaidEntries(entries, 1_400).map((row) => ({
      dueDate: row.entry.dueDate,
      unpaidPaise: row.unpaidPaise,
    }));
    // The payment went to the opening first: 400 of it is still late, the bill is untouched.
    expect(overdueBreakdown(unpaid, today)).toEqual({
      notDuePaise: 1_000,
      overduePaise: 400,
      buckets: { days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 400 },
      oldestOverdueDueDate: '2026-08-20',
    });
  });
});

describe('the "collected" window', () => {
  it('is the last seven days, today included', () => {
    expect(COLLECTED_DAYS).toBe(7);
    expect(collectedFrom('2026-11-28')).toBe('2026-11-22');
    expect(collectedFrom('2026-01-03')).toBe('2025-12-28');
  });
});

describe('reminderPreparedSchema', () => {
  it('takes a customer id and nothing else', () => {
    const id = '00000000-0000-7000-8000-0000000000aa';
    expect(reminderPreparedSchema.parse({ customerId: id })).toEqual({ customerId: id });
    expect(reminderPreparedSchema.safeParse({ customerId: 'x' }).success).toBe(false);
    expect(reminderPreparedSchema.safeParse({ customerId: id, extra: 1 }).success).toBe(false);
  });
});
