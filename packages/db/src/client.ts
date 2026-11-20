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

/** PostgreSQL's limits on waiting, per connection (ADR 0041). */
export interface DatabaseTimeouts {
  /** Waiting for another transaction's lock (another counter's bill). */
  lockTimeoutMs: number;
  /** Any one statement. */
  statementTimeoutMs: number;
  /** A transaction left open with nothing running: ended, and its locks released. */
  idleInTransactionTimeoutMs: number;
}

/**
 * The app's values (P1.8 design §7, ADR 0041). A bill saves in under a second (NFR 5), so a
 * 3 s wait for a lock means something is stuck: the counter gets `503 busy` and retries.
 */
export const APP_TIMEOUTS: DatabaseTimeouts = {
  lockTimeoutMs: 3_000,
  statementTimeoutMs: 10_000,
  idleInTransactionTimeoutMs: 15_000,
};

/**
 * Opens the app's connection pool. `url` logs in as the runtime role (app_runtime).
 *
 * `onPoolError` is required: pg reports a dropped idle connection (say, a database restart)
 * as an 'error' event, and Node crashes the whole process on an unhandled one.
 *
 * The timeouts travel in each connection's start-up message, so they hold before the first
 * query and need no setting on the role (which would take a hand-run step on RDS).
 * Migrations use their own pool without them (`runMigrations`).
 */
export function createDatabase(
  url: string,
  onPoolError: (error: Error) => void,
  timeouts: DatabaseTimeouts = APP_TIMEOUTS,
): Database {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5_000,
    lock_timeout: timeouts.lockTimeoutMs,
    statement_timeout: timeouts.statementTimeoutMs,
    idle_in_transaction_session_timeout: timeouts.idleInTransactionTimeoutMs,
  });
  pool.on('error', onPoolError);
  // pg-pool listens for 'error' on a connection only while it sits idle. One that is lost
  // while checked out (every transaction checks one out) would emit an unhandled 'error' too.
  // This listener hides nothing: the transaction's next query rejects with the reason.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  return { db: drizzle(pool), pool, close: () => pool.end() };
}
