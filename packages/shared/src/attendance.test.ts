import { describe, expect, it } from 'vitest';
import { fieldErrors } from './fields.js';
import {
  attendanceMarkSchema,
  dayCounts,
  dayStatus,
  daysInMonth,
  monthCounts,
  monthDates,
  registerQuerySchema,
  salaryRateFor,
  salaryRateProblem,
  salaryRateSchema,
  summaryLine,
  weekdayOf,
  type DayState,
  type RegisterPerson,
  type SalaryRate,
  type ShopHoliday,
} from './attendance.js';

const BRANCH = '0190f0f0-0000-7000-8000-000000000001';
const OTHER_BRANCH = '0190f0f0-0000-7000-8000-000000000002';

/** Joined on a Monday in October 2026, a Sunday weekly off, still working. */
const person: RegisterPerson = {
  joiningDate: '2026-10-05',
  deactivatedOn: null,
  weeklyOffDay: 0,
  homeBranchId: BRANCH,
};

const present = (extra: Partial<DayState> = {}): DayState => ({
  status: 'present',
  late: false,
  overtimeMinutes: 0,
  marked: false,
  ...extra,
});
const on = (status: DayState['status']): DayState => present({ status });

describe('weekdayOf and daysInMonth', () => {
  it('reads the weekday of a calendar date, 0 = Sunday', () => {
    expect(weekdayOf('2026-11-22')).toBe(0);
    expect(weekdayOf('2026-11-23')).toBe(1);
    expect(weekdayOf('2026-11-28')).toBe(6);
  });

  it('knows months of 28, 29, 30 and 31 days', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-12')).toBe(31);
  });

  it.each([
    ['2026-02', 28],
    ['2028-02', 29],
    ['2026-11', 30],
    ['2026-12', 31],
  ])('lists every date of %s once, in order', (month, days) => {
    const dates = monthDates(month);
    expect(dates).toHaveLength(days);
    expect(dates[0]).toBe(`${month}-01`);
    expect(dates.at(-1)).toBe(`${month}-${String(days)}`);
    expect(new Set(dates).size).toBe(days);
  });
});

describe('dayStatus (05 #29)', () => {
  const none: ShopHoliday[] = [];

  it('is present on an ordinary day nobody marked', () => {
    expect(dayStatus(person, '2026-11-03', none, null)).toEqual(present());
  });

  it("is the person's weekly off on that weekday", () => {
    expect(dayStatus(person, '2026-11-01', none, null)).toEqual(on('weekly_off'));
    expect(dayStatus({ ...person, weeklyOffDay: null }, '2026-11-01', none, null)).toEqual(
      present(),
    );
  });

  it('is a shop holiday for every branch, or for the person’s own branch only', () => {
    const everyBranch = [{ date: '2026-11-09', branchId: null }];
    const mine = [{ date: '2026-11-10', branchId: BRANCH }];
    const theirs = [{ date: '2026-11-11', branchId: OTHER_BRANCH }];
    const holidays = [...everyBranch, ...mine, ...theirs];
    expect(dayStatus(person, '2026-11-09', holidays, null)).toEqual(on('holiday'));
    expect(dayStatus(person, '2026-11-10', holidays, null)).toEqual(on('holiday'));
    // Another branch's holiday doesn't close this person's shop.
    expect(dayStatus(person, '2026-11-11', holidays, null)).toEqual(present());
  });

  it('prefers the weekly off when a holiday falls on it', () => {
    expect(dayStatus(person, '2026-11-01', [{ date: '2026-11-01', branchId: null }], null)).toEqual(
      on('weekly_off'),
    );
  });

  it('takes a mark over the default, with its late tick and overtime', () => {
    const mark = { status: 'present', late: true, overtimeMinutes: 90 } as const;
    expect(dayStatus(person, '2026-11-01', none, mark)).toEqual({ ...mark, marked: true });
    const absent = { status: 'absent', late: false, overtimeMinutes: 0 } as const;
    expect(
      dayStatus(person, '2026-11-09', [{ date: '2026-11-09', branchId: null }], absent),
    ).toEqual({ ...absent, marked: true });
  });

  it('is not on the register before the joining date', () => {
    expect(dayStatus(person, '2026-10-04', none, null)).toBeNull();
    expect(dayStatus(person, '2026-10-05', none, null)).toEqual(present());
  });

  it('is on the register on the day of deactivation, not after it', () => {
    const left = { ...person, deactivatedOn: '2026-11-10' };
    expect(dayStatus(left, '2026-11-10', none, null)).toEqual(present());
    expect(dayStatus(left, '2026-11-11', none, null)).toBeNull();
  });
});

