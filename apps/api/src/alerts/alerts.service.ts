import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  alertDismissals,
  alerts,
  and,
  branches,
  businesses,
  desc,
  eq,
  inArray,
  isNull,
  items,
  sql,
  withBusiness,
  type Database,
  type SQL,
  type Transaction,
} from '@business-software/db';
import {
  ALERT_LIST_LIMIT,
  ALERT_PERMISSIONS,
  ALERT_SEVERITY,
  ALERT_TYPES,
  type AlertList,
  type AlertType,
} from '@business-software/shared';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';

/**
 * Open alerts for the bell (P2.7 design §6). Raising and clearing happen inside the stock
 * change itself (`syncStockAlerts`); this only reads them and records who dismissed what.
 */
@Injectable()
export class AlertsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * What the caller may see and hasn't dismissed: the owner every branch, staff their
   * session's branch (`07` #2, #7); only types the caller's permissions allow (#14) and the
   * business has switched on (`07` #3). A type switched off is hidden, not dropped.
   */
  list(caller: Caller): Promise<AlertList> {
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      const types = await this.shownTypes(tx, caller);
      if (types.length === 0) return { counts: {}, total: 0, alerts: [] };
      const where = and(this.visible(caller, types), this.notDismissed(caller));
      const countRows = await tx
        .select({ type: alerts.type, count: sql<number>`count(*)::int` })
        .from(alerts)
        .where(where)
        .groupBy(alerts.type);
      const rows = await tx
        .select({
          id: alerts.id,
          type: alerts.type,
          subjectType: alerts.subjectType,
          subjectId: alerts.subjectId,
          details: alerts.details,
          raisedAt: alerts.raisedAt,
          branchId: alerts.branchId,
          branchName: branches.name,
          itemName: items.name,
          itemHindiName: items.hindiName,
          stockUnit: items.stockUnit,
        })
        .from(alerts)
        .innerJoin(branches, eq(branches.id, alerts.branchId))
        .innerJoin(items, eq(items.id, alerts.subjectId))
        .where(where)
        .orderBy(desc(alerts.updatedAt), desc(alerts.id))
        .limit(ALERT_LIST_LIMIT);
      const counts: AlertList['counts'] = {};
      for (const row of countRows) counts[row.type as AlertType] = row.count;
      return {
        counts,
        total: countRows.reduce((sum, row) => sum + row.count, 0),
        alerts: rows.map((row) => ({
          ...row,
          type: row.type as AlertType,
          subjectType: 'item' as const,
          raisedAt: row.raisedAt.toISOString(),
        })),
      };
    });
  }

  /**
   * Hides one alert for the caller only (`07` #6), at the type it has now: it shows again if
   * it gets worse (`07` #19). Dismissing again only moves that type, never makes a row.
   */
  dismiss(caller: Caller, id: string): Promise<void> {
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [alert] = await tx
        .select({ id: alerts.id, type: alerts.type })
        .from(alerts)
        .where(
          and(
            eq(alerts.id, id),
            this.visible(
              caller,
              ALERT_TYPES.filter((type) => caller.permissions.includes(ALERT_PERMISSIONS[type])),
            ),
          ),
        );
      if (alert === undefined) throw new NotFoundException({ code: 'not_found' });
      await tx
        .insert(alertDismissals)
        .values({ alertId: alert.id, userId: caller.userId, dismissedType: alert.type })
        .onConflictDoUpdate({
          target: [alertDismissals.businessId, alertDismissals.alertId, alertDismissals.userId],
          set: { dismissedType: alert.type, dismissedAt: sql`now()` },
        });
    });
  }

  /** The types the business shows in the app that this caller's permissions allow. */
  private async shownTypes(tx: Transaction, caller: Caller): Promise<AlertType[]> {
    const [business] = await tx.select({ on: businesses.alertTypes }).from(businesses);
    const on = business?.on ?? [];
    return ALERT_TYPES.filter(
      (type) => on.includes(type) && caller.permissions.includes(ALERT_PERMISSIONS[type]),
    );
  }

  /** Open, of these types, and at the caller's branch unless they are the owner. */
  private visible(caller: Caller, types: readonly AlertType[]): SQL | undefined {
    return and(
      isNull(alerts.clearedAt),
      inArray(alerts.type, [...types]),
      caller.role === 'owner' ? undefined : eq(alerts.branchId, caller.branchId),
    );
  }

  /** Not dismissed by the caller, or worse now than when they dismissed it (`07` #19). */
  private notDismissed(caller: Caller): SQL {
    return sql`not exists (select 1 from ${alertDismissals}
      where ${alertDismissals.alertId} = ${alerts.id} and ${alertDismissals.userId} = ${caller.userId}
        and ${severity(alerts.type)} <= ${severity(alertDismissals.dismissedType)})`;
  }
}

/** SQL for `ALERT_SEVERITY` of a type column, so "worse than dismissed" is one comparison. */
function severity(column: typeof alerts.type | typeof alertDismissals.dismissedType): SQL {
  const cases = ALERT_TYPES.map((type) => sql`when ${type} then ${ALERT_SEVERITY[type]}`);
  return sql`(case ${column} ${sql.join(cases, sql` `)} end)`;
}
