import { describe, expect, it } from 'vitest';
import { fieldErrors } from './fields.js';
import {
  addDays,
  creditLimitVerdict,
  settingsUdhaarSchema,
  udhaarCustomersQuerySchema,
  udhaarLedgerQuerySchema,
  udhaarOpeningSchema,
  udhaarPaymentSchema,
  udhaarReversalSchema,
  unpaidEntries,
  type LedgerEntry,
} from './udhaar.js';

const KEY = '00000000-0000-7000-8000-0000000000aa';
const CUSTOMER = '00000000-0000-7000-8000-0000000000bb';

/** Entries come oldest first, as the ledger reads them; ids are their position. */
let counter = 0;
function entry(kind: LedgerEntry['kind'], amountPaise: number, extra: Partial<LedgerEntry> = {}) {
  counter += 1;
  return {
    id: `e${String(counter)}`,
    kind,
    amountPaise,
    dueDate: amountPaise > 0 ? `2026-12-${String(counter).padStart(2, '0')}` : null,
    reversesEntryId: null,
    ...extra,
  } satisfies LedgerEntry;
}

const owed = (entries: LedgerEntry[], balance: number) =>
  unpaidEntries(entries, balance).map((unpaid) => [unpaid.entry.id, unpaid.unpaidPaise]);

describe('unpaidEntries (design §4: oldest bills first, computed)', () => {
  it('has nothing unpaid when nothing is owed', () => {
    expect(unpaidEntries([], 0)).toEqual([]);
    const a = entry('bill', 1_000);
    const p = entry('payment', -1_000);
    expect(unpaidEntries([a, p], 0)).toEqual([]);
  });

  it('has nothing unpaid while the customer has an advance', () => {
    const p = entry('payment', -500);
    expect(unpaidEntries([p], -500)).toEqual([]);
  });

  it('shows one bill partly paid', () => {
    const a = entry('bill', 1_000);
    const p = entry('payment', -400);
    expect(owed([a, p], 600)).toEqual([[a.id, 600]]);
  });

  it('clears the oldest bill first across payments made in between', () => {
    const a = entry('bill', 1_000);
    const p1 = entry('payment', -500);
    const b = entry('bill', 300);
    const p2 = entry('payment', -200);
    const c = entry('bill', 700);
    // Owed 1,300: A has 300 left (500 and 200 paid it down), B and C are whole.
    expect(owed([a, p1, b, p2, c], 1_300)).toEqual([
      [a.id, 300],
      [b.id, 300],
      [c.id, 700],
    ]);
  });

  it('lets a payment clear several old bills and part of the next', () => {
    const a = entry('bill', 200);
    const b = entry('bill', 300);
    const c = entry('bill', 400);
    const p = entry('payment', -600);
    expect(owed([a, b, c, p], 300)).toEqual([[c.id, 300]]);
  });

  it('counts an advance used on a bill and the udhaar after it as one balance', () => {
    const p = entry('payment', -500);
    const used = entry('advance_used', 300);
    const bill = entry('bill', 500);
    // Advance 500, 300 of it used (-200), then 500 on credit: owes 300.
    expect(owed([p, used, bill], 300)).toEqual([[bill.id, 300]]);
    // Before the credit part, the customer still has an advance of 200.
    expect(unpaidEntries([p, used], -200)).toEqual([]);
  });

  it('brings an old bill back when its payment is reversed', () => {
    const a = entry('bill', 1_000);
    const p = entry('payment', -1_000);
    const b = entry('bill', 500);
    expect(owed([a, p, b], 500)).toEqual([[b.id, 500]]);
    const reversal = entry('payment_reversal', 1_000, { reversesEntryId: p.id });
    // The payment never happened: A is owed again, in full, with its own due date.
    expect(unpaidEntries([a, p, b, reversal], 1_500)).toEqual([
      { entry: a, unpaidPaise: 1_000 },
      { entry: b, unpaidPaise: 500 },
    ]);
  });

  it('puts a bill paid from an advance back to unpaid when that advance payment is reversed', () => {
    const a = entry('bill', 500);
    const p = entry('payment', -800);
    const used = entry('advance_used', 300);
    const reversal = entry('payment_reversal', 800, { reversesEntryId: p.id });
    expect(owed([a, p, used, reversal], 800)).toEqual([
      [a.id, 500],
      [used.id, 300],
    ]);
  });

  it('treats an opening balance as the oldest entry', () => {
    const opening = entry('opening', 800);
    const bill = entry('bill', 200);
    const p = entry('payment', -300);
    expect(owed([opening, bill, p], 700)).toEqual([
      [opening.id, 500],
      [bill.id, 200],
    ]);
  });

  it('keeps each entry as given, with its own due date', () => {
    const a = entry('bill', 100, { dueDate: '2026-12-31' });
    expect(unpaidEntries([a], 100)).toEqual([{ entry: a, unpaidPaise: 100 }]);
  });
});

