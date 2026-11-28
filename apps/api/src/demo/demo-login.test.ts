// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: the one-click demo login
// ("Try as the owner", "Try as a cashier") and which business it opens (ADR 0016's 2026-11-24
// note, decision D5): only the newest demo business that hasn't been archived, never an ordinary
// one, and nothing at all on a server where the demo is off.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { DEMO_CASHIER_USERNAME, DEMO_PASSWORD } from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { Browser, FakeClock } from '../testing/browser.js';
import { archiveOtherDemoBusinesses, registerDemoBusiness } from './registry.js';

const PASSWORD = 'correct horse battery';

describe('the one-click demo login', () => {
  let server: TestDatabase;
  let admin: Database;
  let runtime: Database;
  let on: INestApplication;
  let off: INestApplication;
  let onBase: string;
  let offBase: string;
  const clock = new FakeClock();
  let count = 0;

  const browser = (base: string) => {
    count += 1;
    return new Browser(base, `203.0.113.${String(count)}`);
  };

  async function listen(demoEnabled: boolean) {
    const app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false, demoEnabled },
      { clock },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    return { app, base: `http://127.0.0.1:${String(port)}/api` };
  }

  /** A business with an owner and a cashier login, as the seed makes them; flagged when asked. */
  async function shop(name: string, isDemo: boolean) {
    const owner = browser(onBase);
    const signed = await owner.call('POST', '/signup', {
      businessName: name,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'unregistered',
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`,
      password: PASSWORD,
    });
    expect(signed.status).toBe(201);
    const { businessId } = signed.body as { businessId: string };
    await owner.session();
    const { rows } = await admin.pool.query<{ id: string }>(
      'select id from branches where business_id = $1',
      [businessId],
    );
    const made = await owner.call('POST', '/staff', {
      name: 'Demo cashier',
      homeBranchId: rows[0]?.id,
      username: DEMO_CASHIER_USERNAME,
      password: DEMO_PASSWORD,
      ownerPassword: PASSWORD,
    });
    expect(made.status).toBe(201);
    if (isDemo) await registerDemoBusiness(runtime, businessId);
    return businessId;
  }

  const demoLogin = (base: string, as: string, visitor = browser(base)) =>
    visitor.call('POST', '/demo/login', { as }).then((answer) => ({ answer, visitor }));

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    runtime = createDatabase(server.runtimeUrl, () => undefined);
    ({ app: on, base: onBase } = await listen(true));
    ({ app: off, base: offBase } = await listen(false));
  });

  afterAll(async () => {
    await on.close();
    await off.close();
    await runtime.close();
    await admin.close();
    await server.stop();
  });

  it('is not offered while there is no demo business', async () => {
    const answer = await browser(onBase).call('GET', '/demo');
    expect(answer).toMatchObject({ status: 200, body: { enabled: false } });
    const login = await demoLogin(onBase, 'owner');
    expect(login.answer).toMatchObject({ status: 404, body: { code: 'demo_unavailable' } });
  });

  it('never opens an ordinary business', async () => {
    await shop('Ordinary Store', false);
    expect((await demoLogin(onBase, 'owner')).answer.status).toBe(404);
  });

  describe('with a demo business', () => {
    let first: string;

    beforeAll(async () => {
      first = await shop('Demo Kirana One', true);
    });

    it('is offered', async () => {
      expect((await browser(onBase).call('GET', '/demo')).body).toEqual({ enabled: true });
    });

    it('is off on a server that has the demo turned off, even with a demo business', async () => {
      expect((await browser(offBase).call('GET', '/demo')).body).toEqual({ enabled: false });
      const login = await demoLogin(offBase, 'owner');
      expect(login.answer).toMatchObject({ status: 404, body: { code: 'demo_unavailable' } });
    });

    it('logs the owner in with one click, and the session says it is the demo', async () => {
      const { answer, visitor } = await demoLogin(onBase, 'owner');
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({
        state: 'active',
        demo: true,
        user: { role: 'owner' },
        business: { id: first },
      });
      expect(answer.cookies.some((cookie) => cookie.startsWith('__Host-session='))).toBe(true);
      visitor.csrf = (answer.body as { csrfToken: string }).csrfToken;
      expect((await visitor.session()).body).toMatchObject({ state: 'active', demo: true });
      expect((await visitor.call('GET', '/settings')).status).toBe(200);
    });

    it('logs a cashier in with the usual staff switches only', async () => {
      const { answer, visitor } = await demoLogin(onBase, 'cashier');
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ user: { role: 'staff' }, demo: true });
      visitor.csrf = (answer.body as { csrfToken: string }).csrfToken;
      // The owner's pages stay closed to the cashier.
      expect((await visitor.call('GET', '/settings')).status).toBe(403);
      expect((await visitor.call('GET', '/billing/context')).status).toBe(200);
    });

    it('reuses the computer a browser already has, instead of adding one per click', async () => {
      const visitor = browser(onBase);
      await demoLogin(onBase, 'owner', visitor);
      const { rows: before } = await admin.pool.query<{ count: string }>(
        'select count(*) from devices where business_id = $1',
        [first],
      );
      await demoLogin(onBase, 'cashier', visitor);
      await demoLogin(onBase, 'owner', visitor);
      const { rows: after } = await admin.pool.query<{ count: string }>(
        'select count(*) from devices where business_id = $1',
        [first],
      );
      expect(after[0]?.count).toBe(before[0]?.count);
    });

    it('logs in at the head office even when a visitor opened another branch', async () => {
      const visitor = (await demoLogin(onBase, 'owner')).visitor;
      const made = await visitor.call('POST', '/branches', {
        name: 'Visitor branch',
        code: 'VB',
        stateCode: '27',
        address: null,
        pinCode: null,
        gstin: null,
        drugLicence: null,
        fssai: null,
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const next = await demoLogin(onBase, 'cashier');
      expect(next.answer.status).toBe(200);
      expect((next.answer.body as { branch: { code: string } }).branch.code).toBe('HO');
    });

    it('opens the newest demo business after a reset archives the older one', async () => {
      const second = await shop('Demo Kirana Two', true);
      expect((await demoLogin(onBase, 'owner')).answer.body).toMatchObject({
        business: { id: second },
      });
      expect(await archiveOtherDemoBusinesses(runtime, second)).toBeGreaterThan(0);
      // Archiving the new one's rival changes nothing; archiving the new one would bring none back.
      expect((await demoLogin(onBase, 'cashier')).answer.body).toMatchObject({
        business: { id: second },
      });
    });

    it('is rate limited per computer like every login', async () => {
      const visitor = browser(onBase);
      let last = 0;
      for (let i = 0; i < 40; i += 1) {
        last = (await demoLogin(onBase, 'owner', visitor)).answer.status;
        if (last === 429) break;
      }
      expect(last).toBe(429);
    });
  });
});
