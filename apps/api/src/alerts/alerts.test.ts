// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: the bell's routes, the
// app switches, and alerts following the stock, the item's level and its archiving (P2.7 design
// §6, §8; ADR 0046).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  PERMISSIONS,
  type AlertList,
  type ItemView,
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

type Body = Record<string, unknown>;

describe('alerts', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  let a: Caller;
  let b: Caller;
  /** A third shop, for the switches, so they don't hide what the other tests look at. */
  let c: Caller;
  /** A cashier of shop A at its first branch, with stock.view. */
  let cashier: Caller;
  /** The owner's session at A's second branch, and a cashier there. */
  let ownerAt2: Caller;
  let cashierAt2: Caller;

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
    const text = await response.text();
    return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
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

  /** A staff login of the caller's business at `branchId`, as P1.5 makes them. */
  async function staffAt(
    owner: Caller,
    branchId: string,
    username: string,
    permissions: readonly Permission[],
  ): Promise<Caller> {
    const { rows } = await admin.pool.query<{ id: string }>(
      `insert into users (business_id, role, name, username, home_branch_id, joining_date)
       values ($1, 'staff', $2, $2, $3, '2026-01-01') returning id`,
      [owner.businessId, username, branchId],
    );
    return {
      ...owner,
      userId: rows[0]?.id ?? '',
      branchId,
      role: 'staff',
      permissions: ['session.own', ...permissions],
    };
  }

  async function addBranch(owner: Caller): Promise<string> {
    const { rows } = await admin.pool.query<{ id: string }>(
      'insert into branches (business_id, name, state_code, code) values ($1, $2, $3, $4) returning id',
      [owner.businessId, `Second ${crypto.randomUUID().slice(0, 6)}`, '27', 'B2'],
    );
    return rows[0]?.id ?? '';
  }

  async function item(caller: Caller, level: number | null, name?: string): Promise<ItemView> {
    const response = await call<ItemView>('POST', '/items', caller, {
      kind: 'goods',
      name: name ?? `Item ${crypto.randomUUID().slice(0, 8)}`,
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
      levels: level === null ? [] : [{ branchId: caller.branchId, lowStockLevel: level }],
      barcodes: [],
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  /** The item's update body with the levels replaced: what the item form sends back. */
  async function setLevels(caller: Caller, itemId: string, levels: Body[]) {
    const current = (await call<ItemView>('GET', `/items/${itemId}`, caller)).body;
    const body: Body = {
      ...current,
      packs: current.packs.map((pack) => {
        const sent: Body = { ...pack };
        delete sent.unitName;
        return sent;
      }),
      levels,
    };
    delete body.id;
    delete body.archived;
    delete body.barcodes;
    return call('PUT', `/items/${itemId}`, caller, body);
  }

  const open = (caller: Caller, itemId: string, quantity: number) =>
    call('POST', `/items/${itemId}/stock/opening`, caller, {
      requestKey: crypto.randomUUID(),
      quantity,
    });
  const adjust = (caller: Caller, itemId: string, quantity: number) =>
    call('POST', `/items/${itemId}/stock/adjustments`, caller, {
      requestKey: crypto.randomUUID(),
      reason: quantity > 0 ? 'count_mismatch' : 'damaged',
      note: null,
      quantity,
    });

  const bell = async (caller: Caller) => (await call<AlertList>('GET', '/alerts', caller)).body;
  const names = async (caller: Caller) => (await bell(caller)).alerts.map((row) => row.itemName);

  const recorded = async (itemId: string) =>
    (
      await admin.pool.query<{ type: string; cleared_at: Date | null }>(
        'select type, cleared_at from alerts where subject_id = $1 order by id',
        [itemId],
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
    a = await owner('Shop A', 'alerts-a@example.com');
    b = await owner('Shop B', 'alerts-b@example.com');
    c = await owner('Shop C', 'alerts-c@example.com');
    const second = await addBranch(a);
    cashier = await staffAt(a, a.branchId, 'cashier-one', ['stock.view']);
    ownerAt2 = { ...a, branchId: second };
    cashierAt2 = await staffAt(a, second, 'cashier-two', ['stock.view']);
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  describe('the bell', () => {
    it('lists low and out-of-stock items with their numbers, counted per type', async () => {
      const low = await item(a, 5_000, 'Atta');
      const out = await item(a, 5_000, 'Sugar');
      const fine = await item(a, 5_000, 'Rice');
      await open(a, low.id, 10_000);
      await open(a, out.id, 3_000);
      await open(a, fine.id, 50_000);
      await adjust(a, low.id, -6_000);
      await adjust(a, out.id, -3_000);

      const shown = await bell(a);
      expect(shown.counts).toEqual({ low_stock: 1, out_of_stock: 1 });
      expect(shown.total).toBe(2);
      expect(shown.alerts).toHaveLength(2);
      expect(shown.alerts).toEqual(
        expect.arrayContaining([
          {
            id: expect.any(String) as unknown,
            type: 'low_stock',
            subjectType: 'item',
            subjectId: low.id,
            itemName: 'Atta',
            itemHindiName: null,
            stockUnit: 'kg',
            branchId: a.branchId,
            branchName: expect.any(String) as unknown,
            details: { quantity: 4_000, level: 5_000 },
            raisedAt: expect.any(String) as unknown,
          },
          expect.objectContaining({
            type: 'out_of_stock',
            itemName: 'Sugar',
            details: { quantity: 0, level: 5_000 },
          }),
        ]),
      );
      expect(await names(a)).not.toContain('Rice');
    });

    it('shows an item with no level only once it is out of stock (#17)', async () => {
      const loose = await item(a, null, 'Loose salt');
      await open(a, loose.id, 2_000);
      expect(await names(a)).not.toContain('Loose salt');
      await adjust(a, loose.id, -2_000);
      expect((await bell(a)).alerts).toContainEqual(
        expect.objectContaining({
          itemName: 'Loose salt',
          type: 'out_of_stock',
          details: { quantity: 0, level: null },
        }),
      );
    });

    it('shows the owner every branch and staff only the branch they are at', async () => {
      const here = await item(a, 5_000, 'Branch one only');
      const there = await item(ownerAt2, 5_000, 'Branch two only');
      await open(a, here.id, 1_000);
      await open(ownerAt2, there.id, 1_000);

      expect(await names(a)).toEqual(
        expect.arrayContaining(['Branch one only', 'Branch two only']),
      );
      const ownerSees = (await bell(a)).alerts.filter((row) =>
        ['Branch one only', 'Branch two only'].includes(row.itemName),
      );
      expect(ownerSees.map((row) => row.branchId).sort()).toEqual(
        [a.branchId, ownerAt2.branchId].sort(),
      );
      const first = await names(cashier);
      expect(first).toContain('Branch one only');
      expect(first).not.toContain('Branch two only');
      const second = await names(cashierAt2);
      expect(second).toContain('Branch two only');
      expect(second).not.toContain('Branch one only');
    });

    it('hides stock alerts from a login without stock.view (#14)', async () => {
      const hidden = await item(a, 5_000, 'Hidden stock');
      await open(a, hidden.id, 1_000);
      const noStock = await staffAt(a, a.branchId, `no-stock-${crypto.randomUUID().slice(0, 6)}`, [
        'items.view',
        'billing.sell',
      ]);
      expect(await bell(noStock)).toEqual({ counts: {}, total: 0, alerts: [] });
      expect(await names(cashier)).toContain('Hidden stock');
    });

    it('hides a dismissed alert for that person only, and 204 twice', async () => {
      const dismissed = await item(a, 5_000, 'Dismiss me');
      await open(a, dismissed.id, 1_000);
      const id = (await bell(a)).alerts.find((row) => row.itemName === 'Dismiss me')?.id ?? '';

      const seenBefore = (await bell(cashier)).total;
      expect((await call('POST', `/alerts/${id}/dismiss`, cashier)).status).toBe(204);
      expect(await names(cashier)).not.toContain('Dismiss me');
      expect(await names(a)).toContain('Dismiss me');
      expect((await bell(cashier)).total).toBe(seenBefore - 1);
      expect((await call('POST', `/alerts/${id}/dismiss`, cashier)).status).toBe(204);

      // Still recorded, and a third person still sees it.
      expect(await recorded(dismissed.id)).toHaveLength(1);
      const other = await staffAt(a, a.branchId, `other-${crypto.randomUUID().slice(0, 6)}`, [
        'stock.view',
      ]);
      expect(await names(other)).toContain('Dismiss me');
    });

    it('shows a new alert again after the old one cleared, though it was dismissed', async () => {
      const again = await item(a, 5_000, 'Dismiss then recover');
      await open(a, again.id, 1_000);
      const id = (await bell(a)).alerts.find((row) => row.itemName === 'Dismiss then recover')?.id;
      await call('POST', `/alerts/${id ?? ''}/dismiss`, a);
      expect(await names(a)).not.toContain('Dismiss then recover');

      await adjust(a, again.id, 20_000);
      expect(await recorded(again.id)).toHaveLength(1);
      await adjust(a, again.id, -19_000);
      expect(await names(a)).toContain('Dismiss then recover');
      expect(await recorded(again.id)).toHaveLength(2);
      // The old dismissal can't be used on a cleared alert.
      expect((await call('POST', `/alerts/${id ?? ''}/dismiss`, a)).status).toBe(404);
    });

    it('shows a dismissed low-stock alert again when the item runs out (#19)', async () => {
      const worse = await item(a, 5_000, 'Dismiss then run out');
      await open(a, worse.id, 10_000);
      await adjust(a, worse.id, -6_000);
      const low = (await bell(a)).alerts.find((row) => row.itemName === 'Dismiss then run out');
      expect(low?.type).toBe('low_stock');
      await call('POST', `/alerts/${low?.id ?? ''}/dismiss`, a);
      // The cashier never dismissed it, and the owner's own dismissal is theirs alone.
      expect(await names(a)).not.toContain('Dismiss then run out');
      expect(await names(cashier)).toContain('Dismiss then run out');

      await adjust(a, worse.id, -4_000);
      const out = (await bell(a)).alerts.find((row) => row.itemName === 'Dismiss then run out');
      expect(out).toMatchObject({ id: low?.id, type: 'out_of_stock' });

      // Dismissing the worse state hides it again, and it stays one alert row.
      expect((await call('POST', `/alerts/${out?.id ?? ''}/dismiss`, a)).status).toBe(204);
      expect(await names(a)).not.toContain('Dismiss then run out');
      expect(await recorded(worse.id)).toHaveLength(1);
    });

    it('keeps a dismissed alert hidden when the item gets better, not worse', async () => {
      const better = await item(a, 5_000, 'Dismiss out then restock a bit');
      await open(a, better.id, 3_000);
      await adjust(a, better.id, -3_000);
      const id = (await bell(a)).alerts.find(
        (row) => row.itemName === 'Dismiss out then restock a bit',
      )?.id;
      await call('POST', `/alerts/${id ?? ''}/dismiss`, a);
      expect(await names(a)).not.toContain('Dismiss out then restock a bit');

      // Out of stock to low is better, so it stays hidden; out again is no worse than what
      // was dismissed.
      await adjust(a, better.id, 2_000);
      expect((await recorded(better.id))[0]?.type).toBe('low_stock');
      expect(await names(a)).not.toContain('Dismiss out then restock a bit');
      await adjust(a, better.id, -2_000);
      expect((await recorded(better.id))[0]?.type).toBe('out_of_stock');
      expect(await names(a)).not.toContain('Dismiss out then restock a bit');
    });

    it('refuses to dismiss what the caller cannot see, or what is not there', async () => {
      const mine = await item(a, 5_000, 'Only A');
      await open(a, mine.id, 1_000);
      const id = (await bell(a)).alerts.find((row) => row.itemName === 'Only A')?.id ?? '';
      expect((await call('POST', `/alerts/${id}/dismiss`, b)).status).toBe(404);
      expect((await call('POST', `/alerts/${id}/dismiss`, cashierAt2)).status).toBe(404);
      const noStock = await staffAt(a, a.branchId, `no-view-${crypto.randomUUID().slice(0, 6)}`, [
        'items.view',
      ]);
      expect((await call('POST', `/alerts/${id}/dismiss`, noStock)).status).toBe(404);
      expect(
        (await call('POST', `/alerts/0190f0f0-0000-7000-8000-000000000999/dismiss`, a)).status,
      ).toBe(404);
      expect((await call('POST', '/alerts/nope/dismiss', a)).status).toBe(404);
      expect(await names(a)).toContain('Only A');
    });

    it('keeps one business from seeing the other’s alerts', async () => {
      const theirs = await item(b, 5_000, 'Only B');
      await open(b, theirs.id, 1_000);
      expect(await names(b)).toEqual(['Only B']);
      expect(await names(a)).not.toContain('Only B');
    });

    it('needs a session', async () => {
      expect(await call('GET', '/alerts', null)).toEqual({
        status: 401,
        body: { code: 'not_logged_in' },
      });
      expect((await call('POST', `/alerts/${crypto.randomUUID()}/dismiss`, null)).status).toBe(401);
    });
  });

  describe('following the item', () => {
    it('raises when a saved level goes above the stock and clears when it goes under', async () => {
      const level = await item(a, null, 'Level moves');
      await open(a, level.id, 8_000);
      expect(await names(a)).not.toContain('Level moves');

      expect(
        (await setLevels(a, level.id, [{ branchId: a.branchId, lowStockLevel: 10_000 }])).status,
      ).toBe(200);
      expect((await bell(a)).alerts).toContainEqual(
        expect.objectContaining({
          itemName: 'Level moves',
          type: 'low_stock',
          details: { quantity: 8_000, level: 10_000 },
        }),
      );
      await setLevels(a, level.id, [{ branchId: a.branchId, lowStockLevel: 2_000 }]);
      expect(await names(a)).not.toContain('Level moves');
      expect(await recorded(level.id)).toHaveLength(1);
    });

    it('clears when the item is archived, and comes back when it is restored', async () => {
      const gone = await item(a, 5_000, 'Archive me');
      await open(a, gone.id, 1_000);
      expect(await names(a)).toContain('Archive me');
      expect((await call('POST', `/items/${gone.id}/archive`, a)).status).toBe(200);
      expect(await names(a)).not.toContain('Archive me');
      expect((await recorded(gone.id))[0]?.cleared_at).not.toBeNull();
      expect((await call('POST', `/items/${gone.id}/restore`, a)).status).toBe(200);
      expect(await names(a)).toContain('Archive me');
      expect(await recorded(gone.id)).toHaveLength(2);
    });

    it('writes no entry-log row for raising or clearing, only for the stock change itself', async () => {
      const quiet = await item(a, 5_000, 'Quiet');
      await open(a, quiet.id, 10_000);
      await adjust(a, quiet.id, -9_000);
      await adjust(a, quiet.id, 9_000);
      const { rows } = await admin.pool.query<{ action: string }>(
        `select action from entry_log
          where business_id = $1 and (entity_type = 'alert' or action like 'alert%')`,
        [a.businessId],
      );
      expect(rows).toEqual([]);
      expect((await recorded(quiet.id))[0]?.cleared_at).not.toBeNull();
    });
  });

  describe('the app switches (Module 07 #3)', () => {
    const logged = async (businessId: string) =>
      (
        await admin.pool.query<{ before: Body; after: Body; actor_id: string }>(
          `select before, after, actor_id from entry_log
            where business_id = $1 and action = 'settings.alerts_changed' order by id`,
          [businessId],
        )
      ).rows;

    it('starts with the business type’s alerts, in the settings and on their own route', async () => {
      expect((await call<SettingsView>('GET', '/settings', a)).body.alerts).toEqual({
        types: ['low_stock', 'out_of_stock'],
      });
      expect(await call('GET', '/settings/alerts', a)).toEqual({
        status: 200,
        body: { types: ['low_stock', 'out_of_stock'] },
      });
    });

    it('hides a switched-off type but keeps recording it, and shows it again when switched on', async () => {
      const switched = await item(c, 5_000, 'Switch test');
      await open(c, switched.id, 1_000);
      expect((await bell(c)).counts).toEqual({ low_stock: 1 });

      const off = await call<SettingsView>('PUT', '/settings/alerts', c, {
        types: ['out_of_stock'],
      });
      expect(off.status).toBe(200);
      expect(off.body.alerts).toEqual({ types: ['out_of_stock'] });
      expect(await bell(c)).toEqual({ counts: {}, total: 0, alerts: [] });
      // A new alert while it is off is still recorded.
      await adjust(c, switched.id, -1_000);
      expect(await recorded(switched.id)).toEqual([{ type: 'out_of_stock', cleared_at: null }]);
      const sold = await item(c, 5_000, 'Sold while off');
      await open(c, sold.id, 9_000);
      await adjust(c, sold.id, -5_000);
      expect(await recorded(sold.id)).toEqual([{ type: 'low_stock', cleared_at: null }]);
      expect(await names(c)).toEqual(['Switch test']);

      await call('PUT', '/settings/alerts', c, { types: ['low_stock', 'out_of_stock'] });
      expect((await names(c)).sort()).toEqual(['Sold while off', 'Switch test']);
    });

    it('logs one settings.alerts_changed row per real change, and none for a repeat or reorder', async () => {
      const before = (await logged(c.businessId)).length;
      await call('PUT', '/settings/alerts', c, { types: ['out_of_stock', 'low_stock'] });
      expect(await logged(c.businessId)).toHaveLength(before);
      await call('PUT', '/settings/alerts', c, { types: [] });
      const rows = await logged(c.businessId);
      expect(rows).toHaveLength(before + 1);
      expect(rows.at(-1)).toEqual({
        actor_id: c.userId,
        before: { types: ['low_stock', 'out_of_stock'] },
        after: { types: [] },
      });
      await call('PUT', '/settings/alerts', c, { types: ['low_stock', 'out_of_stock'] });
    });

    it('refuses unknown or repeated types, and needs the settings permissions', async () => {
      expect(await call('PUT', '/settings/alerts', a, { types: ['nope'] })).toEqual({
        status: 400,
        body: { code: 'invalid_body', fields: { 'types.0': 'invalid' } },
      });
      expect((await call('PUT', '/settings/alerts', cashier, { types: [] })).status).toBe(403);
      expect((await call('GET', '/settings/alerts', cashier)).status).toBe(403);
      expect((await call('PUT', '/settings/alerts', null, { types: [] })).status).toBe(401);
    });
  });
});
