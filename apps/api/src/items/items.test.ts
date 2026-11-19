// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: items, their packs,
// barcodes and levels, categories and own units (P1.7, design §6 and §10).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  inStoreBarcode,
  inStoreSerial,
  PERMISSIONS,
  type ItemPage,
  type ItemsContext,
  type ItemView,
  type Permission,
} from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Caller, SessionResolver } from '../http/session.js';

// Tests say who is calling in a header; P1.4's resolver reads a session cookie instead.
const headerSessions: SessionResolver = {
  resolve(request: IncomingMessage) {
    const header = request.headers['x-test-caller'];
    return Promise.resolve(typeof header === 'string' ? (JSON.parse(header) as Caller) : null);
  },
};

const atta = {
  kind: 'goods',
  name: 'Aashirvaad Atta',
  hindiName: 'आशीर्वाद आटा',
  code: null,
  categoryId: null,
  brand: 'Aashirvaad',
  stockUnit: 'kg',
  sellingPrice: 5_200,
  wholesalePrice: 4_900,
  purchasePrice: 4_500,
  mrp: 5_500,
  priceIncludesTax: true,
  gstRate: 500,
  hsn: '1101',
  packs: [] as unknown[],
  levels: [] as unknown[],
  barcodes: [] as string[],
};

const bag = {
  id: null,
  unitCode: 'bag',
  unitId: null,
  size: 50_000,
  sellingPrice: 250_000,
  mrp: null,
  soldAsPack: true,
  boughtAsPack: true,
};

type Body = Record<string, unknown>;

