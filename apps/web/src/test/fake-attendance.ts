import {
  businessDate,
  dayCounts,
  monthCounts,
  monthDates,
  summaryLine,
  weekdayOf,
  type AttendanceMarkInput,
  type AttendanceStatus,
  type HolidayView,
  type MonthView,
  type RegisterRow,
  type RegisterView,
} from '@business-software/shared';
import type { FakeAnswer } from './fake-api';
import { BRANCH_ID } from './fake-staff';

// Made-up IDs and names, never real ones.
export const TODAY = businessDate(new Date());

/** The date `days` before today. */
export function daysAgo(days: number): string {
  return new Date(new Date(`${TODAY}T00:00:00Z`).getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export interface FakePerson {
  id: string;
  name: string;
  overtimeAllowed?: boolean;
  paidLeavesPerMonth?: number;
  paidLeavesUsed?: number;
}

export const MEENA: FakePerson = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Meena Devi',
  overtimeAllowed: true,
  paidLeavesPerMonth: 2,
  paidLeavesUsed: 1,
};
export const RAJU: FakePerson = {
  id: '00000000-0000-4000-8000-0000000000a3',
  name: 'Raju Singh',
};

const rowOf = (
  person: FakePerson,
  mark:
    | { status: AttendanceStatus; late: boolean; overtimeMinutes: number; version: number }
    | undefined,
): RegisterRow => ({
  userId: person.id,
  name: person.name,
  status: mark?.status ?? 'present',
  late: mark?.late ?? false,
  overtimeMinutes: mark?.overtimeMinutes ?? 0,
  marked: mark !== undefined,
  version: mark?.version ?? null,
  overtimeAllowed: person.overtimeAllowed ?? false,
  paidLeavesPerMonth: person.paidLeavesPerMonth ?? 0,
  paidLeavesUsed: person.paidLeavesUsed ?? 0,
});

/**
 * The attendance routes of the API over a register the test can read: everyone starts present,
 * a save replaces the day (a stale `version` answers `409 changed`), and a day before today
 * without a reason is refused as the real route does. Saves are listed for TODAY and the two
 * days before it.
 */
export function attendanceRoutes(people: FakePerson[], branchId = BRANCH_ID) {
  const marks = new Map<
    string,
    { status: AttendanceStatus; late: boolean; overtimeMinutes: number; version: number }
  >();
  const key = (userId: string, date: string) => `${userId}|${date}`;
  const rows = (date: string) =>
    people.map((person) => rowOf(person, marks.get(key(person.id, date))));

  const routes: Record<string, FakeAnswer | ((body: unknown, url: string) => FakeAnswer)> = {
    'GET /api/attendance': (_body, url) => {
      const date = new URL(url, 'http://x').searchParams.get('date') ?? TODAY;
      const list = rows(date);
      const counts = dayCounts(list);
      const view: RegisterView = {
        date,
        branchId,
        rows: list,
        counts,
        summary: summaryLine(counts),
      };
      return { body: view };
    },
  };
  for (const person of people) {
    for (const date of [TODAY, daysAgo(1), daysAgo(2)]) {
      routes[`PUT /api/attendance/${person.id}/${date}`] = (body) => {
        const input = body as AttendanceMarkInput;
        const saved = marks.get(key(person.id, date));
        if (date < TODAY && (input.reason ?? '') === '') {
          return { status: 400, body: { code: 'invalid_body', fields: { reason: 'required' } } };
        }
        if ((saved?.version ?? null) !== input.version) {
          return { status: 409, body: { code: 'changed', latest: rowOf(person, saved) } };
        }
        const next = {
          status: input.status,
          late: input.late,
          overtimeMinutes: input.overtimeMinutes,
          version: (saved?.version ?? 0) + 1,
        };
        marks.set(key(person.id, date), next);
        return { body: rowOf(person, next) };
      };
    }
  }
  return { routes, marks };
}

/** A month where the 3rd was absent, the 5th a weekly off (Sunday) and the 10th a shop holiday. */
export function monthRoute(people: FakePerson[]) {
  return (_body: unknown, url: string): FakeAnswer => {
    const query = new URL(url, 'http://x').searchParams;
    const userId = query.get('userId') ?? '';
    const month = query.get('month') ?? TODAY.slice(0, 7);
    const person = people.find((candidate) => candidate.id === userId);
    if (person === undefined) return { status: 404, body: { code: 'not_found' } };
    const days = monthDates(month).map((date) => {
      if (date > TODAY) return { date, state: null };
      const status: AttendanceStatus = date.endsWith('-03')
        ? 'absent'
        : weekdayOf(date) === 0
          ? 'weekly_off'
          : 'present';
      return {
        date,
        state: { status, late: date.endsWith('-04'), overtimeMinutes: 0, marked: false },
      };
    });
    const view: MonthView = {
      userId,
      name: person.name,
      month,
      paidLeavesPerMonth: person.paidLeavesPerMonth ?? 0,
      days,
      counts: monthCounts(days.map((day) => day.state)),
    };
    return { body: view };
  };
}

/** The holiday routes over a list the test can read. */
export function holidayRoutes(initial: HolidayView[]) {
  const state = { holidays: [...initial] };
  const routes: Record<string, FakeAnswer | ((body: unknown, url: string) => FakeAnswer)> = {
    'GET /api/holidays': (_body, url) => {
      const year = new URL(url, 'http://x').searchParams.get('year') ?? TODAY.slice(0, 4);
      return { body: state.holidays.filter((holiday) => holiday.date.startsWith(year)) };
    },
    'POST /api/holidays': (body) => {
      const input = body as Omit<HolidayView, 'id'>;
      if (state.holidays.some((h) => h.date === input.date && h.branchId === input.branchId)) {
        return { status: 409, body: { code: 'holiday_exists' } };
      }
      const created = {
        ...input,
        id: `00000000-0000-4000-8000-0000000000c${String(state.holidays.length)}`,
      };
      state.holidays.push(created);
      return { status: 201, body: created };
    },
  };
  for (const holiday of initial) {
    routes[`POST /api/holidays/${holiday.id}/remove`] = () => {
      state.holidays = state.holidays.filter((row) => row.id !== holiday.id);
      return { body: holiday };
    };
  }
  return { routes, state };
}
