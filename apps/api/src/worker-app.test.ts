// Integration test on a throwaway PostgreSQL (ADR 0013).
import type { Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from './database.module.js';
import { createWorker } from './worker-app.js';

describe('createWorker', () => {
  let server: TestDatabase;

  beforeAll(async () => {
    server = await startTestDatabase();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('starts and reaches the database', async () => {
    const worker = await createWorker({ ...config(), databaseUrl: server.runtimeUrl });
    const { pool } = worker.get<Database>(DATABASE);
    expect(pool.totalCount).toBe(1);
    await worker.close();
    expect(pool.totalCount).toBe(0);
  });

  // Found in review: a failed startup check crashed the worker, and Docker restarted it in a
  // loop while the api waited calmly. A server booting before its database is normal.
  it('still starts when the database is unreachable', async () => {
    const worker = await createWorker({
      ...config(),
      databaseUrl: 'postgresql://app_runtime:x@127.0.0.1:1/business_software',
    });
    await worker.close();
  });
});

function config() {
  return { databaseUrl: '', host: '127.0.0.1', port: 0, jsonLogs: false };
}
