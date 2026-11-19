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
 * Inside a `withBusiness` (or `withNewBusiness`) transaction, runs `work` as `businessId`, then
 * switches back to the transaction's own business, even if `work` fails. Both steps commit or
 * roll back together. Only for an action that spans two businesses by nature: a login in one
 * ends the browser's session in another (P1.4, ADR 0039).
 */
export async function alsoInBusiness<T>(
  tx: Transaction,
  businessId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const { rows } = await tx.execute<{ id: string | null }>(
    sql`select app_current_business_id()::text as id`,
  );
  const own = rows[0]?.id;
  if (own === undefined || own === null) throw new Error('alsoInBusiness needs a business set');
  await setBusiness(tx, businessId);
  let result: T;
  try {
    result = await work(tx);
  } catch (error) {
    // After a failed statement PostgreSQL refuses everything until rollback, the switch back
    // included; the caller must see the first error, not that one.
    await setBusiness(tx, own).catch(() => undefined);
    throw error;
  }
  await setBusiness(tx, own);
  return result;
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