describe('monthCounts (05 #28)', () => {
  it('counts every status over a month of 30 days and what was taken', () => {
    const days: (DayState | null)[] = [
      ...Array.from({ length: 20 }, () => present()),
      on('absent'),
      on('absent'),
      on('half_day'),
      on('paid_leave'),
      on('weekly_off'),
      on('weekly_off'),
      on('weekly_off'),
      on('holiday'),
      present({ late: true, overtimeMinutes: 60 }),
      present({ late: true, overtimeMinutes: 30 }),
    ];
    expect(days).toHaveLength(30);
    expect(monthCounts(days)).toEqual({
      present: 22,
      halfDay: 1,
      absent: 2,
      paidLeave: 1,
      weeklyOff: 3,
      holiday: 1,
      late: 2,
      overtimeMinutes: 90,
      // Absent and leave days, a half-day as half; weekly offs and holidays are not "taken".
      holidaysTaken: 3.5,
    });
  });

  it('leaves out days before joining or after leaving', () => {
    expect(monthCounts([null, null, present()]).present).toBe(1);
  });

  it('is all zero for a month with nothing on the register', () => {
    expect(monthCounts([]).holidaysTaken).toBe(0);
  });
});

describe('the day summary line (07 #13)', () => {
  it('counts the day’s absences, half-days and leave', () => {
    const counts = dayCounts([
      on('present'),
      on('absent'),
      on('absent'),
      on('paid_leave'),
      on('weekly_off'),
    ]);
    expect(counts).toEqual({ absent: 2, halfDay: 0, paidLeave: 1 });
    expect(summaryLine(counts)).toBe('2 absent, 1 on leave');
  });

  it('names a half-day, and says so when everybody is in', () => {
    expect(summaryLine({ absent: 0, halfDay: 1, paidLeave: 0 })).toBe('1 half-day');
    expect(summaryLine({ absent: 1, halfDay: 2, paidLeave: 3 })).toBe(
      '1 absent, 2 half-day, 3 on leave',
    );
    expect(summaryLine({ absent: 0, halfDay: 0, paidLeave: 0 })).toBe('Everyone is in');
  });
});

describe('salaryRateFor (05 #3)', () => {
  const rate = (fromMonth: string, amountPaise: number, kind = 'monthly'): SalaryRate => ({
    fromMonth,
    kind: kind as SalaryRate['kind'],
    amountPaise,
  });
  // Rates in the order they were made.
  const rates = [
    rate('2026-04-01', 1_000_000),
    rate('2026-10-01', 1_200_000),
    rate('2026-07-01', 1_100_000),
  ];

  it('is the latest rate that started on or before the month', () => {
    expect(salaryRateFor(rates, '2026-03')).toBeNull();
    expect(salaryRateFor(rates, '2026-04')?.amountPaise).toBe(1_000_000);
    expect(salaryRateFor(rates, '2026-06')?.amountPaise).toBe(1_000_000);
    expect(salaryRateFor(rates, '2026-07')?.amountPaise).toBe(1_100_000);
    expect(salaryRateFor(rates, '2026-09')?.amountPaise).toBe(1_100_000);
    expect(salaryRateFor(rates, '2026-10')?.amountPaise).toBe(1_200_000);
    expect(salaryRateFor(rates, '2030-01')?.amountPaise).toBe(1_200_000);
  });

  it('lets the later row win when a month was changed twice', () => {
    const twice = [rate('2026-11-01', 1_300_000), rate('2026-11-01', 1_350_000, 'daily')];
    expect(salaryRateFor(twice, '2026-11')).toEqual(rate('2026-11-01', 1_350_000, 'daily'));
  });

  it('is null for a person with no rate', () => {
    expect(salaryRateFor([], '2026-11')).toBeNull();
  });
});

