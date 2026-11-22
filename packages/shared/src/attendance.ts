// Attendance, shop holidays and salary rates (P2.3 design `docs/plans/2026-11-22-p2.3-staff-
// attendance-design.md`; Module 05 #3, #5–#9, #28–#33). Dates are IST calendar days as
// `YYYY-MM-DD`, months `YYYY-MM`; money is whole paise (ADR 0008). Only the marks people make are
// stored (ADR 0048): `dayStatus` is the one place that says what any other day is.
// Error messages are codes the web app translates (ADR 0036).
import { z } from 'zod';
import { optionalText, text, uuid } from './fields.js';

export const ATTENDANCE_STATUSES = [
  'present',
  'half_day',
  'absent',
  'paid_leave',
  'weekly_off',
  'holiday',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Overtime is marked in half-hour steps, up to 12 hours a day (the database says the same). */
export const OVERTIME_STEP_MINUTES = 30;
export const MAX_OVERTIME_MINUTES = 720;

/** The most a salary or an hourly overtime rate may be: ₹10,00,000 and ₹10,000. */
export const MAX_SALARY_PAISE = 100_000_000;
export const MAX_OVERTIME_RATE_PAISE = 1_000_000;

export const SALARY_KINDS = ['monthly', 'daily'] as const;
export type SalaryKind = (typeof SALARY_KINDS)[number];

// ---- Dates ----

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** True for a real calendar date written as `YYYY-MM-DD` (no 30 February). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const day = utcDay(value);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/** 0 = Sunday … 6 = Saturday, the numbering `weekly_off_day` uses. */
export function weekdayOf(date: string): number {
  return utcDay(date).getUTCDay();
}

/** 28 to 31. */
export function daysInMonth(month: string): number {
  const [year = 0, number = 0] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/** Every date of a month in order. */
export function monthDates(month: string): string[] {
  return Array.from(
    { length: daysInMonth(month) },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

const isoDate = () => z.string({ error: 'required' }).refine(isCalendarDate, { error: 'invalid' });

const isoMonth = () => z.string({ error: 'required' }).regex(MONTH_PATTERN, { error: 'invalid' });

// ---- What a day is ----

/** What `dayStatus` needs to know about a person (dates as `YYYY-MM-DD`, IST). */
export interface RegisterPerson {
  joiningDate: string;
  /** The day they were deactivated; null while working. They stay on the register that day. */
  deactivatedOn: string | null;
  /** 0 = Sunday … 6 = Saturday; null = no weekly off. */
  weeklyOffDay: number | null;
  homeBranchId: string;
}

/** A live shop holiday; `branchId` null closes every branch (`05` #31). */
export interface ShopHoliday {
  date: string;
  branchId: string | null;
}

/** The mark a person's day was saved with. */
export interface MarkedDay {
  status: AttendanceStatus;
  late: boolean;
  overtimeMinutes: number;
}

export interface DayState extends MarkedDay {
  /** False for a default day nobody saved. */
  marked: boolean;
}

/**
 * What a person's day is (`05` #29): their mark if somebody made one, else the default. The
 * default is weekly off on the person's weekly off day, a holiday on a shop holiday for their
 * branch or every branch, and present on any other day. Null when they aren't on the register
 * that day: before their joining date, or after the day they were deactivated.
 */
export function dayStatus(
  person: RegisterPerson,
  date: string,
  holidays: readonly ShopHoliday[],
  mark: MarkedDay | null,
): DayState | null {
  if (date < person.joiningDate) return null;
  if (person.deactivatedOn !== null && date > person.deactivatedOn) return null;
  if (mark !== null) {
    return {
      status: mark.status,
      late: mark.late,
      overtimeMinutes: mark.overtimeMinutes,
      marked: true,
    };
  }
  let status: AttendanceStatus = 'present';
  if (person.weeklyOffDay !== null && weekdayOf(date) === person.weeklyOffDay) {
    status = 'weekly_off';
  } else if (
    holidays.some(
      (holiday) =>
        holiday.date === date &&
        (holiday.branchId === null || holiday.branchId === person.homeBranchId),
    )
  ) {
    status = 'holiday';
  }
  return { status, late: false, overtimeMinutes: 0, marked: false };
}

export interface MonthCounts {
  present: number;
  halfDay: number;
  absent: number;
  paidLeave: number;
  weeklyOff: number;
  holiday: number;
  late: number;
  overtimeMinutes: number;
  /** "Holidays taken" (`05` #28): absent and leave days, a half-day as half. Not weekly offs or shop holidays. */
  holidaysTaken: number;
}

/** A month's counts from its days; a day off the register (null) counts for nothing. */
export function monthCounts(days: readonly (DayState | null)[]): MonthCounts {
  const counts: MonthCounts = {
    present: 0,
    halfDay: 0,
    absent: 0,
    paidLeave: 0,
    weeklyOff: 0,
    holiday: 0,
    late: 0,
    overtimeMinutes: 0,
    holidaysTaken: 0,
  };
  for (const day of days) {
    if (day === null) continue;
    if (day.status === 'present') counts.present += 1;
    else if (day.status === 'half_day') counts.halfDay += 1;
    else if (day.status === 'absent') counts.absent += 1;
    else if (day.status === 'paid_leave') counts.paidLeave += 1;
    else if (day.status === 'weekly_off') counts.weeklyOff += 1;
    else counts.holiday += 1;
    if (day.late) counts.late += 1;
    counts.overtimeMinutes += day.overtimeMinutes;
  }
  counts.holidaysTaken = counts.absent + counts.paidLeave + counts.halfDay / 2;
  return counts;
}

export interface DayCounts {
  absent: number;
  halfDay: number;
  paidLeave: number;
}

/** One day's count across people: who is missing. */
export function dayCounts(days: readonly Pick<DayState, 'status'>[]): DayCounts {
  const counts = { absent: 0, halfDay: 0, paidLeave: 0 };
  for (const { status } of days) {
    if (status === 'absent') counts.absent += 1;
    else if (status === 'half_day') counts.halfDay += 1;
    else if (status === 'paid_leave') counts.paidLeave += 1;
  }
  return counts;
}

/** "2 absent, 1 on leave": the register's header and the daily summary's line (`07` #13). */
export function summaryLine(counts: DayCounts): string {
  const parts = [
    counts.absent > 0 ? `${String(counts.absent)} absent` : null,
    counts.halfDay > 0 ? `${String(counts.halfDay)} half-day` : null,
    counts.paidLeave > 0 ? `${String(counts.paidLeave)} on leave` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? 'Everyone is in' : parts.join(', ');
}

// ---- Salary rates ----

export interface SalaryRate {
  /** The 1st of a month, `YYYY-MM-01`. */
  fromMonth: string;
  kind: SalaryKind;
  amountPaise: number;
}

/**
 * The rate in force for a month (`05` #3): the one with the latest start on or before it. Rates
 * are given in the order they were made, so when two start in the same month the later wins.
 * Null while the person has none.
 */
export function salaryRateFor<Rate extends SalaryRate>(
  rates: readonly Rate[],
  month: string,
): Rate | null {
  let found: Rate | null = null;
  for (const rate of rates) {
    if (rate.fromMonth.slice(0, 7) > month) continue;
    if (found === null || rate.fromMonth >= found.fromMonth) found = rate;
  }
  return found;
}

/** `05` #30: a new rate starts from this month or a later one, never an earlier one. */
export function salaryRateProblem(fromMonth: string, today: string): 'past_month' | null {
  return fromMonth < today.slice(0, 7) ? 'past_month' : null;
}

// ---- Requests ----

/** A rate's kind and amount, for a new one and for a person's first. */
export const salaryShape = {
  kind: z.enum(SALARY_KINDS, { error: 'invalid' }),
  amountPaise: z
    .int({ error: 'invalid' })
    .min(1, { error: 'too_small' })
    .max(MAX_SALARY_PAISE, { error: 'too_big' }),
};
export const salaryInputSchema = z.strictObject(salaryShape);
export type SalaryInput = z.infer<typeof salaryInputSchema>;

/** `POST /api/staff/:id/salary-rates`: a rate from the 1st of `fromMonth`. */
export const salaryRateSchema = z.strictObject({ fromMonth: isoMonth(), ...salaryShape });
export type SalaryRateInput = z.infer<typeof salaryRateSchema>;

/** The record fields a staff member has, as a request takes them (`05` #1). */
export const recordFieldsShape = {
  weeklyOffDay: z
    .int({ error: 'invalid' })
    .min(0, { error: 'invalid' })
    .max(6, { error: 'invalid' })
    .nullable(),
  paidLeavesPerMonth: z
    .int({ error: 'invalid' })
    .min(0, { error: 'too_small' })
    .max(31, { error: 'too_big' }),
  overtimeRatePaise: z
    .int({ error: 'invalid' })
    .min(1, { error: 'too_small' })
    .max(MAX_OVERTIME_RATE_PAISE, { error: 'too_big' })
    .nullable(),
  joiningDate: isoDate(),
};

/** `GET /api/attendance?date=`: the owner may add `branch`, as the branch picker does. */
export const registerQuerySchema = z.strictObject({
  date: isoDate(),
  branch: uuid().optional(),
});
export type RegisterQuery = z.infer<typeof registerQuerySchema>;

/**
 * `PUT /api/attendance/:userId/:date`: one person's day. `version` is the saved mark's version, or
 * null for a day nobody has marked. A day before today also needs `reason`; the service knows
 * today, so it answers that one.
 */
export const attendanceMarkSchema = z
  .strictObject({
    status: z.enum(ATTENDANCE_STATUSES, { error: 'invalid' }),
    late: z.boolean({ error: 'invalid' }).default(false),
    overtimeMinutes: z
      .int({ error: 'invalid' })
      .min(0, { error: 'too_small' })
      .max(MAX_OVERTIME_MINUTES, { error: 'too_big' })
      .refine((minutes) => minutes % OVERTIME_STEP_MINUTES === 0, { error: 'invalid' })
      .default(0),
    version: z.int({ error: 'invalid' }).min(1, { error: 'invalid' }).nullable(),
    reason: optionalText(200).optional(),
  })
  .superRefine((value, context) => {
    // Zod runs this even when a field failed its own check, so look only at valid values.
    if (value.status === 'present') return;
    if (value.late) {
      context.addIssue({ code: 'custom', path: ['late'], message: 'only_when_present' });
    }
    if (typeof value.overtimeMinutes === 'number' && value.overtimeMinutes > 0) {
      context.addIssue({
        code: 'custom',
        path: ['overtimeMinutes'],
        message: 'only_when_present',
      });
    }
  });
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;

/** `GET /api/attendance/month?userId=&month=`. */
export const monthQuerySchema = z.strictObject({ userId: uuid(), month: isoMonth() });
export type MonthQuery = z.infer<typeof monthQuerySchema>;

/** `POST /api/holidays`: `branchId` null closes every branch (`05` #31). */
export const holidaySchema = z.strictObject({
  date: isoDate(),
  name: text(100),
  branchId: uuid().nullable(),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

/** `GET /api/holidays?year=`: the calendar of one year (this one by default). */
export const holidaysQuerySchema = z.strictObject({
  year: z
    .string()
    .regex(/^\d{4}$/, { error: 'invalid' })
    .optional(),
});
export type HolidaysQuery = z.infer<typeof holidaysQuerySchema>;

/** `POST /api/holidays/:id/remove`: an optional reason for the log. */
export const removeHolidaySchema = z.strictObject({ reason: optionalText(200).optional() });
export type RemoveHolidayInput = z.infer<typeof removeHolidaySchema>;

// ---- What the API answers ----

export interface SalaryRateView {
  id: string;
  /** `YYYY-MM-01`. */
  fromMonth: string;
  kind: SalaryKind;
  amountPaise: number;
  createdAt: string;
}

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  /** Null: every branch. */
  branchId: string | null;
}

export interface RegisterRow extends DayState {
  userId: string;
  name: string;
  /** The saved mark's version; null for a default day (`PUT` it back as `version`). */
  version: number | null;
  /** Whether late and overtime can be set: overtime needs the person's rate. */
  overtimeAllowed: boolean;
  paidLeavesPerMonth: number;
  /** Paid leaves marked this month, the date's month. */
  paidLeavesUsed: number;
}

export interface RegisterView {
  date: string;
  branchId: string;
  rows: RegisterRow[];
  counts: DayCounts;
  summary: string;
}

export interface MonthDay {
  date: string;
  /** Null: not on the register that day. */
  state: DayState | null;
}

export interface MonthView {
  userId: string;
  name: string;
  month: string;
  paidLeavesPerMonth: number;
  days: MonthDay[];
  counts: MonthCounts;
}

/** `409 changed`: somebody saved this day first; here is what is there now. */
export interface ChangedAnswer {
  code: 'changed';
  latest: RegisterRow;
}
