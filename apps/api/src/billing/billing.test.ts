// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: the billing counter's
// copy of the catalogue and its sync (P1.13, design §4, ADR 0043).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  PERMISSIONS,
  type ApprovalView,
  type BillingContext,
  type CatalogueItem,
  type CatalogueView,
  type HeldBillView,
  type ItemView,
  type Permission,
} from '@business-software/shared';
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

describe('billing counter', () => {
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

  async function item(caller: Caller, overrides: Body = {}): Promise<ItemView> {
    const response = await call<ItemView>('POST', '/items', caller, {
      kind: 'goods',
      name: `Item ${crypto.randomUUID().slice(0, 8)}`,
      hindiName: null,
      code: null,
      categoryId: null,
      brand: null,
      stockUnit: 'kg',
      sellingPrice: 12_000,
      wholesalePrice: 11_000,
      purchasePrice: 9_000,
      mrp: null,
      priceIncludesTax: true,
      gstRate: 500,
      hsn: '1006',
      packs: [],
      levels: [],
      barcodes: [],
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  const catalogue = (caller: Caller, since?: string) =>
    call<CatalogueView>(
      'GET',
      `/billing/catalogue${since === undefined ? '' : `?since=${encodeURIComponent(since)}`}`,
      caller,
    );

  const entryOf = (view: CatalogueView, id: string) => view.items.find((entry) => entry.id === id);

  const minuteBefore = (iso: string) => new Date(Date.parse(iso) - 60_000).toISOString();

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
    a = await owner('Shop A', 'billing-a@example.com');
    b = await owner('Shop B', 'billing-b@example.com');
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  it('sends a live item with its packs and barcodes, and never the purchase price', async () => {
    const rice = await item(a, {
      name: 'Basmati Rice',
      hindiName: 'बासमती चावल',
      code: 'R12',
      packs: [
        {
          id: null,
          unitCode: 'bag',
          unitId: null,
          size: 25_000,
          sellingPrice: 280_000,
          mrp: null,
          soldAsPack: true,
          boughtAsPack: true,
        },
      ],
      barcodes: ['8901234567890'],
    });
    const { status, body } = await catalogue(a);
    expect(status).toBe(200);
    const bagId = rice.packs[0]?.id ?? '';
    expect(entryOf(body, rice.id)).toEqual({
      id: rice.id,
      archived: false,
      kind: 'goods',
      name: 'Basmati Rice',
      hindiName: 'बासमती चावल',
      code: 'R12',
      stockUnit: 'kg',
      sellingPrice: 12_000,
      wholesalePrice: 11_000,
      mrp: null,
      priceIncludesTax: true,
      gstRate: 500,
      hsn: '1006',
      version: 1,
      packs: [
        {
          id: bagId,
          unitCode: 'bag',
          unitName: null,
          size: 25_000,
          sellingPrice: 280_000,
          mrp: null,
          soldAsPack: true,
        },
      ],
      barcodes: [{ code: '8901234567890', packId: null }],
    } satisfies CatalogueItem);
    expect(JSON.stringify(body)).not.toMatch(/purchase|cost/i);
    expect(Date.parse(body.serverTime)).not.toBeNaN();
  });

  it("sends an archived item slim, so a scan of its code can say it's archived", async () => {
    const old = await item(a, { barcodes: ['ARCHIVED-1'] });
    expect((await call('POST', `/items/${old.id}/archive`, a)).status).toBe(200);
    const { body } = await catalogue(a);
    expect(entryOf(body, old.id)).toEqual({
      id: old.id,
      archived: true,
      name: old.name,
      barcodes: [{ code: 'ARCHIVED-1', packId: null }],
    });
  });

  it("sends stock at the caller's branch only to callers with stock.view", async () => {
    const level = { branchId: a.branchId, lowStockLevel: 5_000 };
    const salt = await item(a, { stockUnit: 'piece', levels: [level] });
    const opened = await call('POST', `/items/${salt.id}/stock/opening`, a, {
      quantity: 12_000,
      requestKey: crypto.randomUUID(),
    });
    expect(opened.status).toBe(201);

    const withStock = (await catalogue(a)).body;
    expect(withStock.stock?.find((row) => row.itemId === salt.id)).toEqual({
      itemId: salt.id,
      quantity: 12_000,
      lowStockLevel: 5_000,
    });

    const cashier = (await catalogue(staff(a, ['session.own', 'billing.sell']))).body;
    expect(cashier.stock).toBeNull();
    expect(entryOf(cashier, salt.id)).toBeDefined();
  });

  it('sends only what changed since the time asked for', async () => {
    const before = await item(a);
    const first = (await catalogue(a)).body;
    const changed = await item(a);
    const update = await call<ItemView>('PUT', `/items/${before.id}`, a, {
      ...withoutViewFields(before),
      sellingPrice: 12_500,
    });
    expect(update.status).toBe(200);

    const { body } = await catalogue(a, minuteBefore(first.serverTime));
    expect(entryOf(body, changed.id)).toBeDefined();
    expect(entryOf(body, before.id)).toMatchObject({ sellingPrice: 12_500, version: 2 });

    // Nothing changed after this sync: an exact-time sync finds nothing new.
    const later = (await catalogue(a, (await catalogue(a)).body.serverTime)).body;
    expect(later.items).toEqual([]);
  });

  it('picks up a change stamped before the last sync but committed after it (the overlap)', async () => {
    const slow = await item(a, { name: 'Slow edit' });
    const client = await admin.pool.connect();
    let synced: CatalogueView;
    try {
      // Another counter's save: stamped now, committed only after this counter syncs.
      await client.query('begin');
      await client.query(
        `update items set name = 'Slow edit, saved', version = version + 1, updated_at = now()
          where id = $1`,
        [slow.id],
      );
      synced = (await catalogue(a)).body;
      expect(entryOf(synced, slow.id)).toMatchObject({ name: 'Slow edit' });
      await client.query('commit');
    } finally {
      client.release();
    }
    // Asking from the exact time would miss it; asking from a minute earlier finds it.
    expect(entryOf((await catalogue(a, synced.serverTime)).body, slow.id)).toBeUndefined();
    expect(
      entryOf((await catalogue(a, minuteBefore(synced.serverTime))).body, slow.id),
    ).toMatchObject({ name: 'Slow edit, saved', version: 2 });
  });

  it("never sends another business's items", async () => {
    const theirs = await item(b);
    expect(entryOf((await catalogue(a)).body, theirs.id)).toBeUndefined();
    expect(entryOf((await catalogue(b)).body, theirs.id)).toBeDefined();
  });

  it('needs billing.sell, and refuses a since that is not a time', async () => {
    expect((await catalogue(staff(a, ['session.own', 'items.view']))).status).toBe(403);
    expect((await catalogue(a, 'yesterday')).status).toBe(400);
  });

  // ---- The counter's context ----

  it("sends the scheme, the branch's state and what the caller may do", async () => {
    expect(await call<BillingContext>('GET', '/billing/context', a)).toEqual({
      status: 200,
      body: {
        scheme: 'regular',
        branchStateCode: '27',
        features: expect.any(Array) as unknown,
        negativeStock: 'warn',
        canViewStock: true,
        canManageItems: true,
        canViewCustomers: true,
        canManageCustomers: true,
        canDiscount: true,
      },
    });
    const cashier = staff(a, ['session.own', 'billing.sell']);
    expect((await call<BillingContext>('GET', '/billing/context', cashier)).body).toMatchObject({
      canViewStock: false,
      canManageItems: false,
      canViewCustomers: false,
      canManageCustomers: false,
      canDiscount: false,
    });
    expect((await call('GET', '/billing/context', staff(a, ['session.own']))).status).toBe(403);
  });

  // ---- Held bills (design §9) ----

  const cart = (overrides: Body = {}) => ({
    billKey: crypto.randomUUID(),
    priceList: 'retail',
    customerId: null,
    placeOfSupplyStateCode: '27',
    lines: [
      {
        itemId: crypto.randomUUID(),
        packId: null,
        quantityThousandths: 2_000,
        shownUnitPricePaise: 2_800,
      },
    ],
    ...overrides,
  });

  const hold = (caller: Caller, draft = cart(), label: string | null = null) =>
    call<HeldBillView>('POST', '/held-bills', caller, { label, draft, shownTotalPaise: 5_600 });

  const heldList = async (caller: Caller) =>
    (await call<HeldBillView[]>('GET', '/held-bills', caller)).body;

  const logOf = async (action: string, entityId: string) =>
    (
      await admin.pool.query<{ actor_id: string; branch_id: string | null; after: Body }>(
        'select actor_id, branch_id, after from entry_log where action = $1 and entity_id = $2',
        [action, entityId],
      )
    ).rows;

  it('holds a bill, lists it for the branch, and resumes it once', async () => {
    const draft = cart();
    const held = await hold(a, draft, 'blue shirt uncle');
    expect(held).toEqual({
      status: 201,
      body: {
        id: expect.any(String) as unknown,
        label: 'blue shirt uncle',
        lineCount: 1,
        totalPaise: 5_600,
        heldBy: { id: a.userId, name: 'billing-a@example.com' },
        heldAt: expect.any(String) as unknown,
      },
    });
    expect((await heldList(a)).map((bill) => bill.id)).toContain(held.body.id);

    const resumed = await call('POST', `/held-bills/${held.body.id}/resume`, a);
    expect(resumed).toEqual({ status: 200, body: { draft } });
    expect((await heldList(a)).map((bill) => bill.id)).not.toContain(held.body.id);
    expect(await call('POST', `/held-bills/${held.body.id}/resume`, a)).toEqual({
      status: 409,
      body: { code: 'held_bill_closed' },
    });
  });

  it('answers a retried hold with the first copy', async () => {
    const draft = cart();
    const first = await hold(a, draft);
    const again = await hold(a, draft);
    expect(again).toEqual({ status: 201, body: first.body });
  });

  it('lists newest first and never shows another branch or business', async () => {
    const older = await hold(a);
    const newer = await hold(a);
    const ids = (await heldList(a)).map((bill) => bill.id);
    expect(ids.indexOf(newer.body.id)).toBeLessThan(ids.indexOf(older.body.id));
    expect((await heldList(b)).map((bill) => bill.id)).not.toContain(newer.body.id);
    expect((await call('POST', `/held-bills/${newer.body.id}/resume`, b)).status).toBe(404);
  });

  it('discards a held bill and logs it with its lines and total (question 7)', async () => {
    const draft = cart();
    const held = await hold(a, draft, 'gone');
    const response = await call('POST', `/held-bills/${held.body.id}/discard`, a);
    expect(response).toEqual({ status: 200, body: { billKey: draft.billKey } });
    expect(await logOf('bill.draft_discarded', draft.billKey)).toEqual([
      {
        actor_id: a.userId,
        branch_id: a.branchId,
        after: {
          heldBillId: held.body.id,
          label: 'gone',
          lines: draft.lines,
          lineCount: 1,
          totalPaise: 5_600,
        },
      },
    ]);
    expect((await call('POST', `/held-bills/${held.body.id}/discard`, a)).status).toBe(409);
  });

  it('logs an open bill cleared without saving (Alt+N, question 7)', async () => {
    const draft = cart();
    const response = await call('POST', '/billing/discard', a, { draft, shownTotalPaise: 5_600 });
    expect(response).toEqual({ status: 200, body: { billKey: draft.billKey } });
    expect(await logOf('bill.draft_discarded', draft.billKey)).toEqual([
      {
        actor_id: a.userId,
        branch_id: a.branchId,
        after: {
          heldBillId: null,
          label: null,
          lines: draft.lines,
          lineCount: 1,
          totalPaise: 5_600,
        },
      },
    ]);
  });

  it('refuses a held bill with payments in it', async () => {
    const response = await call('POST', '/held-bills', a, {
      label: null,
      draft: { ...cart(), payments: [] },
      shownTotalPaise: 0,
    });
    expect(response.status).toBe(400);
  });

  // ---- Owner approvals (design §6, question 5) ----

  const approve = (caller: Caller, overrides: Body = {}) =>
    call<ApprovalView>('POST', '/billing/approvals', caller, {
      billKey: crypto.randomUUID(),
      kind: 'discount',
      lineBasisPoints: 1_500,
      billBasisPoints: 500,
      ownerPassword: 'correct horse battery',
      ...overrides,
    });

  it("stores the owner's OK for 30 minutes and logs it, for a cashier at the counter", async () => {
    const cashier = staff(a, ['session.own', 'billing.sell']);
    const billKey = crypto.randomUUID();
    const before = Date.now();
    const response = await approve(cashier, { billKey });
    expect(response.status).toBe(201);
    const expires = Date.parse(response.body.expiresAt);
    expect(expires - before).toBeGreaterThanOrEqual(30 * 60_000 - 1_000);
    expect(expires - Date.now()).toBeLessThanOrEqual(30 * 60_000);

    const { rows } = await admin.pool.query<Body>(
      `select bill_key, kind, line_basis_points, bill_basis_points, requested_by, approved_by,
              used_at from owner_approvals where id = $1`,
      [response.body.approvalId],
    );
    expect(rows).toEqual([
      {
        bill_key: billKey,
        kind: 'discount',
        line_basis_points: 1_500,
        bill_basis_points: 500,
        requested_by: a.userId,
        approved_by: a.userId,
        used_at: null,
      },
    ]);
    expect(await logOf('discount.approved', response.body.approvalId)).toEqual([
      {
        actor_id: a.userId,
        branch_id: a.branchId,
        after: {
          billKey,
          kind: 'discount',
          lineBasisPoints: 1_500,
          billBasisPoints: 500,
          approvedBy: a.userId,
          expiresAt: response.body.expiresAt,
        },
      },
    ]);
  });

  it('refuses a wrong password and stores nothing', async () => {
    const billKey = crypto.randomUUID();
    expect(await approve(a, { billKey, ownerPassword: 'wrong password' })).toEqual({
      status: 401,
      body: { code: 'wrong_password' },
    });
    const { rows } = await admin.pool.query('select 1 from owner_approvals where bill_key = $1', [
      billKey,
    ]);
    expect(rows).toEqual([]);
  });

  it("is approved by this business's owner, never another's", async () => {
    // Shop B's owner has the same password; only Shop A's owner may approve for Shop A.
    const response = await approve(a);
    const { rows } = await admin.pool.query<{ approved_by: string }>(
      'select approved_by from owner_approvals where id = $1',
      [response.body.approvalId],
    );
    expect(rows).toEqual([{ approved_by: a.userId }]);
  });

  it('needs billing.sell for held bills, discards and approvals', async () => {
    const viewer = staff(a, ['session.own', 'items.view']);
    expect((await call('GET', '/held-bills', viewer)).status).toBe(403);
    expect((await hold(viewer)).status).toBe(403);
    expect((await approve(viewer)).status).toBe(403);
    const discard = { draft: cart(), shownTotalPaise: 0 };
    expect((await call('POST', '/billing/discard', viewer, discard)).status).toBe(403);
  });
});

/** An item as `PUT /items/:id` takes it back (the items test's helper). */
function withoutViewFields(item: ItemView): Body {
  const body: Body = {
    ...item,
    packs: item.packs.map((pack) => {
      const sent: Body = { ...pack };
      delete sent.unitName;
      return sent;
    }),
  };
  delete body.id;
  delete body.archived;
  delete body.barcodes;
  return body;
}