describe('addDays', () => {
  it.each([
    ['2026-11-23', 30, '2026-12-23'],
    ['2026-12-20', 30, '2027-01-19'],
    ['2028-02-01', 28, '2028-02-29'],
    ['2026-11-23', 0, '2026-11-23'],
    ['2026-11-23', 365, '2027-11-23'],
  ])('%s + %i days is %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe('creditLimitVerdict (design §5, `03` #8, #9, #17, #18)', () => {
  const verdict = (
    who: 'owner' | 'staff',
    setting: 'warn' | 'block',
    limitPaise: number | null,
    balanceAfterPaise: number,
  ) => creditLimitVerdict({ who, setting, limitPaise, balanceAfterPaise });

  it('lets anyone through at or below the limit', () => {
    expect(verdict('owner', 'block', 1_000, 1_000)).toBe('within');
    expect(verdict('staff', 'block', 1_000, 999)).toBe('within');
    expect(verdict('staff', 'warn', 0, 0)).toBe('within');
  });

  it('warns the owner over the limit when the setting is warn', () => {
    expect(verdict('owner', 'warn', 1_000, 1_001)).toBe('warn');
  });

  it('asks for the owner password over the limit when the setting is block', () => {
    expect(verdict('owner', 'block', 1_000, 1_001)).toBe('needs_approval');
  });

  it('always asks for the owner password from staff over the limit, warn or block', () => {
    expect(verdict('staff', 'warn', 1_000, 1_001)).toBe('needs_approval');
    expect(verdict('staff', 'block', 1_000, 1_001)).toBe('needs_approval');
  });

  it('has no limit for the owner when none is set, and needs approval from staff', () => {
    expect(verdict('owner', 'block', null, 99_999_999)).toBe('within');
    expect(verdict('owner', 'warn', null, 99_999_999)).toBe('within');
    expect(verdict('staff', 'warn', null, 1)).toBe('needs_approval');
    expect(verdict('staff', 'block', null, 1)).toBe('needs_approval');
  });
});

describe('udhaarPaymentSchema (`03` #3, #11)', () => {
  const body = { requestKey: KEY, customerId: CUSTOMER, amountPaise: 50_000, mode: 'cash' };

  it('takes any amount of at least one paisa in a money mode', () => {
    expect(udhaarPaymentSchema.parse(body)).toEqual({ ...body, reference: null });
    expect(udhaarPaymentSchema.parse({ ...body, amountPaise: 1, mode: 'upi' }).amountPaise).toBe(1);
  });

  it('needs the cheque number for a cheque, and allows a reference for UPI or card', () => {
    const issues = udhaarPaymentSchema.safeParse({ ...body, mode: 'cheque' });
    expect(issues.success).toBe(false);
    if (!issues.success) expect(fieldErrors(issues.error)).toEqual({ reference: 'required' });
    expect(
      udhaarPaymentSchema.parse({ ...body, mode: 'cheque', reference: '000123' }).reference,
    ).toBe('000123');
    expect(udhaarPaymentSchema.parse({ ...body, mode: 'upi', reference: 'UTR1' }).reference).toBe(
      'UTR1',
    );
  });

  it.each([
    ['zero', { amountPaise: 0 }],
    ['a negative amount', { amountPaise: -5 }],
    ['half a paisa', { amountPaise: 1.5 }],
    ['an amount too big to hold', { amountPaise: 10_000_000_000_001 }],
    ['udhaar as the mode of a payment', { mode: 'udhaar' }],
    ['advance as the mode of a payment', { mode: 'advance' }],
    ['no key', { requestKey: undefined }],
    ['a key that is not an id', { requestKey: 'abc' }],
    ['another field', { extra: 1 }],
  ])('refuses %s', (_, change) => {
    expect(udhaarPaymentSchema.safeParse({ ...body, ...change }).success).toBe(false);
  });
});

describe('udhaarReversalSchema (`03` #21)', () => {
  it('needs a reason and the owner password, as typed', () => {
    const body = { reason: 'Wrong customer', ownerPassword: ' typed as is ' };
    expect(udhaarReversalSchema.parse(body)).toEqual(body);
    expect(udhaarReversalSchema.safeParse({ ...body, reason: '  ' }).success).toBe(false);
    expect(udhaarReversalSchema.safeParse({ ...body, ownerPassword: '' }).success).toBe(false);
    expect(udhaarReversalSchema.safeParse({ reason: 'x' }).success).toBe(false);
  });
});

describe('udhaarOpeningSchema (`03` #20)', () => {
  const body = {
    requestKey: KEY,
    customerId: CUSTOMER,
    amountPaise: 123_400,
    asOf: '2026-10-01',
    reason: 'From the old notebook',
  };

  it('takes the amount, the as-of day and the note', () => {
    expect(udhaarOpeningSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['zero', { amountPaise: 0 }],
    ['a day that is not real', { asOf: '2026-02-30' }],
    ['no note', { reason: '' }],
    ['no as-of day', { asOf: undefined }],
  ])('refuses %s', (_, change) => {
    expect(udhaarOpeningSchema.safeParse({ ...body, ...change }).success).toBe(false);
  });
});

describe('settingsUdhaarSchema (`03` #8, #9)', () => {
  it('takes warn or block', () => {
    expect(settingsUdhaarSchema.parse({ overCreditLimit: 'block' })).toEqual({
      overCreditLimit: 'block',
    });
    expect(settingsUdhaarSchema.safeParse({ overCreditLimit: 'allow' }).success).toBe(false);
    expect(settingsUdhaarSchema.safeParse({}).success).toBe(false);
  });
});

describe('the list queries', () => {
  it('reads the customer list query from the URL: text, owing, offset', () => {
    expect(udhaarCustomersQuerySchema.parse({})).toEqual({ owing: false, offset: 0 });
    expect(
      udhaarCustomersQuerySchema.parse({ q: ' Sunita ', owing: 'true', offset: '50' }),
    ).toEqual({ q: 'Sunita', owing: true, offset: 50 });
    for (const bad of [{ owing: 'yes' }, { offset: '-1' }, { offset: '1.5' }, { page: '2' }]) {
      expect(udhaarCustomersQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('takes a ledger page cursor that is an id, and nothing else', () => {
    expect(udhaarLedgerQuerySchema.parse({})).toEqual({});
    expect(udhaarLedgerQuerySchema.parse({ before: KEY })).toEqual({ before: KEY });
    expect(udhaarLedgerQuerySchema.safeParse({ before: 'x' }).success).toBe(false);
    expect(udhaarLedgerQuerySchema.safeParse({ after: KEY }).success).toBe(false);
  });
});
