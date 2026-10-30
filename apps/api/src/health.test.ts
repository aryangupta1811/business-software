// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { DATABASE } from './database.module.js';

// Nothing listens on port 1, so connecting fails at once.
const UNREACHABLE_URL = 'postgresql://app_runtime:x@127.0.0.1:1/business_software';

async function startApp(databaseUrl: string): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await createApp({ databaseUrl, host: '127.0.0.1', port: 0, jsonLogs: false });
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${String(port)}/api` };
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

describe('health endpoints', () => {
  let server: TestDatabase;

  beforeAll(async () => {
    server = await startTestDatabase();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('with the database up', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      ({ app, baseUrl } = await startApp(server.runtimeUrl));
    });

    afterAll(async () => {
      await app.close();
    });

    it('says the process is alive', async () => {
      expect(await getJson(`${baseUrl}/health`)).toEqual({
        status: 200,
        body: { status: 'ok' },
      });
    });

    it('says it is ready when the database answers', async () => {
      expect(await getJson(`${baseUrl}/health/ready`)).toEqual({
        status: 200,
        body: { status: 'ok', database: 'ok' },
      });
    });
  });

  describe('with the database unreachable', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      ({ app, baseUrl } = await startApp(UNREACHABLE_URL));
    });

    afterAll(async () => {
      await app.close();
    });

    it('still starts and says the process is alive', async () => {
      expect((await getJson(`${baseUrl}/health`)).status).toBe(200);
    });

    it('says it is not ready', async () => {
      expect(await getJson(`${baseUrl}/health/ready`)).toEqual({
        status: 503,
        body: { status: 'error', database: 'unreachable' },
      });
    });
  });

  it('closes the database pool when the app shuts down', async () => {
    const { app, baseUrl } = await startApp(server.runtimeUrl);
    await fetch(`${baseUrl}/health/ready`);
    const { pool } = app.get<Database>(DATABASE);
    expect(pool.totalCount).toBe(1);
    await app.close();
    expect(pool.totalCount).toBe(0);
  });
});
