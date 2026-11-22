// The shop's holiday calendar (P2.3 design sections 3 and 5; Module 05 #7, #31). A holiday is
// for every branch unless it names one; removing one archives it (ADR 0007) and is logged.
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  branches,
  eq,
  isNull,
  recordEntry,
  shopHolidays,
  sql,
  type Database,
  type Transaction,
} from '@business-software/db';
import {
  businessDate,
  type HolidayInput,
  type HolidaysQuery,
  type HolidayView,
  type ShopHoliday,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { inBusiness } from '../items/conflicts.js';

const COLUMNS = {
  id: shopHolidays.id,
  date: shopHolidays.date,
  name: shopHolidays.name,
  branchId: shopHolidays.branchId,
};

/** The live holidays from one date to another, both included, for the register and the month. */
export function liveHolidays(tx: Transaction, from: string, to: string): Promise<ShopHoliday[]> {
  return tx
    .select({ date: shopHolidays.date, branchId: shopHolidays.branchId })
    .from(shopHolidays)
    .where(
      and(isNull(shopHolidays.archivedAt), sql`${shopHolidays.date} between ${from} and ${to}`),
    );
}

@Injectable()
export class HolidaysService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** One year's live holidays, oldest first; this year when none is asked for. */
  list(caller: Caller, query: HolidaysQuery): Promise<HolidayView[]> {
    const year = query.year ?? businessDate(this.clock.now()).slice(0, 4);
    return inBusiness(this.database, caller, (tx) =>
      tx
        .select(COLUMNS)
        .from(shopHolidays)
        .where(
          and(
            isNull(shopHolidays.archivedAt),
            sql`${shopHolidays.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`,
          ),
        )
        .orderBy(asc(shopHolidays.date), asc(shopHolidays.id)),
    );
  }

  add(caller: Caller, input: HolidayInput): Promise<HolidayView> {
    return inBusiness(this.database, caller, async (tx) => {
      if (input.branchId !== null) {
        // A live branch of this business, locked so it can't be archived before we commit.
        const [branch] = await tx
          .select({ archivedAt: branches.archivedAt })
          .from(branches)
          .where(eq(branches.id, input.branchId))
          .for('share');
        // No such branch (undefined) or an archived one.
        if (branch?.archivedAt !== null) {
          throw new BadRequestException({ code: 'invalid_body', fields: { branchId: 'invalid' } });
        }
      }
      const [row] = await tx
        .insert(shopHolidays)
        .values({ date: input.date, name: input.name, branchId: input.branchId })
        .returning(COLUMNS);
      if (row === undefined) throw new Error('No holiday returned');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'holiday.added',
        entityType: 'holiday',
        entityId: row.id,
        ...(row.branchId !== null && { branchId: row.branchId }),
        after: { date: row.date, name: row.name, branchId: row.branchId },
      });
      return row;
    });
  }

  /** Archives a holiday: it stops counting, and stays on record. Removing it twice is harmless. */
  remove(caller: Caller, id: string, reason?: string | null): Promise<HolidayView> {
    return inBusiness(this.database, caller, async (tx) => {
      const [row] = await tx
        .select({ ...COLUMNS, archivedAt: shopHolidays.archivedAt })
        .from(shopHolidays)
        .where(eq(shopHolidays.id, id))
        .for('update');
      if (row === undefined) throw new NotFoundException({ code: 'not_found' });
      const { archivedAt, ...view } = row;
      if (archivedAt !== null) return view;
      await tx
        .update(shopHolidays)
        .set({ archivedAt: this.clock.now() })
        .where(eq(shopHolidays.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'holiday.removed',
        entityType: 'holiday',
        entityId: id,
        ...(view.branchId !== null && { branchId: view.branchId }),
        ...(reason != null && { reason }),
        before: { date: view.date, name: view.name, branchId: view.branchId },
      });
      return view;
    });
  }
}
