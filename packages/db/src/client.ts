import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface Database {
  db: NodePgDatabase;
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
  return { db: drizzle(pool), pool, close: () => pool.end() };
}
