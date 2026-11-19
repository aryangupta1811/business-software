// Integration test on a throwaway PostgreSQL (ADR 0013): the stock ledger (P1.8 design §4–7).
// The tables' own rules hold whatever the code does, and moveStock is the one write path.
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { items, itemStock, stockMovements } from './schema.js';
import { findStockMismatches, moveStock, StockRuleError, type MoveStockInput } from './stock.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
function failsWith(code: string, constraint?: string) {
  return {
    cause: expect.objectContaining({ code, ...(constraint && { constraint }) }) as unknown,
  };
}

const ruleError = (code: string) => expect.objectContaining({ code }) as unknown;

describe('stock ledger', () => {
  let server: TestDatabase;
  let runtime: Database;
  let admin: Pool;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  const inShop = <T>(shop: Shop, work: (tx: Transaction) => Promise<T>) =>
    withBusiness(runtime.db, shop.businessId, work);

  async function addItem(shop: Shop, overrides: Partial<typeof items.$inferInsert> = {}) {
    const [row] = await inShop(shop, (tx) =>
      tx
        .insert(items)
        .values({
          kind: 'goods',
          name: `Item ${crypto.randomUUID()}`,
          stockUnit: 'kg',
          sellingPrice: 5_200,
          purchasePrice: 4_000,
          ...overrides,
        })
        .returning({ id: items.id }),
    );
    if (row === undefined) throw new Error('no row');
    return row.id;
  }

  /** One call of moveStock at the shop's branch, as its owner, on 2026-11-20. */
  function move(
    shop: Shop,
    lines: MoveStockInput['lines'],
    options: Partial<MoveStockInput> = {},
    database: Database = runtime,
  ) {
    return withBusiness(database.db, shop.businessId, (tx) =>
      moveStock(tx, {
        branchId: shop.branchId,
        actorId: shop.ownerId,
        businessDate: '2026-11-20',
        belowZero: 'refuse',
        lines,
        ...options,
      }),
    );
  }

  const open = (shop: Shop, itemId: string, quantity: number, unitCost?: number | null) =>
    move(shop, [
      { itemId, kind: 'opening', quantity, ...(unitCost !== undefined && { unitCost }) },
    ]);

  const adjust = (
    shop: Shop,
    itemId: string,
    quantity: number,
    options: Partial<MoveStockInput> = {},
    unitCost?: number,
  ) =>
    move(
      shop,
      [
        {
          itemId,
          kind: 'adjustment',
          quantity,
          reason: quantity > 0 ? 'count_mismatch' : 'damaged',
          ...(unitCost !== undefined && { unitCost }),
        },
      ],
      options,
    );

  async function stockOf(shop: Shop, itemId: string) {
    const [row] = await inShop(shop, (tx) =>
      tx
        .select()
        .from(itemStock)
        .where(sql`${itemStock.itemId} = ${itemId} and ${itemStock.branchId} = ${shop.branchId}`),
    );
    return row;
  }

  const movementsOf = (shop: Shop, itemId: string) =>
    inShop(shop, (tx) =>
      tx
        .select()
        .from(stockMovements)
        .where(sql`${stockMovements.itemId} = ${itemId}`)
        .orderBy(stockMovements.id),
    );

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    admin = new Pool({ connectionString: server.adminUrl });
    a = await signUp('Shop A');
    b = await signUp('Shop B');
  });

  // The ledger's promise: every total equals the sum of its movements and its last balance.
  afterEach(async () => {
    for (const shop of [a, b]) {
      expect(await inShop(shop, (tx) => findStockMismatches(tx))).toEqual([]);
    }
  });

  afterAll(async () => {
    await admin.end();
    await runtime.close();
    await server.stop();
  });

  describe('the tables', () => {
    it('never lets the app change or delete a movement (append-only)', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 5_000, 4_000);
      await expect(
        inShop(a, (tx) => tx.execute(sql`update stock_movements set quantity = 1`)),
      ).rejects.toMatchObject(failsWith('42501'));
      await expect(
        inShop(a, (tx) => tx.execute(sql`delete from stock_movements`)),
      ).rejects.toMatchObject(failsWith('42501'));
      await expect(
        inShop(a, (tx) => tx.execute(sql`delete from item_stock`)),
      ).rejects.toMatchObject(failsWith('42501'));
    });

    const row = (shop: Shop, itemId: string, overrides: Record<string, unknown> = {}) => ({
      branchId: shop.branchId,
      itemId,
      kind: 'adjustment',
      quantity: -1_000,
      balanceAfter: -1_000,
      businessDate: '2026-11-20',
      reason: 'damaged',
      actorId: shop.ownerId,
      ...overrides,
    });

    it.each([
      ['a zero quantity', { quantity: 0 }, 'stock_movements_quantity_check'],
      ['an adjustment without a reason', { reason: null }, 'stock_movements_reason_check'],
      ['an opening with a reason', { kind: 'opening' }, 'stock_movements_reason_check'],
      ['an unknown reason', { reason: 'gift' }, 'stock_movements_reason_check'],
      ['an unknown kind', { kind: 'gift', reason: null }, 'stock_movements_kind_check'],
      ['an empty note', { note: '' }, 'stock_movements_note_check'],
      ['a negative cost', { unitCost: -1 }, 'stock_movements_unit_cost_check'],
    ])('refuses %s', async (_, overrides, constraint) => {
      const itemId = await addItem(a);
      await expect(
        inShop(a, (tx) => tx.insert(stockMovements).values(row(a, itemId, overrides))),
      ).rejects.toMatchObject(failsWith('23514', constraint));
    });

    it("refuses a movement on another business's item, branch or user", async () => {
      const itemOfA = await addItem(a);
      const itemOfB = await addItem(b);
      for (const overrides of [
        { itemId: itemOfA },
        { branchId: a.branchId },
        { actorId: a.ownerId },
      ]) {
        await expect(
          inShop(b, (tx) => tx.insert(stockMovements).values({ ...row(b, itemOfB), ...overrides })),
        ).rejects.toMatchObject(failsWith('23503'));
      }
      await expect(
        inShop(b, (tx) => tx.insert(itemStock).values({ branchId: b.branchId, itemId: itemOfA })),
      ).rejects.toMatchObject(failsWith('23503'));
    });

    it("never shows one business's stock to another", async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 5_000, 4_000);
      const seen = await inShop(b, (tx) =>
        tx
          .select()
          .from(stockMovements)
          .where(sql`${stockMovements.itemId} = ${itemId}`),
      );
      expect(seen).toEqual([]);
      expect(await inShop(b, (tx) => findStockMismatches(tx))).toEqual([]);
    });

    it('refuses a request key used twice in one business, but not across two', async () => {
      const key = crypto.randomUUID();
      const itemOfA = await addItem(a);
      const itemOfB = await addItem(b);
      await adjust(a, itemOfA, 1_000, { requestKey: key });
      await expect(adjust(a, itemOfA, 1_000, { requestKey: key })).rejects.toMatchObject(
        failsWith('23505', 'stock_movements_request_key_unique'),
      );
      await expect(adjust(b, itemOfB, 1_000, { requestKey: key })).resolves.toBeDefined();
    });
  });

  describe('opening stock (Module 01 #9, owner answer 4A)', () => {
    it('sets the stock, the average cost, and logs nothing by itself', async () => {
      const itemId = await addItem(a);
      const result = await open(a, itemId, 12_500, 4_200);
      expect(result).toEqual([
        {
          movementId: expect.any(String) as unknown,
          itemId,
          quantity: 12_500,
          balanceBefore: 0,
          balanceAfter: 12_500,
          unitCost: 4_200,
          value: 52_500,
          averageCost: 4_200,
          warned: false,
        },
      ]);
      expect(await stockOf(a, itemId)).toMatchObject({
        quantity: 12_500,
        averageCost: 4_200,
        lastMovementId: result[0]?.movementId,
      });
      expect(await movementsOf(a, itemId)).toEqual([
        expect.objectContaining({
          kind: 'opening',
          quantity: 12_500,
          unitCost: 4_200,
          value: 52_500,
          balanceAfter: 12_500,
          businessDate: '2026-11-20',
          reason: null,
          actorId: a.ownerId,
        }),
      ]);
    });

    it("takes the item's purchase price when no cost is given", async () => {
      const itemId = await addItem(a, { purchasePrice: 3_900 });
      expect((await open(a, itemId, 1_000))[0]).toMatchObject({ unitCost: 3_900, value: 3_900 });
    });

    it('needs a cost when the item has no purchase price', async () => {
      const itemId = await addItem(a, { purchasePrice: null });
      await expect(open(a, itemId, 1_000)).rejects.toEqual(ruleError('cost_required'));
      await expect(open(a, itemId, 1_000, null)).rejects.toEqual(ruleError('cost_required'));
      expect(await movementsOf(a, itemId)).toEqual([]);
    });

    it('works only while nothing has moved the item at that branch', async () => {
      const opened = await addItem(a);
      await open(a, opened, 1_000, 4_000);
      await expect(open(a, opened, 1_000, 4_000)).rejects.toEqual(ruleError('opening_exists'));

      const adjusted = await addItem(a);
      await adjust(a, adjusted, 2_000);
      await expect(open(a, adjusted, 1_000, 4_000)).rejects.toEqual(ruleError('opening_exists'));
    });

    it('refuses a quantity of zero or less', async () => {
      const itemId = await addItem(a);
      await expect(open(a, itemId, -1_000, 4_000)).rejects.toEqual(ruleError('invalid'));
    });
  });

  describe('adjustments (Module 01 #11)', () => {
    it('values a write-down at the average cost (answer 5A)', async () => {
      const itemId = await addItem(a, { purchasePrice: 9_999 });
      await open(a, itemId, 10_000, 4_000);
      const [line] = await adjust(a, itemId, -2_500);
      expect(line).toMatchObject({
        balanceBefore: 10_000,
        balanceAfter: 7_500,
        unitCost: 4_000,
        value: -10_000,
        averageCost: 4_000,
      });
      expect((await movementsOf(a, itemId))[1]).toMatchObject({
        kind: 'adjustment',
        reason: 'damaged',
        quantity: -2_500,
        value: -10_000,
      });
    });

    it("falls back to the item's purchase price when there is no average", async () => {
      const itemId = await addItem(a, { purchasePrice: 3_000 });
      await adjust(a, itemId, 2_000);
      const [line] = await adjust(a, itemId, -1_000);
      expect(line).toMatchObject({ unitCost: 3_000, value: -3_000 });
    });

    it('records no value when no cost is known at all', async () => {
      const itemId = await addItem(a, { purchasePrice: null });
      const [line] = await adjust(a, itemId, 1_000);
      expect(line).toMatchObject({ unitCost: null, value: null, averageCost: null });
    });

    it('keeps the note, and the business date given', async () => {
      const itemId = await addItem(a);
      await move(
        a,
        [{ itemId, kind: 'adjustment', quantity: 1_000, reason: 'other', note: 'found in back' }],
        { businessDate: '2026-11-19' },
      );
      expect((await movementsOf(a, itemId))[0]).toMatchObject({
        note: 'found in back',
        businessDate: '2026-11-19',
      });
    });
  });

  describe('below zero', () => {
    it('refuses a reduction that ends below zero with "refuse" (answer 2A), writing nothing', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 2_000, 4_000);
      await expect(adjust(a, itemId, -2_001)).rejects.toEqual(ruleError('below_zero'));
      expect(await stockOf(a, itemId)).toMatchObject({ quantity: 2_000 });
      expect(await adjust(a, itemId, -2_000)).toMatchObject([{ balanceAfter: 0 }]);
    });

    it('follows the business switch: block refuses, warn lets it through marked (#12)', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 1_000, 4_000);
      await expect(adjust(a, itemId, -3_000, { belowZero: 'block' })).rejects.toEqual(
        ruleError('below_zero'),
      );
      expect(await adjust(a, itemId, -3_000, { belowZero: 'warn' })).toMatchObject([
        { balanceAfter: -2_000, warned: true },
      ]);
      // Already below zero: adding back is always allowed, and is no warning.
      expect(await adjust(a, itemId, 1_000)).toMatchObject([
        { balanceAfter: -1_000, warned: false },
      ]);
      // Taking more from negative stock is still below zero.
      await expect(adjust(a, itemId, -1_000)).rejects.toEqual(ruleError('below_zero'));
    });
  });

  describe('average cost (Module 01 #4), per branch', () => {
    it('weighs stock in at a new cost, and restarts after stock ran out', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 10_000, 4_000);
      // Purchases (P2.1) will bring stock in with their own cost; the helper already does it.
      expect(await adjust(a, itemId, 10_000, {}, 5_000)).toMatchObject([
        { unitCost: 5_000, value: 50_000, averageCost: 4_500 },
      ]);
      expect(await adjust(a, itemId, -20_000)).toMatchObject([
        { unitCost: 4_500, averageCost: 4_500 },
      ]);
      expect(await adjust(a, itemId, 1_000, {}, 6_000)).toMatchObject([{ averageCost: 6_000 }]);
      expect(await stockOf(a, itemId)).toMatchObject({ quantity: 1_000, averageCost: 6_000 });
    });

    it('a count found without a cost comes in at the average and leaves it alone', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 3_000, 4_000);
      expect(await adjust(a, itemId, 1_000)).toMatchObject([
        { unitCost: 4_000, value: 4_000, averageCost: 4_000 },
      ]);
    });
  });

  describe('what can have stock', () => {
    it('refuses an archived item, a service and an unknown item', async () => {
      const archived = await addItem(a, { archivedAt: new Date() });
      await expect(adjust(a, archived, 1_000)).rejects.toEqual(ruleError('archived'));
      const service = await addItem(a, { kind: 'service', hsn: '998719' });
      await expect(adjust(a, service, 1_000)).rejects.toEqual(ruleError('service_has_no_stock'));
      await expect(adjust(a, crypto.randomUUID(), 1_000)).rejects.toEqual(ruleError('not_found'));
      const ofB = await addItem(b);
      await expect(adjust(a, ofB, 1_000)).rejects.toEqual(ruleError('not_found'));
    });

    it('an archived item keeps its stock and history (answer 7A)', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 4_000, 4_000);
      await inShop(a, (tx) =>
        tx
          .update(items)
          .set({ archivedAt: new Date() })
          .where(sql`${items.id} = ${itemId}`),
      );
      expect(await stockOf(a, itemId)).toMatchObject({ quantity: 4_000 });
      expect(await movementsOf(a, itemId)).toHaveLength(1);
    });

    it('counts piece, pair, dozen, box, pack and bag whole (answer 6A)', async () => {
      const pieces = await addItem(a, { stockUnit: 'piece' });
      await expect(adjust(a, pieces, 1_500)).rejects.toEqual(ruleError('whole_units_only'));
      await expect(adjust(a, pieces, 2_000)).resolves.toBeDefined();
      const loose = await addItem(a, { stockUnit: 'kg' });
      await expect(adjust(a, loose, 250)).resolves.toBeDefined();
    });
  });

  describe('one call, several lines', () => {
    it('chains balances for an item that appears twice, in the order given', async () => {
      const x = await addItem(a);
      const y = await addItem(a);
      const result = await move(a, [
        { itemId: y, kind: 'adjustment', quantity: 3_000, reason: 'count_mismatch' },
        { itemId: x, kind: 'adjustment', quantity: 2_000, reason: 'count_mismatch' },
        { itemId: y, kind: 'adjustment', quantity: -1_000, reason: 'damaged' },
      ]);
      expect(result.map((line) => [line.itemId, line.balanceBefore, line.balanceAfter])).toEqual([
        [y, 0, 3_000],
        [x, 0, 2_000],
        [y, 3_000, 2_000],
      ]);
      expect(await stockOf(a, y)).toMatchObject({
        quantity: 2_000,
        lastMovementId: result[2]?.movementId,
      });
    });

    it('writes nothing when any line breaks a rule', async () => {
      const x = await addItem(a);
      const y = await addItem(a, { stockUnit: 'piece' });
      await expect(
        move(a, [
          { itemId: x, kind: 'adjustment', quantity: 1_000, reason: 'count_mismatch' },
          { itemId: y, kind: 'adjustment', quantity: 500, reason: 'count_mismatch' },
        ]),
      ).rejects.toBeInstanceOf(StockRuleError);
      expect(await movementsOf(a, x)).toEqual([]);
    });

    it('takes a request key only for a single line', async () => {
      const x = await addItem(a);
      await expect(
        move(
          a,
          [
            { itemId: x, kind: 'adjustment', quantity: 1_000, reason: 'count_mismatch' },
            { itemId: x, kind: 'adjustment', quantity: 1_000, reason: 'count_mismatch' },
          ],
          { requestKey: crypto.randomUUID() },
        ),
      ).rejects.toThrow('one line');
    });
  });

  // Product overview NFR 3: two counters at once must never leave stock silently wrong.
  describe('two counters at once', () => {
    it('applies 20 simultaneous changes to one item exactly, in an unbroken chain', async () => {
      const itemId = await addItem(a, { stockUnit: 'piece' });
      await open(a, itemId, 5_000, 1_000);
      await Promise.all(Array.from({ length: 20 }, () => adjust(a, itemId, 1_000)));
      expect(await stockOf(a, itemId)).toMatchObject({ quantity: 25_000 });
      const balances = (await movementsOf(a, itemId)).map((row) => row.balanceAfter);
      expect(balances).toEqual(Array.from({ length: 21 }, (_, index) => 5_000 + index * 1_000));
    });

    it('never deadlocks when two calls move the same items in opposite orders', async () => {
      const x = await addItem(a);
      const y = await addItem(a);
      const lines = (first: string, second: string) => [
        {
          itemId: first,
          kind: 'adjustment' as const,
          quantity: 1_000,
          reason: 'count_mismatch' as const,
        },
        {
          itemId: second,
          kind: 'adjustment' as const,
          quantity: 1_000,
          reason: 'count_mismatch' as const,
        },
      ];
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          index % 2 === 0 ? move(a, lines(x, y)) : move(a, lines(y, x)),
        ),
      );
      expect(await stockOf(a, x)).toMatchObject({ quantity: 10_000 });
      expect(await stockOf(a, y)).toMatchObject({ quantity: 10_000 });
    });

    it('gives up after the lock timeout instead of waiting for ever (ADR 0041)', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 1_000, 4_000);
      const impatient = createDatabase(server.runtimeUrl, vi.fn(), {
        lockTimeoutMs: 200,
        statementTimeoutMs: 5_000,
        idleInTransactionTimeoutMs: 5_000,
      });
      const holder = await admin.connect();
      try {
        // Another counter holds the row, mid-bill.
        await holder.query('begin');
        await holder.query('select 1 from item_stock where item_id = $1 for update', [itemId]);
        const line = {
          itemId,
          kind: 'adjustment' as const,
          quantity: 1_000,
          reason: 'count_mismatch' as const,
        };
        await expect(move(a, [line], {}, impatient)).rejects.toMatchObject(failsWith('55P03'));
        // The connection went back to the pool, and nothing was written.
        expect(impatient.pool.idleCount).toBe(impatient.pool.totalCount);
      } finally {
        await holder.query('rollback');
        holder.release();
        await impatient.close();
      }
      expect(await stockOf(a, itemId)).toMatchObject({ quantity: 1_000 });
    });
  });
});
