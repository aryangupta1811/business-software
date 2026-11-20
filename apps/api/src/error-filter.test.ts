// Over real HTTP: what a failing request sends back, and what it leaves in the logs.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { ApplicationConfig, NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { UnhandledErrorFilter } from './error-filter.js';

// What Drizzle throws for a failed query: the values after "params:", PostgreSQL's reason as
// the cause, and the offending row in the cause's `detail`.
const FAILED_QUERY = 'Failed query: insert into "customers" ("note") values ($1)';
const REASON = 'duplicate key value violates unique constraint "customers_note_unique"';

@Controller('boom')
class BoomController {
  @Get()
  boom(): never {
    throw new Error(`${FAILED_QUERY}\nparams: fake-customer-value`, {
      cause: Object.assign(new Error(REASON), {
        detail: 'Key (note)=(fake-customer-value) already exists.',
      }),
    });
  }
}

// What a query that waited past lock_timeout throws (ADR 0041): PostgreSQL's 55P03 on `cause`.
@Controller('locked')
class LockedController {
  @Get()
  locked(): never {
    throw new Error(
      `Failed query: select 1 from "item_stock" for update
params: fake-value`,
      {
        cause: Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        }),
      },
    );
  }
}

@Module({ controllers: [BoomController, LockedController] })
class BoomModule {}

function fakeLogger() {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
}

async function listen(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

describe('UnhandledErrorFilter', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // Nest's own filter logs the error object: the values, the stack and `detail`.
  it('answers a plain 500 and logs messages only, never the query values', async () => {
    const logger = fakeLogger();
    app = await NestFactory.create(BoomModule, { logger });
    app.useGlobalFilters(new UnhandledErrorFilter(app.getHttpAdapter()));
    const response = await fetch(`${await listen(app)}/boom`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ statusCode: 500, message: 'Internal Server Error' });
    // Nest's Logger passes (message, stack, context); there is no stack to pass.
    expect(logger.error.mock.calls).toEqual([
      [`Request failed: ${FAILED_QUERY} → ${REASON}`, undefined, 'Api'],
    ]);
  });

  // Another counter held the row past lock_timeout: the screen may retry (P1.8 design §7).
  it('answers 503 busy with Retry-After for a lock timeout, and warns without values', async () => {
    const logger = fakeLogger();
    app = await NestFactory.create(BoomModule, { logger });
    app.useGlobalFilters(new UnhandledErrorFilter(app.getHttpAdapter()));
    const response = await fetch(`${await listen(app)}/locked`);

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toEqual({ code: 'busy' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls).toEqual([
      [
        'Request busy: Failed query: select 1 from "item_stock" for update → canceling statement due to lock timeout',
        'Api',
      ],
    ]);
  });

  // No route of the real app fails this way yet, so this checks the wiring itself.
  it('is installed in the real app', async () => {
    app = await createApp({
      databaseUrl: 'postgresql://app_runtime:x@127.0.0.1:1/business_software',
      host: '127.0.0.1',
      port: 0,
      jsonLogs: false,
    });
    app.useLogger(false);
    const filters = app.get(ApplicationConfig).getGlobalFilters();
    expect(filters.map((filter) => filter.constructor)).toEqual([UnhandledErrorFilter]);
  });

  // Nest's own HTTP errors are answers, not failures: nothing to log.
  it("leaves Nest's own HTTP errors alone", async () => {
    const logger = fakeLogger();
    app = await NestFactory.create(BoomModule, { logger });
    app.useGlobalFilters(new UnhandledErrorFilter(app.getHttpAdapter()));
    const response = await fetch(`${await listen(app)}/no-such-route`);

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
