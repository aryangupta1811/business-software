// Which business is the public demo (ADR 0016's 2026-11-24 note). The list lives in schema auth,
// out of app_runtime's reach, behind three database functions (migration 0022): the demo buttons
// work before any business is known, and under row-level security that is the only way to ask.
import { businesses, eq, sql, withBusiness, type Database } from '@business-software/db';

export interface DemoBusiness {
  businessId: string;
  /** When the registry row was made (database time): what the weekly reset measures. */
  createdAt: Date;
}

/** The newest demo business that hasn't been archived, if any. */
export async function findDemoBusiness(database: Database): Promise<DemoBusiness | undefined> {
  const { rows } = await database.db.execute<{ business_id: string; created_at: Date | string }>(
    sql`select business_id, created_at from app_find_demo_business()`,
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : { businessId: row.business_id, createdAt: new Date(row.created_at) };
}

/**
 * Flags a finished demo shop as the demo and puts it on the list, in one transaction. The seed
 * calls it last, so a seed that stops half way leaves an ordinary business nobody can reach by
 * a click, not a half-filled demo.
 */
export async function registerDemoBusiness(database: Database, businessId: string): Promise<void> {
  await withBusiness(database.db, businessId, async (tx) => {
    await tx.update(businesses).set({ demo: true }).where(eq(businesses.id, businessId));
    await tx.execute(sql`select app_register_demo_business()`);
  });
}

/** A reset's last step: every demo but `keep` is hidden from the buttons. Nothing is deleted. */
export async function archiveOtherDemoBusinesses(
  database: Database,
  keep: string,
): Promise<number> {
  const { rows } = await database.db.execute<{ archived: number }>(
    sql`select app_archive_demo_businesses(${keep}) as archived`,
  );
  return rows[0]?.archived ?? 0;
}
