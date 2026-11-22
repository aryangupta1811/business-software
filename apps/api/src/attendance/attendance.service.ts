// The attendance register (P2.3 design sections 3, 5 and 7; Module 05 #5–#9, #25, #27, #29, #32;
// ADR 0048). Only the marks people make are stored; `dayStatus` says what every other day is.
// Each save and its log entry commit together; two counters saving one day: the second sees
// `409 changed` with what the first saved.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  attendanceMarks,
  eq,
  inArray,
  recordEntry,
  sql,
  users,
  type Database,
  type Transaction,
} from '@business-software/db';
import {
  businessDate,
  dayCounts,
  dayStatus,
  daysInMonth,
  monthCounts,
  monthDates,
  summaryLine,
  type AttendanceMarkInput,
  type AttendanceStatus,
  type MarkedDay,
  type MonthQuery,
  type MonthView,
  type RegisterPerson,
  type RegisterQuery,
  type RegisterRow,
  type RegisterView,
  type ShopHoliday,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { branchScope } from '../branches/scope.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { inBusiness } from '../items/conflicts.js';
import { liveHolidays } from './holidays.service.js';

/** What the register needs to know about a person. */
const PERSON = {
  id: users.id,
  name: users.name,
  homeBranchId: users.homeBranchId,
  joiningDate: users.joiningDate,
  deactivatedAt: users.deactivatedAt,
  weeklyOffDay: users.weeklyOffDay,
  paidLeavesPerMonth: users.paidLeavesPerMonth,
  overtimeRatePaise: users.overtimeRatePaise,
};

const MARK = {
  id: attendanceMarks.id,
  userId: attendanceMarks.userId,
  date: attendanceMarks.date,
  status: attendanceMarks.status,
  late: attendanceMarks.late,
  overtimeMinutes: attendanceMarks.overtimeMinutes,
  version: attendanceMarks.version,
};

interface PersonRow {
  id: string;
  name: string | null;
  homeBranchId: string | null;
  joiningDate: string | null;
  deactivatedAt: Date | null;
  weeklyOffDay: number | null;
  paidLeavesPerMonth: number;
  overtimeRatePaise: number | null;
}

interface MarkRow {
  id: string;
  userId: string;
  date: string;
  status: string;
  late: boolean;
  overtimeMinutes: number;
  version: number;
}

/** The person as `dayStatus` reads them. */
function registerPerson(row: PersonRow): RegisterPerson {
  if (row.homeBranchId === null || row.joiningDate === null) {
    throw new Error('Staff row has no home branch or joining date');
  }
  return {
    joiningDate: row.joiningDate,
    deactivatedOn: row.deactivatedAt === null ? null : businessDate(row.deactivatedAt),
    weeklyOffDay: row.weeklyOffDay,
    homeBranchId: row.homeBranchId,
  };
}

function markedDay(row: MarkRow | undefined): MarkedDay | null {
  if (row === undefined) return null;
  return {
    status: row.status as AttendanceStatus,
    late: row.late,
    overtimeMinutes: row.overtimeMinutes,
  };
}

/** The first and last day of the month a date is in. */
function monthOf(date: string): { start: string; end: string } {
  const month = date.slice(0, 7);
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(month))}` };
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Everyone whose home branch this is, each already showing their default (`05` #5). */
  register(caller: Caller, query: RegisterQuery): Promise<RegisterView> {
    this.refuseFuture(query.date);
    const branchId = branchScope(caller, query.branch, 'caller');
    return inBusiness(this.database, caller, async (tx) => {
      const people = await tx
        .select(PERSON)
        .from(users)
        .where(and(eq(users.role, 'staff'), eq(users.homeBranchId, branchId)))
        .orderBy(asc(users.name), asc(users.id));
      const ids = people.map((person) => person.id);
      const marks =
        ids.length === 0
          ? []
          : await tx
              .select(MARK)
              .from(attendanceMarks)
              .where(
                and(eq(attendanceMarks.date, query.date), inArray(attendanceMarks.userId, ids)),
              );
      const holidays = await liveHolidays(tx, query.date, query.date);
      const leaves = await this.paidLeavesUsed(tx, ids, query.date);
      const rows: RegisterRow[] = [];
      for (const person of people) {
        const mark = marks.find((candidate) => candidate.userId === person.id);
        const row = this.rowOf(person, query.date, holidays, mark, leaves.get(person.id) ?? 0);
        if (row !== null) rows.push(row);
      }
      const counts = dayCounts(rows);
      return { date: query.date, branchId, rows, counts, summary: summaryLine(counts) };
    });
  }

  /**
   * One person's day. A day before today needs a reason and is logged as a change (`05` #8);
   * today's is logged as marked. `version` null means "the day nobody had marked".
   */
  async mark(
    caller: Caller,
    userId: string,
    date: string,
    input: AttendanceMarkInput,
  ): Promise<RegisterRow> {
    this.refuseFuture(date);
    const past = date < businessDate(this.clock.now());
    if (past && input.reason == null) {
      throw new BadRequestException({ code: 'invalid_body', fields: { reason: 'required' } });
    }
    if (userId === caller.userId) throw new ForbiddenException({ code: 'own_attendance' });
    return inBusiness(this.database, caller, async (tx) => {
      const person = await this.person(tx, userId, true);
      if (caller.role !== 'owner' && person.homeBranchId !== caller.branchId) {
        throw new ForbiddenException({ code: 'other_branch' });
      }
      const home = registerPerson(person).homeBranchId;
      const holidays = await liveHolidays(tx, date, date);
      const before = dayStatus(registerPerson(person), date, holidays, null);
      if (before === null) throw new UnprocessableEntityException({ code: 'not_on_register' });
      if (input.overtimeMinutes > 0 && person.overtimeRatePaise === null) {
        throw new BadRequestException({
          code: 'invalid_body',
          fields: { overtimeMinutes: 'overtime_off' },
        });
      }
      const [existing] = await tx
        .select(MARK)
        .from(attendanceMarks)
        .where(and(eq(attendanceMarks.userId, userId), eq(attendanceMarks.date, date)))
        .for('update');
      const changed = (latest: MarkRow | undefined) =>
        this.changed(tx, person, date, holidays, latest);
      if ((existing?.version ?? null) !== input.version) throw await changed(existing);
      const next = {
        status: input.status,
        late: input.late,
        overtimeMinutes: input.overtimeMinutes,
      };
      const previous = markedDay(existing) ?? before;
      const unchanged =
        existing !== undefined &&
        previous.status === next.status &&
        previous.late === next.late &&
        previous.overtimeMinutes === next.overtimeMinutes;
      let saved = existing;
      if (!unchanged) {
        if (existing === undefined) {
          [saved] = await tx
            .insert(attendanceMarks)
            .values({
              userId,
              branchId: home,
              date,
              ...next,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing()
            .returning(MARK);
          // Another counter marked this day between our read and our insert.
          if (saved === undefined) {
            const [latest] = await tx
              .select(MARK)
              .from(attendanceMarks)
              .where(and(eq(attendanceMarks.userId, userId), eq(attendanceMarks.date, date)));
            throw await changed(latest);
          }
        } else {
          [saved] = await tx
            .update(attendanceMarks)
            .set({
              ...next,
              version: sql`${attendanceMarks.version} + 1`,
              updatedBy: caller.userId,
              updatedAt: this.clock.now(),
            })
            .where(eq(attendanceMarks.id, existing.id))
            .returning(MARK);
        }
        if (saved === undefined) throw new Error('No attendance mark returned');
        await recordEntry(tx, {
          actorId: caller.userId,
          action: past ? 'attendance.changed' : 'attendance.marked',
          entityType: 'attendance',
          entityId: saved.id,
          branchId: home,
          ...(past && input.reason != null && { reason: input.reason }),
          before: {
            userId,
            date,
            status: previous.status,
            late: previous.late,
            overtimeMinutes: previous.overtimeMinutes,
          },
          after: { userId, date, ...next },
        });
      }
      const leaves = await this.paidLeavesUsed(tx, [userId], date);
      const row = this.rowOf(person, date, holidays, saved, leaves.get(userId) ?? 0);
      if (row === null) throw new Error('A marked day is on the register');
      return row;
    });
  }

  /**
   * A person's month: each day's status and the month's counts. Your own month is always yours;
   * someone else's needs `attendance.view_all` and, outside the owner's, the same branch.
   */
  month(caller: Caller, query: MonthQuery): Promise<MonthView> {
    const own = query.userId === caller.userId;
    if (!own && caller.role !== 'owner' && !caller.permissions.includes('attendance.view_all')) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    const today = businessDate(this.clock.now());
    return inBusiness(this.database, caller, async (tx) => {
      const person = await this.person(tx, query.userId);
      if (!own && caller.role !== 'owner' && person.homeBranchId !== caller.branchId) {
        throw new ForbiddenException({ code: 'other_branch' });
      }
      const dates = monthDates(query.month);
      const [first, last] = [dates[0] ?? '', dates.at(-1) ?? ''];
      const marks = await tx
        .select(MARK)
        .from(attendanceMarks)
        .where(
          and(
            eq(attendanceMarks.userId, person.id),
            sql`${attendanceMarks.date} between ${first} and ${last}`,
          ),
        );
      const holidays = await liveHolidays(tx, first, last);
      const days = dates.map((date) => ({
        date,
        // The register covers today and the days before it (`05` #32).
        state:
          date > today
            ? null
            : dayStatus(
                registerPerson(person),
                date,
                holidays,
                markedDay(marks.find((mark) => mark.date === date)),
              ),
      }));
      return {
        userId: person.id,
        name: person.name ?? '',
        month: query.month,
        paidLeavesPerMonth: person.paidLeavesPerMonth,
        days,
        counts: monthCounts(days.map((day) => day.state)),
      };
    });
  }

  // ---------------------------------------------------------------------------------------

  /** Today and past days only (`05` #32). */
  private refuseFuture(date: string): void {
    if (date > businessDate(this.clock.now())) {
      throw new UnprocessableEntityException({ code: 'future_date' });
    }
  }

  /** A staff member of this business (never the owner's row), optionally locked; else 404. */
  private async person(tx: Transaction, id: string, lock = false): Promise<PersonRow> {
    const query = tx
      .select(PERSON)
      .from(users)
      .where(and(eq(users.id, id), eq(users.role, 'staff')));
    const [row] = await (lock ? query.for('update') : query);
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    return row;
  }

  /** Paid leaves marked in the date's month, per person (`05` #7: shown as "2 of 2 used"). */
  private async paidLeavesUsed(
    tx: Transaction,
    ids: string[],
    date: string,
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const { start, end } = monthOf(date);
    const rows = await tx
      .select({ userId: attendanceMarks.userId, used: sql<number>`count(*)::int` })
      .from(attendanceMarks)
      .where(
        and(
          eq(attendanceMarks.status, 'paid_leave'),
          inArray(attendanceMarks.userId, ids),
          sql`${attendanceMarks.date} between ${start} and ${end}`,
        ),
      )
      .groupBy(attendanceMarks.userId);
    return new Map(rows.map((row) => [row.userId, row.used]));
  }

  /** One register row; null when the person isn't on the register that day. */
  private rowOf(
    person: PersonRow,
    date: string,
    holidays: readonly ShopHoliday[],
    mark: MarkRow | undefined,
    paidLeavesUsed: number,
  ): RegisterRow | null {
    const state = dayStatus(registerPerson(person), date, holidays, markedDay(mark));
    if (state === null) return null;
    return {
      ...state,
      userId: person.id,
      name: person.name ?? '',
      version: mark?.version ?? null,
      overtimeAllowed: person.overtimeRatePaise !== null,
      paidLeavesPerMonth: person.paidLeavesPerMonth,
      paidLeavesUsed,
    };
  }

  /** `409 changed`, with the day as it is now. */
  private async changed(
    tx: Transaction,
    person: PersonRow,
    date: string,
    holidays: readonly ShopHoliday[],
    latest: MarkRow | undefined,
  ): Promise<ConflictException> {
    const leaves = await this.paidLeavesUsed(tx, [person.id], date);
    return new ConflictException({
      code: 'changed',
      latest: this.rowOf(person, date, holidays, latest, leaves.get(person.id) ?? 0),
    });
  }
}