describe('salaryRateProblem (05 #30)', () => {
  it('allows this month and later, never an earlier one', () => {
    expect(salaryRateProblem('2026-11', '2026-11-22')).toBeNull();
    expect(salaryRateProblem('2026-11', '2026-11-01')).toBeNull();
    expect(salaryRateProblem('2026-12', '2026-11-30')).toBeNull();
    expect(salaryRateProblem('2027-01', '2026-11-22')).toBeNull();
    expect(salaryRateProblem('2026-10', '2026-11-01')).toBe('past_month');
    expect(salaryRateProblem('2025-12', '2026-01-15')).toBe('past_month');
  });
});

describe('the request schemas', () => {
  const errors =
    (schema: { safeParse(input: unknown): { success: boolean; error?: unknown } }) =>
    (input: unknown) => {
      const result = schema.safeParse(input);
      return result.success ? null : fieldErrors(result.error as never);
    };

  it('reads a salary rate from a month, never a day', () => {
    const ok = salaryRateSchema.parse({ fromMonth: '2026-12', kind: 'daily', amountPaise: 50_000 });
    expect(ok).toEqual({ fromMonth: '2026-12', kind: 'daily', amountPaise: 50_000 });
    const bad = errors(salaryRateSchema);
    expect(bad({ fromMonth: '2026-12-15', kind: 'daily', amountPaise: 1 })).toEqual({
      fromMonth: 'invalid',
    });
    expect(bad({ fromMonth: '2026-13', kind: 'daily', amountPaise: 1 })).toEqual({
      fromMonth: 'invalid',
    });
    expect(bad({ fromMonth: '2026-12', kind: 'weekly', amountPaise: 1 })).toEqual({
      kind: 'invalid',
    });
    expect(bad({ fromMonth: '2026-12', kind: 'monthly', amountPaise: 0 })).toEqual({
      amountPaise: 'too_small',
    });
    expect(bad({ fromMonth: '2026-12', kind: 'monthly', amountPaise: 12.5 })).toEqual({
      amountPaise: 'invalid',
    });
  });

  it('allows late and overtime only on a present day, in 30-minute steps up to 12 hours', () => {
    const base = { status: 'present', late: false, overtimeMinutes: 0, version: null };
    expect(attendanceMarkSchema.parse({ ...base, late: true, overtimeMinutes: 90 })).toMatchObject({
      late: true,
      overtimeMinutes: 90,
    });
    const bad = errors(attendanceMarkSchema);
    expect(bad({ ...base, status: 'absent', late: true })).toEqual({ late: 'only_when_present' });
    expect(bad({ ...base, status: 'half_day', overtimeMinutes: 30 })).toEqual({
      overtimeMinutes: 'only_when_present',
    });
    expect(bad({ ...base, overtimeMinutes: 45 })).toEqual({ overtimeMinutes: 'invalid' });
    expect(bad({ ...base, overtimeMinutes: 750 })).toEqual({ overtimeMinutes: 'too_big' });
    expect(bad({ ...base, overtimeMinutes: -30 })).toEqual({ overtimeMinutes: 'too_small' });
  });

  it('needs a version key: null for a day nobody marked yet', () => {
    expect(attendanceMarkSchema.parse({ status: 'absent', version: 3 })).toMatchObject({
      late: false,
      overtimeMinutes: 0,
      version: 3,
    });
    expect(errors(attendanceMarkSchema)({ status: 'absent' })).toEqual({ version: 'invalid' });
    expect(errors(attendanceMarkSchema)({ status: 'absent', version: 0 })).toEqual({
      version: 'invalid',
    });
  });

  it('takes a real calendar date for the register', () => {
    expect(registerQuerySchema.parse({ date: '2028-02-29' })).toEqual({ date: '2028-02-29' });
    expect(errors(registerQuerySchema)({ date: '2026-02-29' })).toEqual({ date: 'invalid' });
    expect(errors(registerQuerySchema)({})).toEqual({ date: 'required' });
  });
});
