// The only way the app reads or writes business data (ADRs 0006, 0027). Outside these
// functions a tenant table shows no rows and refuses inserts.
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AppDatabase } from './client.js';

export type Transaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

// `true` makes the setting transaction-local, so a pooled connection can't carry it into the
// next request. The ::uuid cast refuses a malformed ID here, before any work runs.
async function setBusiness(tx: Transaction, businessId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.business_id', ${businessId}::uuid::text, true)`);
}

/** Runs `work` in one transaction that can see and write only `businessId`'s rows. */
export function withBusiness<T>(
  db: AppDatabase,
  businessId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setBusiness(tx, businessId);
    return work(tx);
  });
}

/**
 * For signup: picks the new business's ID and sets it before anything is inserted, so the
 * `businesses` row passes its own policy with no bypass. `work` inserts that row.
 */
export function withNewBusiness<T>(
  db: AppDatabase,
  work: (tx: Transaction, businessId: string) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`);
    const businessId = rows[0]?.id;
    if (businessId === undefined) throw new Error('uuidv7() returned no row');
    await setBusiness(tx, businessId);
    return work(tx, businessId);
  });
}
