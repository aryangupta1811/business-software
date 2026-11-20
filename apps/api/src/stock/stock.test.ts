// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: stock, opening stock,
// adjustments and their history (P1.8, design §5–8 and §10).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  PERMISSIONS,
  type ItemPage,
  type ItemStockView,
  type ItemView,
  type MovementPage,
  type MovementView,
  type Permission,
  type SettingsView,
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

// 00:30 IST on 21 November: the business date is the 21st, though UTC still says the 20th.
const NOW = new Date('2026-11-20T19:00:00.000Z');
const TODAY = '2026-11-21';

type Body = Record<string, unknown>;

describe('stock', () => {
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
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': CSRF,
        ...(caller && { 'x-test-caller': JSON.stringify(caller) }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (await response.json()) as T,
      headers: response.headers,
    };
  }

  async function owner(name: string, email: string): Promise<Caller> {
    const created = await call('POST', '/signup', null, {
      businessName: name,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus: 'unregistered',
      email,
      password: 'correct horse battery',
    });
    const { businessId } = created.body as { businessId: string };
    const { rows } = await admin.pool.query<{ id: string; branch_id: string }>(
      `select u.id, b.id as branch_id from users u join branches b using (business_id)
        where u.business_id = $1 and u.role = 'owner'`,
      [businessId],
    );
    await admin.pool.query('update users set name = $2 where id = $1', [rows[0]?.id, 'Ramesh']);
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

  /** The same person with only some permissions, as P1.5's staff logins will be. */
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
      sellingPrice: 5_200,
      wholesalePrice: null,
      purchasePrice: 4_000,
      mrp: null,
      priceIncludesTax: true,
      gstRate: null,
      hsn: null,
      packs: [],
      levels: [],
      barcodes: [],
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  const key = () => crypto.randomUUID();

  const open = (caller: Caller, itemId: string, body: Body) =>
    call<MovementView>('POST', `/items/${itemId}/stock/opening`, caller, {
      requestKey: key(),
      ...body,
    });

  const adjust = (caller: Caller, itemId: string, body: Body) =>
    call<MovementView>('POST', `/items/${itemId}/stock/adjustments`, caller, {
      reason: 'damaged',
      note: null,
      requestKey: key(),
      ...body,
    });

  const stock = async (caller: Caller, itemId: string) =>
    (await call<ItemStockView>('GET', `/items/${itemId}/stock`, caller)).body;

  const entries = async (entityId: string) =>
    (
      await admin.pool.query<{
        action: string;
        actor_id: string;
        branch_id: string;
        reason: string | null;
        after: Body | null;
      }>(
        'select action, actor_id, branch_id, reason, after from entry_log where entity_id = $1 order by id',
        [entityId],
      )
    ).rows;

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { sessions: headerSessions, clock: { now: () => NOW } },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}/api`;
    a = await owner('Shop A', 'stock-a@example.com');
    b = await owner('Shop B', 'stock-b@example.com');
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  describe('reading', () => {
    it('shows every branch, with nothing moved yet', async () => {
      const atta = await item(a, { levels: [{ branchId: a.branchId, lowStockLevel: 2_000 }] });
      expect(await call('GET', `/items/${atta.id}/stock`, a)).toMatchObject({
        status: 200,
        body: {
          itemId: atta.id,
          stockUnit: 'kg',
          branches: [
            {
              branchId: a.branchId,
              branchName: expect.any(String) as unknown,
              quantity: 0,
              lowStockLevel: 2_000,
              low: true,
              canOpen: true,
              averageCost: null,
              value: null,
            },
          ],
        },
      });
    });

    it('leaves cost and value out for a caller without items.view_cost', async () => {
      const atta = await item(a);
      await open(a, atta.id, { quantity: 1_000 });
      const view = await stock(staff(a, ['stock.view']), atta.id);
      expect(view.branches[0]).not.toHaveProperty('averageCost');
      expect(view.branches[0]).not.toHaveProperty('value');
      expect(view.branches[0]).toMatchObject({ quantity: 1_000, canOpen: false });
    });

    it('needs stock.view, and finds only items of the caller’s business', async () => {
      const atta = await item(a);
      expect((await call('GET', `/items/${atta.id}/stock`, staff(a, ['items.view']))).status).toBe(
        403,
      );
      expect(await call('GET', `/items/${atta.id}/stock`, b)).toEqual(
        expect.objectContaining({ status: 404, body: { code: 'not_found' } }),
      );
    });

    it('refuses a service, which has no stock', async () => {
      const repair = await item(a, { kind: 'service', hsn: '998719', purchasePrice: null });
      expect(await call('GET', `/items/${repair.id}/stock`, a)).toEqual(
        expect.objectContaining({ status: 409, body: { code: 'service_has_no_stock' } }),
      );
    });
  });

  describe('opening stock (Module 01 #9, answer 4A)', () => {
    it('sets the stock, logs stock.opening_set and answers the movement', async () => {
      const atta = await item(a);
      const response = await open(a, atta.id, { quantity: 12_500, unitCost: 4_200 });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as unknown,
        branchId: a.branchId,
        kind: 'opening',
        quantity: 12_500,
        balanceAfter: 12_500,
        unitCost: 4_200,
        value: 52_500,
        reason: null,
        note: null,
        businessDate: TODAY,
        actorId: a.userId,
        actorName: 'Ramesh',
        createdAt: expect.any(String) as unknown,
      });
      expect((await stock(a, atta.id)).branches[0]).toMatchObject({
        quantity: 12_500,
        averageCost: 4_200,
        value: 52_500,
        canOpen: false,
      });
      expect(await entries(response.body.id)).toEqual([
        {
          action: 'stock.opening_set',
          actor_id: a.userId,
          branch_id: a.branchId,
          reason: null,
          after: {
            itemId: atta.id,
            quantity: 12_500,
            unitCost: 4_200,
            value: 52_500,
            businessDate: TODAY,
          },
        },
      ]);
    });

    it('is refused once anything has moved the item at the branch', async () => {
      const atta = await item(a);
      await open(a, atta.id, { quantity: 1_000 });
      expect(await open(a, atta.id, { quantity: 1_000 })).toEqual(
        expect.objectContaining({ status: 409, body: { code: 'opening_exists' } }),
      );
    });

    it("costs at the item's purchase price when none is sent, and needs one otherwise", async () => {
      const atta = await item(a, { purchasePrice: 3_900 });
      expect((await open(staff(a, ['stock.adjust']), atta.id, { quantity: 1_000 })).body).toEqual(
        expect.not.objectContaining({ unitCost: expect.anything() as unknown }),
      );
      expect((await stock(a, atta.id)).branches[0]).toMatchObject({ averageCost: 3_900 });

      const unknownCost = await item(a, { purchasePrice: null });
      expect(await open(a, unknownCost.id, { quantity: 1_000 })).toEqual(
        expect.objectContaining({ status: 409, body: { code: 'cost_required' } }),
      );
    });

    it('takes a cost only from a caller who may see costs', async () => {
      const atta = await item(a);
      expect(
        (await open(staff(a, ['stock.adjust']), atta.id, { quantity: 1_000, unitCost: 1 })).status,
      ).toBe(403);
    });

    it('needs stock.adjust', async () => {
      const atta = await item(a);
      expect(
        (await open(staff(a, ['stock.view', 'items.view_cost']), atta.id, { quantity: 1 })).status,
      ).toBe(403);
    });
  });

  describe('adjustments (Module 01 #11)', () => {
    it('writes a damaged write-down at the average cost, logged with value and date (06 #7)', async () => {
      const atta = await item(a, { purchasePrice: 9_999 });
      await open(a, atta.id, { quantity: 10_000, unitCost: 4_000 });
      const response = await adjust(a, atta.id, { quantity: -2_500, note: 'bag torn' });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        kind: 'adjustment',
        quantity: -2_500,
        balanceAfter: 7_500,
        unitCost: 4_000,
        value: -10_000,
        reason: 'damaged',
        note: 'bag torn',
        businessDate: TODAY,
      });
      expect(await entries(response.body.id)).toEqual([
        {
          action: 'stock.adjusted',
          actor_id: a.userId,
          branch_id: a.branchId,
          reason: 'damaged: bag torn',
          after: {
            itemId: atta.id,
            quantity: -2_500,
            balanceAfter: 7_500,
            unitCost: 4_000,
            value: -10_000,
            reasonCode: 'damaged',
            businessDate: TODAY,
          },
        },
      ]);
    });

    it('logs the reason alone when there is no note', async () => {
      const atta = await item(a);
      const response = await adjust(a, atta.id, { quantity: 2_000, reason: 'count_mismatch' });
      expect((await entries(response.body.id))[0]?.reason).toBe('count_mismatch');
    });

    it('never takes stock below zero (answer 2A)', async () => {
      const atta = await item(a);
      await open(a, atta.id, { quantity: 1_000 });
      expect(await adjust(a, atta.id, { quantity: -1_001 })).toEqual(
        expect.objectContaining({ status: 409, body: { code: 'below_zero' } }),
      );
      expect((await stock(a, atta.id)).branches[0]).toMatchObject({ quantity: 1_000 });
    });

    it('answers field codes for the direction, the note and whole units', async () => {
      const soap = await item(a, { stockUnit: 'piece' });
      expect(await adjust(a, soap.id, { quantity: 1_000, reason: 'expired' })).toEqual(
        expect.objectContaining({
          status: 400,
          body: { code: 'invalid_body', fields: { quantity: 'wrong_direction' } },
        }),
      );
      expect(await adjust(a, soap.id, { quantity: -1_000, reason: 'other' })).toEqual(
        expect.objectContaining({
          status: 400,
          body: { code: 'invalid_body', fields: { note: 'required' } },
        }),
      );
      expect(await adjust(a, soap.id, { quantity: 1_500, reason: 'count_mismatch' })).toEqual(
        expect.objectContaining({
          status: 400,
          body: { code: 'invalid_body', fields: { quantity: 'whole_units_only' } },
        }),
      );
    });

    it('refuses an archived item, which keeps its stock (answer 7A)', async () => {
      const atta = await item(a);
      await open(a, atta.id, { quantity: 4_000 });
      expect((await call('POST', `/items/${atta.id}/archive`, a)).status).toBe(200);
      expect(await adjust(a, atta.id, { quantity: -1_000 })).toEqual(
        expect.objectContaining({ status: 409, body: { code: 'archived' } }),
      );
      expect((await stock(a, atta.id)).branches[0]).toMatchObject({ quantity: 4_000 });
    });

    it("refuses an unknown item and another business's item", async () => {
      const ofB = await item(b);
      for (const id of [crypto.randomUUID(), ofB.id]) {
        expect(await adjust(a, id, { quantity: -1_000 })).toEqual(
          expect.objectContaining({ status: 404, body: { code: 'not_found' } }),
        );
      }
    });

    it('needs stock.adjust', async () => {
      const atta = await item(a);
      expect(
        (
          await adjust(staff(a, ['stock.view']), atta.id, {
            quantity: 1_000,
            reason: 'count_mismatch',
          })
        ).status,
      ).toBe(403);
    });
  });

  // ADR 0007 rule 7: the screen sends the same key again when it retries.
  describe('retries', () => {
    it('answers a retry with the first result and moves stock once', async () => {
      const atta = await item(a);
      const body = { quantity: 2_000, reason: 'count_mismatch', note: null, requestKey: key() };
      const first = await call<MovementView>(
        'POST',
        `/items/${atta.id}/stock/adjustments`,
        a,
        body,
      );
      const again = await call<MovementView>(
        'POST',
        `/items/${atta.id}/stock/adjustments`,
        a,
        body,
      );
      expect(again).toEqual(expect.objectContaining({ status: 201, body: first.body }));
      expect((await stock(a, atta.id)).branches[0]).toMatchObject({ quantity: 2_000 });
      expect(await entries(first.body.id)).toHaveLength(1);
    });

    it('answers the same for retries that arrive at the same moment', async () => {
      const atta = await item(a);
      const body = { quantity: 1_000, reason: 'count_mismatch', note: null, requestKey: key() };
      const answers = await Promise.all(
        Array.from({ length: 5 }, () =>
          call<MovementView>('POST', `/items/${atta.id}/stock/adjustments`, a, body),
        ),
      );
      expect(new Set(answers.map((answer) => answer.status))).toEqual(new Set([201]));
      expect(new Set(answers.map((answer) => answer.body.id)).size).toBe(1);
      expect((await stock(a, atta.id)).branches[0]).toMatchObject({ quantity: 1_000 });
    });

    // Review of PR #38: the copy that waited on the row lock saw the winner's stock and
    // answered a rule (opening_exists, below_zero) instead of the winner's movement.
    it('answers simultaneous copies the same even when the rules would refuse a second change', async () => {
      const first = await item(a);
      const openBody = { quantity: 1_000, unitCost: 4_000, requestKey: key() };
      const openings = await Promise.all(
        Array.from({ length: 5 }, () =>
          call<MovementView>('POST', `/items/${first.id}/stock/opening`, a, openBody),
        ),
      );
      expect(openings.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(openings.map((answer) => answer.body.id)).size).toBe(1);

      const writeOff = { quantity: -1_000, reason: 'damaged', note: null, requestKey: key() };
      const writeOffs = await Promise.all(
        Array.from({ length: 5 }, () =>
          call<MovementView>('POST', `/items/${first.id}/stock/adjustments`, a, writeOff),
        ),
      );
      expect(writeOffs.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(writeOffs.map((answer) => answer.body.id)).size).toBe(1);
      expect((await stock(a, first.id)).branches[0]).toMatchObject({ quantity: 0 });
    });

    it('refuses an opening retry with a different cost', async () => {
      const atta = await item(a);
      const requestKey = key();
      await open(a, atta.id, { quantity: 1_000, unitCost: 4_000, requestKey });
      expect(await open(a, atta.id, { quantity: 1_000, unitCost: 4_500, requestKey })).toEqual(
        expect.objectContaining({ status: 422, body: { code: 'key_reused' } }),
      );
    });

    it('refuses a key reused for a different change', async () => {
      const atta = await item(a);
      const requestKey = key();
      await adjust(a, atta.id, { quantity: 2_000, reason: 'count_mismatch', requestKey });
      expect(
        await adjust(a, atta.id, { quantity: 3_000, reason: 'count_mismatch', requestKey }),
      ).toEqual(expect.objectContaining({ status: 422, body: { code: 'key_reused' } }));
      const other = await item(a);
      expect(await open(a, other.id, { quantity: 1_000, requestKey })).toEqual(
        expect.objectContaining({ status: 422, body: { code: 'key_reused' } }),
      );
    });
  });

  describe('the history', () => {
    it('lists the branch’s movements newest first, 50 at a time, without costs for staff', async () => {
      const atta = await item(a);
      await open(a, atta.id, { quantity: 60_000 });
      for (let index = 0; index < 54; index += 1) {
        await adjust(a, atta.id, { quantity: -1_000, reason: 'own_use' });
      }
      const first = await call<MovementPage>('GET', `/items/${atta.id}/stock/movements`, a);
      expect(first.status).toBe(200);
      expect(first.body.movements).toHaveLength(50);
      expect(first.body.movements[0]).toMatchObject({ balanceAfter: 6_000, actorName: 'Ramesh' });
      expect(first.body.next).toBe(first.body.movements[49]?.id);
      const second = await call<MovementPage>(
        'GET',
        `/items/${atta.id}/stock/movements?after=${first.body.next ?? ''}`,
        a,
      );
      expect(second.body.movements.map((movement) => movement.balanceAfter)).toEqual([
        56_000, 57_000, 58_000, 59_000, 60_000,
      ]);
      expect(second.body.next).toBeNull();

      const viewer = await call<MovementPage>(
        'GET',
        `/items/${atta.id}/stock/movements?branch=${a.branchId}`,
        staff(a, ['stock.view']),
      );
      expect(viewer.body.movements[0]).not.toHaveProperty('unitCost');
      expect(viewer.body.movements[0]).not.toHaveProperty('value');
    });

    it('refuses a bad cursor or branch with field codes', async () => {
      const atta = await item(a);
      expect(await call('GET', `/items/${atta.id}/stock/movements?after=nope`, a)).toEqual(
        expect.objectContaining({
          status: 400,
          body: { code: 'invalid_body', fields: { after: 'invalid' } },
        }),
      );
      expect(
        (
          await call<MovementPage>(
            'GET',
            `/items/${atta.id}/stock/movements?branch=${b.branchId}`,
            a,
          )
        ).body,
      ).toEqual({
        movements: [],
        next: null,
      });
    });
  });

  describe('the items list', () => {
    it('shows stock and low at the caller’s branch, and filters to low items', async () => {
      const low = await item(a, {
        name: `Low ${crypto.randomUUID().slice(0, 8)}`,
        levels: [{ branchId: a.branchId, lowStockLevel: 5_000 }],
      });
      await open(a, low.id, { quantity: 2_000 });
      const fine = await item(a, { levels: [{ branchId: a.branchId, lowStockLevel: 1_000 }] });
      await open(a, fine.id, { quantity: 2_000 });

      const page = (await call<ItemPage>('GET', `/items?q=${encodeURIComponent(low.name)}`, a))
        .body;
      expect(page.items).toEqual([
        expect.objectContaining({ id: low.id, stock: 2_000, low: true }),
      ]);
      const lows = (await call<ItemPage>('GET', '/items?low=true', a)).body.items;
      expect(lows.map((row) => row.id)).toContain(low.id);
      expect(lows.map((row) => row.id)).not.toContain(fine.id);

      const viewer = (
        await call<ItemPage>(
          'GET',
          `/items?q=${encodeURIComponent(low.name)}`,
          staff(a, ['items.view']),
        )
      ).body;
      expect(viewer.items[0]).not.toHaveProperty('stock');
      expect(viewer.items[0]).not.toHaveProperty('low');
    });
  });

  describe('the negative-stock setting (Module 01 #12, answer 1A)', () => {
    it('is warn by default, saved by the owner and logged', async () => {
      expect((await call<SettingsView>('GET', '/settings', b)).body.stock).toEqual({
        negativeStock: 'warn',
      });
      const saved = await call<SettingsView>('PUT', '/settings/stock', b, {
        negativeStock: 'block',
      });
      expect(saved).toEqual(expect.objectContaining({ status: 200 }));
      expect(saved.body.stock).toEqual({ negativeStock: 'block' });
      const log = await entries(b.businessId);
      expect(log.at(-1)).toMatchObject({
        action: 'business.updated',
        after: { negativeStock: 'block' },
      });
      expect(
        (
          await call('PUT', '/settings/stock', staff(b, ['settings.view']), {
            negativeStock: 'warn',
          })
        ).status,
      ).toBe(403);
    });
  });

  // ADR 0041: a counter that can't get the row in 3 s gets a clear, retryable answer.
  it('answers 503 busy with Retry-After when another counter holds the item too long', async () => {
    const atta = await item(a);
    await open(a, atta.id, { quantity: 1_000 });
    const holder = await admin.pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from item_stock where item_id = $1 for update', [atta.id]);
      const response = await adjust(a, atta.id, { quantity: -1_000 });
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ code: 'busy' });
      expect(response.headers.get('retry-after')).toBe('1');
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  }, 15_000);
});
