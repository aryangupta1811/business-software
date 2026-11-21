// Integration test on a throwaway PostgreSQL (ADR 0013).
import type { Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from './database.module.js';
import { PING_QUEUE } from './queue.module.js';
import { createWorker } from './worker-app.js';

describe('createWorker', () => {
  let server: TestDatabase;

  beforeAll(async () => {
    server = await startTestDatabase();
  });

  afterAll(async () => {
    await server.stop();
  });

  function workerConfig() {
    return {
      ...config(),
      databaseUrl: server.runtimeUrl,
      queueDatabaseUrl: server.queueUrl,
    };
  }

  it('starts and reaches the database', async () => {
    const worker = await createWorker(workerConfig());
    const { pool } = worker.get<Database>(DATABASE);
    expect(pool.totalCount).toBe(1);
    await worker.close();
    expect(pool.totalCount).toBe(0);
  });

  // The queue end to end (P2.7): a job sent by a separate client logged in as app_queue is
  // picked up and finished by the worker.
  it('handles a job sent to its queue as app_queue', async () => {
    const worker = await createWorker(workerConfig());
    const sender = new PgBoss({ connectionString: server.queueUrl, createSchema: false });
    sender.on('error', () => undefined);
    try {
      await sender.start();
      const id = await sender.send(PING_QUEUE, { hello: 'worker' });
      expect(id).not.toBeNull();
      const job = await waitFor(async () => {
        const found = await sender.getJobById<object>(PING_QUEUE, id ?? '');
        return found?.state === 'completed' ? found : undefined;
      });
      expect(job.output).toEqual({ pong: { hello: 'worker' } });
    } finally {
      await sender.stop();
      await worker.close();
    }
  });

  // A second worker (a rolling restart on the server) must not fail on queues that exist.
  it('starts twice against the same queue schema', async () => {
    const first = await createWorker(workerConfig());
    const second = await createWorker(workerConfig());
    await second.close();
    await first.close();
  });

  // Found in review: a failed startup check crashed the worker, and Docker restarted it in a
  // loop while the api waited calmly. The business pool's check only warns.
  it('still starts when the business database is unreachable', async () => {
    const worker = await createWorker({
      ...workerConfig(),
      databaseUrl: 'postgresql://app_runtime:x@127.0.0.1:1/business_software',
    });
    await worker.close();
  });

  // Without its queue the worker would sit there doing nothing, so this one is fatal: the
  // process exits and Docker restarts it (after retrying for a while, see createWorker).
  it('fails, without leaving anything open, when the queue database is unreachable', async () => {
    await expect(
      createWorker(
        {
          ...workerConfig(),
          queueDatabaseUrl: 'postgresql://app_queue:x@127.0.0.1:1/business_software',
        },
        { queueStartAttempts: 1 },
      ),
    ).rejects.toThrow();
  });
});

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the job');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function config() {
  return { databaseUrl: '', host: '127.0.0.1', port: 0, jsonLogs: false };
}
