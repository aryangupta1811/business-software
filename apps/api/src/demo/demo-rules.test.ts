// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: what the public demo
// shop refuses (ADR 0016's 2026-11-24 note, decision D5), one test for each refusal, and that
// the same request in an ordinary business is not refused for that reason.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeMailer } from '../mail/mailer.js';
import { Browser, FakeClock } from '../testing/browser.js';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a much newer password';

interface Shop {
  owner: Browser;
  businessId: string;
  branchId: string;
  email: string;
  recoveryKey: string;
  staffId: string;
}

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
}
type Send = (shop: Shop) => Promise<Answer>;

describe('what the demo shop refuses', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const clock = new FakeClock();
  const mailer = new FakeMailer();
  let count = 0;
  let demo: Shop;

  const browser = () => {
    count += 1;
    return new Browser(base, `203.0.113.${String(count)}`);
  };

  /** A new business: its owner logged in, and a staff record that has no login yet. */
  async function open(name: string, isDemo: boolean): Promise<Shop> {
    const owner = browser();
    const email = `${name}@example.com`;
    const signed = await owner.call('POST', '/signup', {
      businessName: `Shop ${name}`,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'regular',
      email,
      password: PASSWORD,
    });
    expect(signed.status).toBe(201);
    const { businessId, recoveryKey } = signed.body as { businessId: string; recoveryKey: string };
    await owner.session();
    const { rows } = await admin.pool.query<{ id: string }>(
      'select id from branches where business_id = $1',
      [businessId],
    );
    const branchId = rows[0]?.id ?? '';
    // A record without a login is allowed in the demo; its login, switches and password aren't.
    const staff = await owner.call('POST', '/staff', { name: 'Someone', homeBranchId: branchId });
    expect(staff.status).toBe(201);
    if (isDemo) {
      await admin.pool.query('update businesses set demo = true where id = $1', [businessId]);
    }
    return {
      owner,
      businessId,
      branchId,
      email,
      recoveryKey,
      staffId: (staff.body as { id: string }).id,
    };
  }

  const send =
    (method: string, path: (shop: Shop) => string, body: (shop: Shop) => unknown): Send =>
    (shop) =>
      shop.owner.call(method, path(shop), body(shop));
  const owner = () => ({ ownerPassword: PASSWORD });
  const newBranch = (shop: Shop, code: string) =>
    shop.owner.call('POST', '/branches', {
      name: `Branch ${code}`,
      code,
      stateCode: '27',
      address: 'Demo road, Pune',
      pinCode: '411001',
      gstin: '27ABCDE1234F1Z0',
      drugLicence: 'DL-DEMO-1',
      fssai: '12345678901234',
    });

  async function settingsBusiness(shop: Shop, change: Record<string, unknown>) {
    const read = await shop.owner.call('GET', '/settings');
    const { business } = read.body as { business: Record<string, unknown> };
    return { ...business, ...change };
  }

  const refused: [string, Send][] = [
    [
      'changing the password',
      send(
        'POST',
        () => '/password',
        () => ({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      ),
    ],
    [
      'a new recovery key',
      send(
        'POST',
        () => '/recovery-key',
        () => owner(),
      ),
    ],
    [
      'resetting the password with the recovery key',
      (shop) =>
        browser().call('POST', '/recovery/reset', {
          email: shop.email,
          recoveryKey: shop.recoveryKey,
          newPassword: NEW_PASSWORD,
        }),
    ],
    [
      'asking for the confirmation email again',
      send(
        'POST',
        () => '/email/confirm/send',
        () => undefined,
      ),
    ],
    [
      'forgetting a computer',
      async (shop) => {
        const list = await shop.owner.call('GET', '/devices');
        const [first] = list.body as unknown as { id: string }[];
        return shop.owner.call('POST', `/devices/${first?.id ?? ''}/forget`, owner());
      },
    ],
    [
      'creating a staff login',
      send(
        'POST',
        () => '/staff',
        (shop) => ({
          name: 'Cashier',
          homeBranchId: shop.branchId,
          username: 'cashier2',
          password: 'a long enough password',
          ownerPassword: PASSWORD,
        }),
      ),
    ],
    [
      'giving a record a login',
      send(
        'POST',
        (shop) => `/staff/${shop.staffId}/login`,
        () => ({ ...owner(), username: 'someone', password: 'a long enough password' }),
      ),
    ],
    [
      "changing a login's permissions",
      send(
        'PUT',
        (shop) => `/staff/${shop.staffId}/permissions`,
        () => ({ ...owner(), permissions: [], discountLimitBasisPoints: null }),
      ),
    ],
    [
      "setting a staff member's password",
      send(
        'POST',
        (shop) => `/staff/${shop.staffId}/password`,
        () => ({ ...owner(), newPassword: 'a long enough password' }),
      ),
    ],
    [
      'deactivating a login',
      send(
        'POST',
        (shop) => `/staff/${shop.staffId}/deactivate`,
        () => ({}),
      ),
    ],
    [
      'bringing a login back',
      send(
        'POST',
        (shop) => `/staff/${shop.staffId}/reactivate`,
        () => owner(),
      ),
    ],
    [
      "changing a login's branches",
      send(
        'PUT',
        (shop) => `/staff/${shop.staffId}/branches`,
        () => ({ ...owner(), branchIds: [] }),
      ),
    ],
    [
      'changing the GST status',
      async (shop) =>
        shop.owner.call(
          'PUT',
          '/settings/business',
          await settingsBusiness(shop, { gstStatus: 'composition' }),
        ),
    ],
    [
      'changing the business type',
      async (shop) =>
        shop.owner.call(
          'PUT',
          '/settings/business',
          await settingsBusiness(shop, { businessType: 'medical' }),
        ),
    ],
    [
      'changing the invoice label',
      send(
        'PUT',
        () => '/settings/invoices',
        () => ({ invoicePrefix: 'DEMO' }),
      ),
    ],
    [
      'archiving a branch',
      async (shop) => {
        const made = await newBranch(shop, 'S2');
        expect(made.status, JSON.stringify(made.body)).toBe(201);
        const { id } = made.body as { id: string };
        return shop.owner.call('POST', `/branches/${id}/archive`, owner());
      },
    ],
  ];

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { clock, mailer },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}/api`;
    demo = await open('demo', true);
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  it.each(refused)('refuses %s in the demo shop with 403 demo_refused', async (_name, request) => {
    const answer = await request(demo);
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ code: 'demo_refused' });
  });

  it("doesn't refuse any of them in an ordinary business for being a demo", async () => {
    // Each in a shop of its own: some of them log the owner out or change the password.
    for (const [name, request] of refused) {
      const answer = await request(await open(`ordinary${String(count)}`, false));
      expect(answer.body, name).not.toMatchObject({ code: 'demo_refused' });
    }
  });

  it('leaves the demo password as it was', async () => {
    const answer = await browser().call('POST', '/login', {
      email: demo.email,
      password: PASSWORD,
      // The archive test left a second branch open: the owner picks the first.
      branchId: demo.branchId,
    });
    expect(answer.status).toBe(200);
  });

  it('sends no email from the demo shop, and still answers a reset request like any other', async () => {
    const before = mailer.sent.length;
    const answer = await browser().call('POST', '/password-reset/request', { email: demo.email });
    expect(answer.status).toBe(202);
    expect(mailer.sent).toHaveLength(before);
  });

  it('still lets a visitor do everything else: a branch and the shop name', async () => {
    const made = await newBranch(demo, 'S3');
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const renamed = await demo.owner.call(
      'PUT',
      '/settings/business',
      await settingsBusiness(demo, { businessName: 'Demo Kirana Renamed' }),
    );
    expect(renamed.status).toBe(200);
  });
});