describe('items', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  let a: Caller;
  let b: Caller;
  let aBranch: string;
  let bBranch: string;

  // The caller names the answer's shape; the test's own expectations check it.
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
        ...(caller && { 'x-test-caller': JSON.stringify(caller) }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function owner(name: string, email: string, gstStatus: string): Promise<Caller> {
    const created = await call('POST', '/signup', null, {
      businessName: name,
      businessType: 'kirana',
      phone: '9111111111',
      stateCode: '27',
      gstStatus,
      email,
      password: 'correct horse battery',
    });
    const { businessId } = created.body as { businessId: string };
    const { rows } = await admin.pool.query<{ id: string }>(
      "select id from users where business_id = $1 and role = 'owner'",
      [businessId],
    );
    return { businessId, userId: rows[0]?.id ?? '', permissions: PERMISSIONS };
  }

  /** The same person with only some permissions, as P1.5's staff logins will be. */
  const staff = (caller: Caller, permissions: Permission[]): Caller => ({ ...caller, permissions });

  async function create(caller: Caller, overrides: Body = {}): Promise<ItemView> {
    const response = await call<ItemView>('POST', '/items', caller, {
      ...atta,
      name: `Item ${crypto.randomUUID().slice(0, 8)}`,
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  /** The item as an update body: what the form sends back. */
  function asUpdate(item: ItemView, overrides: Body = {}): Body {
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
    return { ...body, ...overrides };
  }

  const entries = async (entityId: string) => {
    const { rows } = await admin.pool.query<{
      action: string;
      actor_id: string;
      before: Body | null;
      after: Body | null;
    }>('select action, actor_id, before, after from entry_log where entity_id = $1 order by id', [
      entityId,
    ]);
    return rows;
  };

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
    a = await owner('Shop A', 'a@example.com', 'regular');
    b = await owner('Shop B', 'b@example.com', 'unregistered');
    const branchOf = async (businessId: string) =>
      (
        await admin.pool.query<{ id: string }>('select id from branches where business_id = $1', [
          businessId,
        ])
      ).rows[0]?.id ?? '';
    aBranch = await branchOf(a.businessId);
    bBranch = await branchOf(b.businessId);
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
    await server.stop();
  });

  describe('the form context', () => {
    it('tells the page what the caller may do, the GST rule, the features and the branches', async () => {
      const context = await call<ItemsContext>('GET', '/items/context', a);
      expect(context.status).toBe(200);
      expect(context.body).toEqual({
        canViewCost: true,
        canManage: true,
        needsGst: true,
        features: expect.any(Array) as unknown,
        branches: [{ id: aBranch, name: expect.any(String) as unknown }],
      });
      const viewer = await call<ItemsContext>('GET', '/items/context', staff(b, ['items.view']));
      expect(viewer.body).toMatchObject({
        canViewCost: false,
        canManage: false,
        needsGst: false,
        branches: [{ id: bBranch }],
      });
      expect((await call('GET', '/items/context', staff(a, []))).status).toBe(403);
    });
  });

  describe('creating', () => {
    it('saves the item with its pack, level and barcode, and logs it once', async () => {
      const response = await call<ItemView>('POST', '/items', a, {
        ...atta,
        packs: [bag],
        levels: [{ branchId: aBranch, lowStockLevel: 10_000 }],
        barcodes: ['8901725181222'],
      });
      expect(response.status).toBe(201);
      const item = response.body;
      expect(item).toMatchObject({
        name: 'Aashirvaad Atta',
        purchasePrice: 4_500,
        archived: false,
        version: 1,
        packs: [{ ...bag, id: expect.any(String) as unknown, unitName: null }],
        levels: [{ branchId: aBranch, lowStockLevel: 10_000 }],
        barcodes: [{ code: '8901725181222', packId: null, inStore: false }],
      });
      const log = await entries(item.id);
      expect(log).toEqual([
        expect.objectContaining({ action: 'item.created', actor_id: a.userId, before: null }),
      ]);
      expect(log[0]?.after).toMatchObject({ name: 'Aashirvaad Atta', purchasePrice: 4_500 });
    });

    it('needs a GST rate and HSN for a regular business only (G5)', async () => {
      expect(
        await call('POST', '/items', a, { ...atta, name: 'No GST', gstRate: null, hsn: null }),
      ).toEqual({
        status: 400,
        body: {
          code: 'invalid_body',
          fields: { gstRate: 'gst_required', hsn: 'gst_required' },
        },
      });
      await create(b, { gstRate: null, hsn: null });
    });

    it('answers field codes for a bad body, never a 500', async () => {
      expect(await call('POST', '/items', a, { ...atta, sellingPrice: 9_999 })).toEqual({
        status: 400,
        body: { code: 'invalid_body', fields: { sellingPrice: 'above_mrp' } },
      });
    });

    it("refuses another business's category, unit or branch as unknown", async () => {
      const category = await call<{ id: string }>('POST', '/categories', b, { name: 'Grains' });
      const unit = await call<{ id: string }>('POST', '/units', b, {
        name: 'Sack',
        hindiName: null,
        baseUnit: 'kg',
        defaultSize: 25_000,
      });
      expect(
        await call('POST', '/items', a, {
          ...atta,
          name: 'Borrowed',
          categoryId: category.body.id,
          packs: [{ ...bag, unitCode: null, unitId: unit.body.id }],
          levels: [{ branchId: bBranch, lowStockLevel: 0 }],
        }),
      ).toEqual({
        status: 400,
        body: {
          code: 'invalid_body',
          fields: {
            categoryId: 'invalid',
            'packs.0.unitId': 'invalid',
            'levels.0.branchId': 'invalid',
          },
        },
      });
    });

    it('refuses a second live item with the same name or short code', async () => {
      await create(a, { name: 'Tata Salt', code: 'SALT' });
      expect(await call('POST', '/items', a, { ...atta, name: 'TATA SALT' })).toEqual({
        status: 409,
        body: { code: 'name_taken' },
      });
      expect(await call('POST', '/items', a, { ...atta, name: 'Salt 2', code: 'salt' })).toEqual({
        status: 409,
        body: { code: 'code_taken' },
      });
      // Another business has its own names.
      await create(b, { name: 'Tata Salt', code: 'SALT' });
    });
  });

  describe('changing', () => {
    it('logs only what changed and raises the version', async () => {
      const item = await create(a);
      const saved = await call<ItemView>(
        'PUT',
        `/items/${item.id}`,
        a,
        asUpdate(item, { sellingPrice: 5_000 }),
      );
      expect(saved).toMatchObject({ status: 200, body: { sellingPrice: 5_000, version: 2 } });
      const log = await entries(item.id);
      expect(log.at(-1)).toMatchObject({
        action: 'item.updated',
        before: { sellingPrice: 5_200 },
        after: { sellingPrice: 5_000 },
      });
    });

    it('changes nothing and logs nothing when nothing changed', async () => {
      const item = await create(a, { levels: [{ branchId: aBranch, lowStockLevel: 1_000 }] });
      const saved = await call<ItemView>('PUT', `/items/${item.id}`, a, asUpdate(item));
      expect(saved.body.version).toBe(1);
      expect(await entries(item.id)).toHaveLength(1);
    });

    it("answers 409 stale to a save made from an old copy, so it can't overwrite", async () => {
      const item = await create(a);
      await call('PUT', `/items/${item.id}`, a, asUpdate(item, { sellingPrice: 5_100 }));
      expect(
        await call('PUT', `/items/${item.id}`, a, asUpdate(item, { sellingPrice: 4_000 })),
      ).toEqual({ status: 409, body: { code: 'stale' } });
      expect((await call<ItemView>('GET', `/items/${item.id}`, a)).body.sellingPrice).toBe(5_100);
    });

    it('archives a dropped pack and removes its barcodes; refuses a pack id it never had', async () => {
      const item = await create(a, { packs: [bag] });
      const packId = item.packs[0]?.id ?? '';
      await call('POST', `/items/${item.id}/barcodes`, a, { code: 'BAG-0001', packId });
      const withCode = (await call<ItemView>('GET', `/items/${item.id}`, a)).body;
      expect(withCode.barcodes).toHaveLength(1);
      expect(
        await call('PUT', `/items/${item.id}`, a, {
          ...asUpdate(withCode),
          packs: [{ ...bag, id: crypto.randomUUID() }],
        }),
      ).toMatchObject({ status: 400, body: { fields: { 'packs.0.id': 'invalid' } } });
      const saved = await call<ItemView>('PUT', `/items/${item.id}`, a, {
        ...asUpdate(withCode),
        packs: [],
      });
      expect(saved.body).toMatchObject({ packs: [], barcodes: [] });
      // The log says which codes went with the pack.
      expect((await entries(item.id)).at(-1)).toMatchObject({
        action: 'item.updated',
        before: { barcodes: ['BAG-0001'] },
        after: { barcodes: [] },
      });
      // The code is free again.
      await create(a, { barcodes: ['BAG-0001'] });
    });

    // The live-unit unique index sees each write, not the final set, so the order matters.
    it('saves any valid set of packs, whatever order the units move in', async () => {
      const box = { ...bag, unitCode: 'box', size: 10_000, sellingPrice: null };
      const pack = { ...box, unitCode: 'pack', size: 6_000 };
      const item = await create(a, { stockUnit: 'piece', mrp: null, packs: [box, pack] });
      const [first, second] = item.packs;
      // Swap the two packs' units.
      const swapped = await call<ItemView>(
        'PUT',
        `/items/${item.id}`,
        a,
        asUpdate(item, {
          packs: [
            { ...box, id: first?.id, unitCode: second?.unitCode },
            { ...pack, id: second?.id, unitCode: first?.unitCode },
          ],
        }),
      );
      expect(swapped.status).toBe(200);
      expect(swapped.body.packs.map((row) => [row.id, row.unitCode])).toEqual([
        [first?.id, second?.unitCode],
        [second?.id, first?.unitCode],
      ]);
      // A new pack takes a unit that an existing pack is leaving, listed first.
      const moved = await call<ItemView>(
        'PUT',
        `/items/${item.id}`,
        a,
        asUpdate(swapped.body, {
          packs: [
            { ...box, unitCode: 'box', size: 20_000 },
            { ...box, id: first?.id, unitCode: 'dozen', size: 12_000 },
            { ...pack, id: second?.id, unitCode: 'pack' },
          ],
        }),
      );
      expect(moved.status).toBe(200);
      expect(moved.body.packs.map((row) => row.unitCode).sort()).toEqual(['box', 'dozen', 'pack']);
    });

    it('sets a level back to 0 when a branch is left out', async () => {
      const item = await create(a, { levels: [{ branchId: aBranch, lowStockLevel: 2_000 }] });
      const saved = await call<ItemView>(
        'PUT',
        `/items/${item.id}`,
        a,
        asUpdate(item, { levels: [] }),
      );
      expect(saved.body.levels).toEqual([{ branchId: aBranch, lowStockLevel: 0 }]);
    });

    it('archives and restores, refusing a restore whose name was taken meanwhile', async () => {
      const item = await create(a, { name: 'Maggi' });
      expect(await call('POST', `/items/${item.id}/archive`, a)).toMatchObject({
        status: 200,
        body: { archived: true },
      });
      expect(await call('PUT', `/items/${item.id}`, a, asUpdate(item, { version: 2 }))).toEqual({
        status: 409,
        body: { code: 'archived' },
      });
      const other = await create(a, { name: 'maggi' });
      expect(await call('POST', `/items/${item.id}/restore`, a)).toEqual({
        status: 409,
        body: { code: 'name_taken' },
      });
      await call('POST', `/items/${other.id}/archive`, a);
      expect(await call('POST', `/items/${item.id}/restore`, a)).toMatchObject({
        status: 200,
        body: { archived: false },
      });
      expect((await entries(item.id)).map((row) => row.action)).toEqual([
        'item.created',
        'item.archived',
        'item.restored',
      ]);
    });

    it('answers 404 for an unknown or malformed id, and for another business’s item', async () => {
      const theirs = await create(b);
      for (const id of [crypto.randomUUID(), 'not-a-uuid', theirs.id]) {
        expect(await call('GET', `/items/${id}`, a)).toEqual({
          status: 404,
          body: { code: 'not_found' },
        });
      }
    });
  });

  describe('barcodes (Module 01 #8)', () => {
    it('finds the item a code is on, and says unknown otherwise', async () => {
      const item = await create(a, { barcodes: ['8900000000001'] });
      expect(await call('GET', '/items/barcode/8900000000001', a)).toMatchObject({
        status: 200,
        body: { item: { id: item.id }, packId: null },
      });
      expect(await call('GET', '/items/barcode/0000', a)).toEqual({
        status: 404,
        body: { code: 'unknown_barcode' },
      });
      // Business B can't see A's code.
      expect((await call('GET', '/items/barcode/8900000000001', b)).status).toBe(404);
    });

    it('still finds an archived item, marked archived', async () => {
      const item = await create(a, { barcodes: ['ARCH-123'] });
      await call('POST', `/items/${item.id}/archive`, a);
      expect(await call('GET', '/items/barcode/ARCH-123', a)).toMatchObject({
        status: 200,
        body: { item: { id: item.id, archived: true } },
      });
    });

    it('names the item that already has a code', async () => {
      await create(a, { name: 'Parle-G', barcodes: ['8901719101038'] });
      const other = await create(a);
      expect(
        await call('POST', `/items/${other.id}/barcodes`, a, {
          code: '8901719101038',
          packId: null,
        }),
      ).toEqual({
        status: 409,
        body: { code: 'barcode_taken', barcode: '8901719101038', itemName: 'Parle-G' },
      });
    });

    it('gives one code to one item when two counters add it at once', async () => {
      const [first, second] = [await create(a), await create(a)];
      const results = await Promise.all(
        [first, second].map((item) =>
          call('POST', `/items/${item.id}/barcodes`, a, { code: 'RACE-0001', packId: null }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    });

    it('makes different in-store codes for two counters at once', async () => {
      const [first, second] = [await create(a), await create(a)];
      const results = await Promise.all(
        [first, second].map((item) =>
          call<ItemView>('POST', `/items/${item.id}/barcodes`, a, { code: null, packId: null }),
        ),
      );
      const codes = results.map((result) => result.body.barcodes[0]?.code ?? '');
      expect(results.map((result) => result.status)).toEqual([201, 201]);
      expect(new Set(codes).size).toBe(2);
      for (const code of codes) expect(inStoreSerial(code)).not.toBeNull();
      expect(results[0]?.body.barcodes[0]?.inStore).toBe(true);
    });

    it("counts only codes the app made as in-store, and never makes one that's taken", async () => {
      const item = await create(a);
      const made = await call<ItemView>('POST', `/items/${item.id}/barcodes`, a, {
        code: null,
        packId: null,
      });
      const serial = inStoreSerial(made.body.barcodes[0]?.code ?? '') ?? 0;
      // Typed (or scanned) codes that look like ours: the next serial, and the highest there is.
      const typed = await create(a, {
        barcodes: [inStoreBarcode(serial + 1), inStoreBarcode(99_999_999_999)],
      });
      expect(typed.barcodes.map((code) => code.inStore)).toEqual([false, false]);
      const next = await call<ItemView>('POST', `/items/${item.id}/barcodes`, a, {
        code: null,
        packId: null,
      });
      expect(next.status).toBe(201);
      expect(next.body.barcodes.map((code) => inStoreSerial(code.code))).toEqual([
        serial,
        serial + 2,
      ]);
    });

    it("won't remove a code from an archived item", async () => {
      const item = await create(a, { barcodes: ['ARCH-0001'] });
      await call('POST', `/items/${item.id}/archive`, a);
      expect(
        await call('POST', `/items/${item.id}/barcodes/${item.barcodes[0]?.id ?? ''}/remove`, a),
      ).toEqual({ status: 409, body: { code: 'archived' } });
    });

    it('removes a code and logs it', async () => {
      const item = await create(a, { barcodes: ['GONE-0001'] });
      const barcodeId = item.barcodes[0]?.id ?? '';
      expect(
        await call<ItemView>('POST', `/items/${item.id}/barcodes/${barcodeId}/remove`, a),
      ).toMatchObject({ status: 200, body: { barcodes: [] } });
      expect((await entries(item.id)).at(-1)).toMatchObject({
        action: 'item.barcode_removed',
        before: { code: 'GONE-0001', packId: null },
      });
      expect((await call('POST', `/items/${item.id}/barcodes/${barcodeId}/remove`, a)).status).toBe(
        404,
      );
    });
  });

  describe('the purchase price (Module 01 #1)', () => {
    const cashier = () => staff(a, ['items.view', 'items.manage']);

    it('is left out of every answer for a caller without items.view_cost', async () => {
      const item = await create(a, { barcodes: ['COST-0001'] });
      const read = await call<ItemView>('GET', `/items/${item.id}`, cashier());
      expect(read.body).not.toHaveProperty('purchasePrice');
      const scan = await call<{ item: ItemView }>('GET', '/items/barcode/COST-0001', cashier());
      expect(scan.body.item).not.toHaveProperty('purchasePrice');
      const page = await call<ItemPage>(
        'GET',
        `/items?q=${encodeURIComponent(item.name)}`,
        cashier(),
      );
      expect(page.body.items[0]).not.toHaveProperty('purchasePrice');
      expect(page.body.items[0]?.id).toBe(item.id);
    });

    it("can't be set without the permission, and an edit without it keeps the stored one", async () => {
      expect(await call('POST', '/items', cashier(), { ...atta, name: 'Sneaky' })).toEqual({
        status: 403,
        body: { code: 'forbidden' },
      });
      const item = await create(a);
      const body = asUpdate(item, { sellingPrice: 5_100 });
      delete body.purchasePrice;
      expect((await call('PUT', `/items/${item.id}`, cashier(), body)).status).toBe(200);
      expect((await call<ItemView>('GET', `/items/${item.id}`, a)).body.purchasePrice).toBe(4_500);
    });

    it('needs items.manage to change anything', async () => {
      expect(await call('POST', '/items', staff(a, ['items.view']), atta)).toEqual({
        status: 403,
        body: { code: 'forbidden' },
      });
    });
  });

  describe('search', () => {
    let shop: Caller;

    beforeAll(async () => {
      shop = await owner('Search Shop', 'search@example.com', 'unregistered');
      for (const [name, extra] of [
        ['Sugar 1 kg', { code: 'S1' }],
        ['Brown sugar', {}],
        ['Sugarfree Gold', { brand: 'Zydus' }],
        ['Ghee 100% pure', {}],
        ['Ghee 1 litre', { barcodes: ['GHEE-1L'] }],
        ['Old sugar', {}],
      ] as const) {
        await create(shop, { name, ...extra, gstRate: null, hsn: null });
      }
      const old = await call<ItemPage>('GET', '/items?q=Old%20sugar', shop);
      await call('POST', `/items/${old.body.items[0]?.id ?? ''}/archive`, shop);
    });

    const names = async (query: string) =>
      (await call<ItemPage>('GET', `/items?${query}`, shop)).body.items.map((item) => item.name);

    it('puts an exact code first, then names starting with the term, then the rest', async () => {
      expect(await names('q=s1')).toEqual(['Sugar 1 kg']);
      expect(await names('q=sugar')).toEqual(['Sugar 1 kg', 'Sugarfree Gold', 'Brown sugar']);
      expect(await names('q=ghee-1l')).toEqual([]);
      expect(await names('q=GHEE-1L')).toEqual(['Ghee 1 litre']);
      expect(await names('q=zydus')).toEqual(['Sugarfree Gold']);
    });

    it('treats % and _ as letters', async () => {
      expect(await names('q=100%25')).toEqual(['Ghee 100% pure']);
      expect(await names('q=_')).toEqual([]);
    });

    it('shows archived items only when asked', async () => {
      expect(await names('archived=true')).toEqual(['Old sugar']);
    });

    it('pages through everything with no gaps or repeats', async () => {
      const many = await owner('Big Shop', 'big@example.com', 'unregistered');
      const created = new Set<string>();
      for (let i = 0; i < 55; i += 1) {
        created.add(
          (await create(many, { gstRate: null, hsn: null, name: `Item ${String(i)}` })).id,
        );
      }
      const seen: string[] = [];
      let after: string | null = null;
      let pages = 0;
      do {
        const query: string = after === null ? '' : `?after=${after}`;
        const page: { body: ItemPage } = await call<ItemPage>('GET', `/items${query}`, many);
        seen.push(...page.body.items.map((item) => item.id));
        after = page.body.next;
        pages += 1;
      } while (after !== null);
      expect(pages).toBe(2);
      expect(seen).toHaveLength(55);
      expect(new Set(seen)).toEqual(created);
      // Numbers sort by value: Item 2 before Item 10.
      const first = await call<ItemPage>('GET', '/items', many);
      expect(first.body.items.slice(0, 3).map((item) => item.name)).toEqual([
        'Item 0',
        'Item 1',
        'Item 2',
      ]);
    });

    it('refuses a cursor it did not make, never a 500', async () => {
      const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const id = crypto.randomUUID();
      for (const after of [
        'nonsense',
        cursor([0, 'Atta', '-'.repeat(36)]),
        cursor([2 ** 31, 'Atta', id]),
        cursor([7, 'Atta', id]),
        cursor([0, 'At\u0000ta', id]),
        cursor([0, 'Atta', id, 'extra']),
      ]) {
        expect(await call('GET', `/items?after=${after}`, shop)).toEqual({
          status: 400,
          body: { code: 'invalid_body', fields: { after: 'invalid' } },
        });
      }
    });
  });

  describe('categories and own units', () => {
    it('creates, renames, archives and restores a category, each logged', async () => {
      const created = await call<{ id: string }>('POST', '/categories', a, { name: 'Snacks' });
      expect(created.status).toBe(201);
      expect(await call('POST', '/categories', a, { name: 'SNACKS' })).toEqual({
        status: 409,
        body: { code: 'name_taken' },
      });
      const id = created.body.id;
      await call('PUT', `/categories/${id}`, a, { name: 'Namkeen' });
      await call('POST', `/categories/${id}/archive`, a);
      await call('POST', `/categories/${id}/restore`, a);
      expect((await entries(id)).map((row) => row.action)).toEqual([
        'category.created',
        'category.updated',
        'category.archived',
        'category.restored',
      ]);
      const list = await call<{ name: string }[]>('GET', '/categories', a);
      expect(list.body.map((category) => category.name)).toContain('Namkeen');
    });

    it('refuses a new item in an archived category', async () => {
      const category = await call<{ id: string }>('POST', '/categories', a, { name: 'Old range' });
      await call('POST', `/categories/${category.body.id}/archive`, a);
      expect(
        await call('POST', '/items', a, { ...atta, name: 'Late', categoryId: category.body.id }),
      ).toMatchObject({ status: 400, body: { fields: { categoryId: 'invalid' } } });
    });

    it("uses an own unit's name in a pack", async () => {
      const crate = await call<{ id: string }>('POST', '/units', a, {
        name: 'Crate',
        hindiName: 'क्रेट',
        baseUnit: 'piece',
        defaultSize: 24_000,
      });
      expect(crate.status).toBe(201);
      const item = await create(a, {
        stockUnit: 'piece',
        mrp: null,
        packs: [
          { ...bag, unitCode: null, unitId: crate.body.id, size: 24_000, sellingPrice: null },
        ],
      });
      expect(item.packs[0]).toMatchObject({ unitId: crate.body.id, unitName: 'Crate' });

      // Renaming or archiving the unit changes how the item reads, so P1.13's "changed
      // since" sync must see the item as changed.
      const updatedAt = async () =>
        (
          await admin.pool.query<{ updated_at: Date }>(
            'select updated_at from items where id = $1',
            [item.id],
          )
        ).rows[0]?.updated_at.getTime() ?? 0;
      const before = await updatedAt();
      await call('PUT', `/units/${crate.body.id}`, a, {
        name: 'Big crate',
        hindiName: null,
        baseUnit: 'piece',
        defaultSize: 24_000,
      });
      const renamed = await updatedAt();
      expect(renamed).toBeGreaterThan(before);
      await call('POST', `/units/${crate.body.id}/archive`, a);
      expect(await updatedAt()).toBeGreaterThan(renamed);
    });
  });
});
