// Integration test on a throwaway PostgreSQL (ADR 0013): the client the api and worker use.
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

describe('createDatabase', () => {
  let server: TestDatabase;
  let admin: Pool;

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = new Pool({ connectionString: server.adminUrl });
  });

  afterAll(async () => {
    await admin.end();
    await server.stop();
  });

  async function withDatabase(test: (database: Database) => Promise<void>, onPoolError = vi.fn()) {
    const database = createDatabase(server.runtimeUrl, onPoolError);
    try {
      await test(database);
    } finally {
      await database.close();
    }
  }

  it('connects as the runtime role', async () => {
    await withDatabase(async ({ pool }) => {
      const { rows } = await pool.query<{ user: string }>('select current_user as user');
      expect(rows).toEqual([{ user: 'app_runtime' }]);
    });
  });

  // A database restart kills idle connections. pg reports that as an 'error' event on the
  // pool, and an unhandled 'error' event would crash the whole Node process.
  it('survives a database restart killing its idle connections', async () => {
    const onPoolError = vi.fn();
    await withDatabase(async ({ pool }) => {
      await pool.query('select 1');
      expect(pool.idleCount).toBe(1);

      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where usename = 'app_runtime'",
      );
      await vi.waitFor(() => {
        expect(onPoolError).toHaveBeenCalledOnce();
      });

      const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
      expect(rows).toEqual([{ ok: 1 }]);
    }, onPoolError);
  });

  // Every transaction (so every withBusiness call) checks a connection out of the pool, and
  // pg-pool handles 'error' events only on idle ones. A connection lost while checked out
  // (a database restart or failover) would be an unhandled 'error' event: a crashed process.
  it('survives the database dropping a connection in the middle of a transaction', async () => {
    await withDatabase(async ({ db, pool }) => {
      let client: PoolClient | undefined;
      pool.once('acquire', (acquired: PoolClient) => {
        client = acquired;
      });
      await expect(
        db.transaction(async (tx) => {
          await tx.execute('select 1');
          const closed = new Promise((resolve) => client?.once('end', resolve));
          await admin.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where usename = 'app_runtime'",
          );
          await closed;
          await tx.execute('select 1');
        }),
      ).rejects.toThrow();

      const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
      expect(rows).toEqual([{ ok: 1 }]);
    });
  });

  it('closes its pool', async () => {
    const database = createDatabase(server.runtimeUrl, vi.fn());
    await database.pool.query('select 1');
    await database.close();
    expect(database.pool.totalCount).toBe(0);
    await expect(database.pool.query('select 1')).rejects.toThrow();
  });
});
