// The request rules every route follows (ADR 0036), tested over real HTTP on a test-only
// controller: bodies pass a shared Zod schema, and routes are public or name a permission.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import 'reflect-metadata';
import { Body, Controller, Get, Module, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { text } from '@business-software/shared';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../auth/tokens.js';
import { UnhandledErrorFilter } from '../error-filter.js';
import { HttpRulesModule } from './http-rules.module.js';
import { AllowLocked, CurrentCaller, Permission, Public } from './permission.decorator.js';
import type { Caller, SessionResolver } from './session.js';
import { ZodBodyPipe } from './zod-body.pipe.js';

const echoSchema = z.strictObject({ name: text(5) });

@Controller('t')
class TestController {
  @Public()
  @Post('echo')
  echo(@Body(new ZodBodyPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }

  @Permission('settings.view')
  @Get('who')
  who(@CurrentCaller() caller: Caller) {
    return { userId: caller.userId };
  }

  @Get('forgot')
  forgot() {
    return { reached: true };
  }

  @Permission('settings.manage')
  @Post('write')
  write() {
    return { written: true };
  }

  @Permission('settings.view')
  @AllowLocked()
  @Post('unlockish')
  unlockish() {
    return { reached: true };
  }
}

const CSRF = 'csrf-token-for-tests';

const owner: Caller = {
  businessId: '0190f0f0-0000-7000-8000-0000000000b1',
  userId: '0190f0f0-0000-7000-8000-0000000000a1',
  sessionId: '0190f0f0-0000-7000-8000-0000000000c1',
  branchId: '0190f0f0-0000-7000-8000-0000000000d1',
  role: 'owner',
  permissions: ['settings.view', 'settings.manage'],
  locked: false,
  csrfHash: hashToken(CSRF),
};

async function start(resolver?: SessionResolver): Promise<{ app: INestApplication; url: string }> {
  @Module({ imports: [HttpRulesModule.register(resolver)], controllers: [TestController] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(new UnhandledErrorFilter(app.getHttpAdapter()));
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(port)}/t` };
}

async function send(
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

describe('request rules', () => {
  describe('with no session (until P1.4)', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => {
      ({ app, url } = await start());
    });

    afterAll(async () => {
      await app.close();
    });

    it('lets a public route through with a parsed body', async () => {
      expect(await send(`${url}/echo`, { name: '  Ab ' })).toEqual({
        status: 201,
        body: { name: 'Ab' },
      });
    });

    it.each([
      [{ name: 'abcdef' }, { name: 'too_long' }],
      [{ name: 'a\u0000b' }, { name: 'control_character' }],
      [{ name: 'Ab', admin: true }, { admin: 'unknown_field' }],
      [{}, { name: 'required' }],
      [[1, 2], { _: 'invalid' }],
    ])('answers 400 with codes for %j', async (body, fields) => {
      expect(await send(`${url}/echo`, body)).toEqual({
        status: 400,
        body: { code: 'invalid_body', fields },
      });
    });

    // A NUL that PostgreSQL would refuse must never get that far (a 500 before P1.3).
    it('refuses a NUL written as a JSON escape', async () => {
      const response = await send(`${url}/echo`, '{"name":"a\\u0000"}');
      expect(response.status).toBe(400);
    });

    it('answers 401 on a route that needs a permission', async () => {
      expect(await send(`${url}/who`)).toEqual({ status: 401, body: { code: 'not_logged_in' } });
    });

    it('refuses a route that names no permission', async () => {
      expect((await send(`${url}/forgot`)).status).toBe(500);
    });
  });

  describe('with a session', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => {
      ({ app, url } = await start({ resolve: () => Promise.resolve(owner) }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('passes the caller to the handler', async () => {
      expect(await send(`${url}/who`)).toEqual({ status: 200, body: { userId: owner.userId } });
    });

    // ADR 0009: every unsafe request from a session carries its CSRF token.
    it.each([
      ['no token', {}],
      ['a wrong token', { 'x-csrf-token': 'guess' }],
    ])('refuses a write with %s', async (_, headers) => {
      expect(await send(`${url}/write`, {}, headers)).toEqual({
        status: 403,
        body: { code: 'csrf' },
      });
    });

    it("accepts a write with the session's token", async () => {
      expect(await send(`${url}/write`, {}, { 'x-csrf-token': CSRF })).toEqual({
        status: 201,
        body: { written: true },
      });
    });
  });

  // Another site's page making the browser post here, public routes included (login CSRF).
  describe('cross-site requests', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => {
      ({ app, url } = await start({ resolve: () => Promise.resolve(owner) }));
    });

    afterAll(async () => {
      await app.close();
    });

    it.each([
      [{ 'sec-fetch-site': 'cross-site' }],
      [{ 'sec-fetch-site': 'same-site' }],
      [{ origin: 'https://evil.example' }],
      [{ origin: 'null' }],
    ])('refuses %j', async (headers) => {
      expect(await send(`${url}/echo`, { name: 'Ab' }, headers)).toEqual({
        status: 403,
        body: { code: 'cross_site' },
      });
    });

    it('accepts a same-origin page, a typed address and a matching Origin', async () => {
      const host = new URL(url).host;
      for (const headers of [
        { 'sec-fetch-site': 'same-origin' },
        { 'sec-fetch-site': 'none' },
        { origin: `http://${host}` },
      ]) {
        expect((await send(`${url}/echo`, { name: 'Ab' }, headers)).status).toBe(201);
      }
    });

    it('lets reads through from anywhere (CORS keeps their answers from other sites)', async () => {
      expect((await send(`${url}/who`, undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(
        200,
      );
    });
  });

  // Module 00 #21: a locked owner session reaches only unlock and logout.
  describe('with a locked session', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => {
      ({ app, url } = await start({ resolve: () => Promise.resolve({ ...owner, locked: true }) }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 401 locked on an ordinary route', async () => {
      expect(await send(`${url}/who`)).toEqual({ status: 401, body: { code: 'locked' } });
    });

    it('reaches a route marked @AllowLocked()', async () => {
      expect(await send(`${url}/unlockish`, {}, { 'x-csrf-token': CSRF })).toEqual({
        status: 201,
        body: { reached: true },
      });
    });
  });

  describe('with a caller who lacks the permission', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => {
      ({ app, url } = await start({
        resolve: () => Promise.resolve({ ...owner, permissions: [] }),
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 403', async () => {
      expect(await send(`${url}/who`)).toEqual({ status: 403, body: { code: 'forbidden' } });
    });
  });
});
