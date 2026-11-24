// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: customers at the billing
// counter (P1.13 design §7, §14; `02` #2, #7).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { PERMISSIONS, type CustomerView, type Permission } from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashToken } from '../auth/tokens.js';
import type { Caller, SessionResolver } from '../http/session.js';

const CSRF = 'csrf-token-for-tests';
const headerSessions: SessionResolver = {
  resolve(request: IncomingMessage) {
    const header = request.headers['x-test-caller'];
    return Promise.resolve(typeof header === 'string' ? (JSON.parse(header) as Caller) : null);
  },
  recordActivity: () => Promise.resolve(),
};

type Body = Record<string, unknown>;

const GSTIN = '27ABCDE1234F1Z0';
const walkIn = {
  name: 'Sunita',
  phone: null,
  gstin: null,
  legalName: null,
  address: null,
  pinCode: null,
  stateCode: null,
};

describe('customers', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  let a: Caller;
  let b: Caller;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed fetch helper
  async function call<T = Body>(
    method: string,
    path: string,
    caller: Caller | null,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': CSRF,
        ...(caller && { 'x-test-caller': JSON.stringify(caller) }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function owner(name: string, email: string): Promise<Caller> {
    const created = await call('POST', '/signup', null, {
      businessName: name,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'regular',
      email,
      password: 'correct horse battery',
    });
    const { businessId } = created.body as { businessId: string };
    const { rows } = await admin.pool.query<{ id: string; branch_id: string }>(
      `select u.id, b.id as branch_id from users u join branches b using (business_id)
        where u.business_id = $1 and u.role = 'owner'`,
      [businessId],
    );
    return {
      businessId,
      userId: rows[0]?.id ?? '',
      sessionId: '0190f0f0-0000-7000-8000-0000000000c1',
      branchId: rows[0]?.branch_id ?? '',
      role: 'owner',
      permissions: PERMISSIONS,
      locked: false,
      csrfHash: hashToken(CSRF),
    };
  }

  const staff = (caller: Caller, permissions: Permission[]): Caller => ({ ...caller, permissions });

  const add = (caller: Caller, body: Body) =>
    call<CustomerView>('POST', '/customers', caller, { ...walkIn, ...body });

  const find = (caller: Caller, query: string) =>
    call<CustomerView[]>('GET', `/customers?${query}`, caller);

  const entries = async (entityId: string) =>
    (
      await admin.pool.query<{ action: string; actor_id: string; before: Body; after: Body }>(
        'select action, actor_id, before, after from entry_log where entity_id = $1 order by id',
        [entityId],
      )
    ).rows;

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { sessions: headerSessions },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}/api`;
    a = await owner('Shop A', 'customers-a@example.com');
    b = await owner('Shop B', 'customers-b@example.com');
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  it('adds a business customer, with the phone normalised and the state from the GSTIN', async () => {
    const response = await add(a, {
      name: 'Ravi',
      phone: '+91 98200 12345',
      gstin: GSTIN.toLowerCase(),
      legalName: 'Ravi Traders',
      address: '12 MG Road, Pune',
      pinCode: '411001',
    });
    expect(response).toEqual({
      status: 201,
      body: {
        id: expect.any(String) as unknown,
        name: 'Ravi',
        phone: '9820012345',
        gstin: GSTIN,
        legalName: 'Ravi Traders',
        address: '12 MG Road, Pune',
        pinCode: '411001',
        stateCode: '27',
        creditLimitPaise: null,
        dueDays: 30,
        version: 1,
      },
    });
    expect(await entries(response.body.id)).toEqual([
      {
        action: 'customer.created',
        actor_id: a.userId,
        before: null,
        after: expect.objectContaining({
          name: 'Ravi',
          phone: '9820012345',
          gstin: GSTIN,
        }) as unknown,
      },
    ]);
  });

  it('finds a customer by phone in any spelling, and by part of a name, phone or GSTIN', async () => {
    const meena = (await add(a, { name: 'Meena Stores', phone: '9820099999' })).body;
    expect((await find(a, 'phone=098200%2099999')).body).toEqual([meena]);
    expect((await find(a, 'q=meena')).body).toEqual([meena]);
    expect((await find(a, 'q=20099')).body).toEqual([meena]);
    expect((await find(a, 'phone=9000000000')).body).toEqual([]);
  });

  it('treats % and _ in the search as letters, not wildcards', async () => {
    await add(a, { name: '50% Off Corner' });
    expect((await find(a, 'q=%25')).body.map((c) => c.name)).toEqual(['50% Off Corner']);
    expect((await find(a, 'q=_')).body).toEqual([]);
  });

  it('refuses a search with nothing to search for', async () => {
    expect((await find(a, '')).status).toBe(400);
  });

  it('refuses a second live customer with the same phone or GSTIN in one business', async () => {
    await add(a, { name: 'First', phone: '9820077777' });
    expect(await add(a, { name: 'Second', phone: '9820077777' })).toEqual({
      status: 409,
      body: { code: 'phone_taken' },
    });
    const b2b = { legalName: 'X Traders', address: 'Pune', gstin: '29ABCDE1234F1ZW' };
    expect((await add(a, { name: 'X', ...b2b })).status).toBe(201);
    expect(await add(a, { name: 'Y', ...b2b })).toEqual({
      status: 409,
      body: { code: 'gstin_taken' },
    });
    // Another business has its own customers.
    expect((await add(b, { name: 'First', phone: '9820077777' })).status).toBe(201);
  });

  it('edits a customer from the version it read, logs what changed, and refuses a stale copy', async () => {
    const added = (await add(a, { name: 'Lata', phone: '9820055555' })).body;
    const { version } = added;
    const fields = editable(added);
    const saved = await call<CustomerView>('PUT', `/customers/${added.id}`, a, {
      ...fields,
      name: 'Lata Devi',
      version,
    });
    expect(saved).toEqual({ status: 200, body: { ...added, name: 'Lata Devi', version: 2 } });
    expect((await entries(added.id)).at(-1)).toEqual({
      action: 'customer.updated',
      actor_id: a.userId,
      before: { name: 'Lata' },
      after: { name: 'Lata Devi' },
    });

    const stale = await call('PUT', `/customers/${added.id}`, a, { ...fields, version: 1 });
    expect(stale).toEqual({ status: 409, body: { code: 'stale' } });

    // Saving with nothing changed keeps the version and logs nothing.
    const same = await call<CustomerView>('PUT', `/customers/${added.id}`, a, {
      ...fields,
      name: 'Lata Devi',
      version: 2,
    });
    expect(same.body.version).toBe(2);
    expect(await entries(added.id)).toHaveLength(2);
  });

  it("can't see or edit another business's customer", async () => {
    const theirs = (await add(b, { name: 'Hidden', phone: '9820033333' })).body;
    expect((await find(a, 'phone=9820033333')).body).toEqual([]);
    const body = { ...editable(theirs), version: theirs.version };
    expect((await call('PUT', `/customers/${theirs.id}`, a, body)).status).toBe(404);
  });

  it('needs customers.view to find and customers.manage to add or edit', async () => {
    const cashier = staff(a, ['session.own', 'billing.sell', 'customers.view']);
    expect((await find(cashier, 'q=a')).status).toBe(200);
    expect((await add(cashier, { name: 'Nope' })).status).toBe(403);
    expect((await find(staff(a, ['session.own', 'billing.sell']), 'q=a')).status).toBe(403);
  });
});

/** A customer as `PUT /customers/:id` takes it, without its version. */
function editable(view: CustomerView): Body {
  const body: Body = { ...view };
  delete body.id;
  delete body.version;
  return body;
}
