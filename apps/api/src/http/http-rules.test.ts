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
import { UnhandledErrorFilter } from '../error-filter.js';
import { HttpRulesModule } from './http-rules.module.js';
import { CurrentCaller, Permission, Public } from './permission.decorator.js';
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
}

const owner: Caller = {
  businessId: '0190f0f0-0000-7000-8000-0000000000b1',
  userId: '0190f0f0-0000-7000-8000-0000000000a1',
  permissions: ['settings.view', 'settings.manage'],
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

async function send(url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
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
