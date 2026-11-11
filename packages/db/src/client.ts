import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * Drizzle over a pool. The `$client` part is what a transaction lacks, so `withBusiness` can't be
 * handed a transaction by mistake (ADR 0027).
 */
export type AppDatabase = NodePgDatabase & { $client: Pool };

export interface Database {
  db: AppDatabase;
  pool: Pool;
  close(): Promise<void>;
}

/**
 * Opens the app's connection pool. `url` logs in as the runtime role (app_runtime).
 *
 * `onPoolError` is required: pg reports a dropped idle connection (say, a database restart)
 * as an 'error' event, and Node crashes the whole process on an unhandled one.
 */
export function createDatabase(url: string, onPoolError: (error: Error) => void): Database {
  const pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000 });
  pool.on('error', onPoolError);
  // pg-pool listens for 'error' on a connection only while it sits idle. One that is lost
  // while checked out (every transaction checks one out) would emit an unhandled 'error' too.
  // This listener hides nothing: the transaction's next query rejects with the reason.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  return { db: drizzle(pool), pool, close: () => pool.end() };
}
