// Integration test on a throwaway PostgreSQL (ADR 0013): the alert tables' own rules, and alerts
// raised and cleared in the same transaction as the stock change (P2.7 design §4, §8; ADR 0046).
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { syncStockAlerts } from './alerts.js';
import { createDatabase, type Database } from './client.js';
import {
  alertDismissals,
  alerts,
  itemBranchLevels,
  items,
  itemStock,
  stockMovements,
} from './schema.js';
import { moveStock, type MoveStockInput } from './stock.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

function failsWith(code: string, constraint?: string) {
  return {
    cause: expect.objectContaining({ code, ...(constraint && { constraint }) }) as unknown,
  };
}

describe('alerts', () => {
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

  async function addItem(shop: Shop, level?: number) {
    return inShop(shop, async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({
          kind: 'goods',
          name: `Item ${crypto.randomUUID()}`,
          stockUnit: 'kg',
          sellingPrice: 5_200,
          purchasePrice: 4_000,
        })
        .returning({ id: items.id });
      if (row === undefined) throw new Error('no row');
      if (level !== undefined) {
        await tx
          .insert(itemBranchLevels)
          .values({ itemId: row.id, branchId: shop.branchId, lowStockLevel: level });
      }
      return row.id;
    });
  }

  let branches = 1;

  /** A second branch of the shop, made as the administrator. Its code is unique per business. */
  async function addBranch(shop: Shop): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      'insert into branches (business_id, name, state_code, code) values ($1, $2, $3, $4) returning id',
      [shop.businessId, `Branch ${crypto.randomUUID()}`, '27', `B${String(++branches)}`],
    );
    return rows[0]?.id ?? '';
  }

  /** What the items service does when a level is saved: write it, then sync. */
  const setLevel = (shop: Shop, itemId: string, level: number, branchId = shop.branchId) =>
    inShop(shop, async (tx) => {
      await tx
        .insert(itemBranchLevels)
        .values({ itemId, branchId, lowStockLevel: level })
        .onConflictDoUpdate({
          target: [itemBranchLevels.businessId, itemBranchLevels.itemId, itemBranchLevels.branchId],
          set: { lowStockLevel: level },
        });
      await syncStockAlerts(tx, { itemIds: [itemId], branchId });
    });

  const moveInput = (
    shop: Shop,
    lines: MoveStockInput['lines'],
    options: Partial<MoveStockInput> = {},
  ): MoveStockInput => ({
    branchId: shop.branchId,
    actorId: shop.ownerId,
    businessDate: '2026-11-22',
    belowZero: 'warn',
    lines,
    ...options,
  });

  const move = (
    shop: Shop,
    lines: MoveStockInput['lines'],
    options: Partial<MoveStockInput> = {},
  ) => inShop(shop, (tx) => moveStock(tx, moveInput(shop, lines, options)));

  const open = (shop: Shop, itemId: string, quantity: number) =>
    move(shop, [{ itemId, kind: 'opening', quantity, unitCost: 4_000 }]);
  const takeOut = (shop: Shop, itemId: string, quantity: number) =>
    move(shop, [{ itemId, kind: 'adjustment', quantity: -quantity, reason: 'damaged' }]);
  const putBack = (shop: Shop, itemId: string, quantity: number) =>
    move(shop, [{ itemId, kind: 'adjustment', quantity, reason: 'count_mismatch' }]);

  const alertsOf = (shop: Shop, itemId: string) =>
    inShop(shop, (tx) =>
      tx.select().from(alerts).where(eq(alerts.subjectId, itemId)).orderBy(alerts.id),
    );
  const openAlertsOf = async (shop: Shop, itemId: string) =>
    (await alertsOf(shop, itemId)).filter((row) => row.clearedAt === null);

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    admin = new Pool({ connectionString: server.adminUrl });
    a = await signUp('Shop A');
    b = await signUp('Shop B');
  });

  afterAll(async () => {
    await admin.end();
    await runtime.close();
    await server.stop();
  });

  describe('the tables', () => {
    const raw = (shop: Shop, itemId: string, over: Partial<typeof alerts.$inferInsert> = {}) => ({
      branchId: shop.branchId,
      type: 'low_stock',
      family: 'stock',
      subjectType: 'item',
      subjectId: itemId,
      details: { quantity: 1_000, level: 5_000 },
      ...over,
    });

    it('refuses a second open stock alert for the same item and branch, either type', async () => {
      const itemId = await addItem(a);
      await inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId)));
      for (const type of ['low_stock', 'out_of_stock']) {
        await expect(
          inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId, { type }))),
        ).rejects.toMatchObject(failsWith('23505', 'alerts_open_unique'));
      }
    });

    it('allows a new open alert once the old one is cleared, and one per branch', async () => {
      const itemId = await addItem(a);
      const second = await addBranch(a);
      await inShop(a, async (tx) => {
        await tx.insert(alerts).values({ ...raw(a, itemId), clearedAt: new Date() });
        await tx.insert(alerts).values(raw(a, itemId));
        await tx.insert(alerts).values(raw(a, itemId, { branchId: second }));
      });
      expect(await alertsOf(a, itemId)).toHaveLength(3);
    });

    it("refuses another business's branch, a wrong type and family pair and an unknown subject", async () => {
      const itemId = await addItem(a);
      await expect(
        inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId, { branchId: b.branchId }))),
      ).rejects.toMatchObject(failsWith('23503', 'alerts_branch_fk'));
      await expect(
        inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId, { family: 'money' }))),
      ).rejects.toMatchObject(failsWith('23514', 'alerts_type_family_check'));
      await expect(
        inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId, { type: 'nope' }))),
      ).rejects.toMatchObject(failsWith('23514', 'alerts_type_family_check'));
      await expect(
        inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId, { subjectType: 'x' }))),
      ).rejects.toMatchObject(failsWith('23514', 'alerts_subject_type_check'));
    });

    it('never lets the app delete an alert or a dismissal', async () => {
      const itemId = await addItem(a);
      const [alert] = await inShop(a, (tx) =>
        tx.insert(alerts).values(raw(a, itemId)).returning({ id: alerts.id }),
      );
      await inShop(a, (tx) =>
        tx.insert(alertDismissals).values({ alertId: alert?.id ?? '', userId: a.ownerId }),
      );
      await expect(inShop(a, (tx) => tx.delete(alerts))).rejects.toMatchObject(failsWith('42501'));
      await expect(inShop(a, (tx) => tx.delete(alertDismissals))).rejects.toMatchObject(
        failsWith('42501'),
      );
    });

    it("keeps one dismissal per alert and person, of the business's own alert and people", async () => {
      const itemId = await addItem(a);
      const [alert] = await inShop(a, (tx) =>
        tx.insert(alerts).values(raw(a, itemId)).returning({ id: alerts.id }),
      );
      const alertId = alert?.id ?? '';
      await inShop(a, (tx) => tx.insert(alertDismissals).values({ alertId, userId: a.ownerId }));
      await expect(
        inShop(a, (tx) => tx.insert(alertDismissals).values({ alertId, userId: a.ownerId })),
      ).rejects.toMatchObject(failsWith('23505', 'alert_dismissals_alert_user_unique'));
      await expect(
        inShop(a, (tx) => tx.insert(alertDismissals).values({ alertId, userId: b.ownerId })),
      ).rejects.toMatchObject(failsWith('23503', 'alert_dismissals_user_fk'));
      await expect(
        inShop(b, (tx) => tx.insert(alertDismissals).values({ alertId, userId: b.ownerId })),
      ).rejects.toMatchObject(failsWith('23503', 'alert_dismissals_alert_fk'));
    });

    it('shows a business only its own alerts', async () => {
      const itemId = await addItem(a);
      await inShop(a, (tx) => tx.insert(alerts).values(raw(a, itemId)));
      expect(await inShop(b, (tx) => tx.select().from(alerts))).toEqual([]);
    });

    it('starts a business with every alert type switched on, and refuses an unknown one', async () => {
      const read = await inShop(a, (tx) =>
        tx.execute<{ alert_types: string[] }>(sql`select alert_types from businesses`),
      );
      expect(read.rows[0]?.alert_types).toEqual(['low_stock', 'out_of_stock']);
      await expect(
        inShop(a, (tx) => tx.execute(sql`update businesses set alert_types = array['nope']`)),
      ).rejects.toMatchObject(failsWith('23514', 'businesses_alert_types_check'));
    });
  });

  describe('through moveStock', () => {
    it('raises one alert when a movement crosses the level, and no second one under it', async () => {
      const itemId = await addItem(a, 5_000);
      await open(a, itemId, 10_000);
      expect(await alertsOf(a, itemId)).toEqual([]);

      await takeOut(a, itemId, 6_000);
      const [first] = await alertsOf(a, itemId);
      expect(first).toMatchObject({
        type: 'low_stock',
        family: 'stock',
        subjectType: 'item',
        branchId: a.branchId,
        details: { quantity: 4_000, level: 5_000 },
        clearedAt: null,
      });

      await takeOut(a, itemId, 1_000);
      const after = await alertsOf(a, itemId);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        id: first?.id,
        type: 'low_stock',
        details: { quantity: 3_000, level: 5_000 },
      });
      expect(after[0]?.raisedAt).toEqual(first?.raisedAt);
    });

    it('changes the same alert to out of stock at 0 and below, and back to low', async () => {
      const itemId = await addItem(a, 5_000);
      await open(a, itemId, 3_000);
      const [low] = await alertsOf(a, itemId);
      expect(low?.type).toBe('low_stock');

      await takeOut(a, itemId, 3_000);
      expect(await alertsOf(a, itemId)).toMatchObject([
        { id: low?.id, type: 'out_of_stock', details: { quantity: 0, level: 5_000 } },
      ]);
      await takeOut(a, itemId, 2_000);
      expect(await alertsOf(a, itemId)).toMatchObject([
        { id: low?.id, type: 'out_of_stock', details: { quantity: -2_000, level: 5_000 } },
      ]);
      await putBack(a, itemId, 6_000);
      expect(await alertsOf(a, itemId)).toMatchObject([
        { id: low?.id, type: 'low_stock', details: { quantity: 4_000, level: 5_000 } },
      ]);
    });

    it('clears above the level, keeps the row, and a later dip raises a new one', async () => {
      const itemId = await addItem(a, 5_000);
      await open(a, itemId, 4_000);
      const [first] = await alertsOf(a, itemId);
      await putBack(a, itemId, 6_000);
      const cleared = await alertsOf(a, itemId);
      expect(cleared).toHaveLength(1);
      expect(cleared[0]?.clearedAt).toBeInstanceOf(Date);
      expect(await openAlertsOf(a, itemId)).toEqual([]);

      await takeOut(a, itemId, 8_000);
      expect(await alertsOf(a, itemId)).toHaveLength(2);
      const [second] = await openAlertsOf(a, itemId);
      expect(second).toMatchObject({ type: 'low_stock' });
      expect(second?.id).not.toBe(first?.id);
    });

    it('gives an item with no level an out-of-stock alert only (#17)', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 2_000);
      expect(await alertsOf(a, itemId)).toEqual([]);
      await takeOut(a, itemId, 2_000);
      expect(await openAlertsOf(a, itemId)).toMatchObject([
        { type: 'out_of_stock', details: { quantity: 0, level: null } },
      ]);
      await putBack(a, itemId, 1_000);
      expect(await openAlertsOf(a, itemId)).toEqual([]);
    });

    it("raises one alert per item of one call, from each item's final stock", async () => {
      const x = await addItem(a, 5_000);
      const y = await addItem(a, 5_000);
      await open(a, x, 20_000);
      await open(a, y, 20_000);
      await move(a, [
        { itemId: x, kind: 'adjustment', quantity: -16_000, reason: 'damaged' },
        { itemId: y, kind: 'adjustment', quantity: -17_000, reason: 'damaged' },
        { itemId: y, kind: 'adjustment', quantity: -2_000, reason: 'damaged' },
      ]);
      expect(await openAlertsOf(a, x)).toMatchObject([{ details: { quantity: 4_000 } }]);
      expect(await openAlertsOf(a, y)).toMatchObject([{ details: { quantity: 1_000 } }]);
    });

    it('rolls the alert back with the stock when the action fails', async () => {
      const itemId = await addItem(a, 5_000);
      await open(a, itemId, 10_000);
      await expect(
        inShop(a, async (tx) => {
          await moveStock(
            tx,
            moveInput(a, [{ itemId, kind: 'adjustment', quantity: -8_000, reason: 'damaged' }]),
          );
          const inside = await tx.select().from(alerts).where(eq(alerts.subjectId, itemId));
          expect(inside).toHaveLength(1);
          throw new Error('the bill failed');
        }),
      ).rejects.toThrow('the bill failed');
      expect(await alertsOf(a, itemId)).toEqual([]);
      const [stock] = await inShop(a, (tx) =>
        tx.select().from(itemStock).where(eq(itemStock.itemId, itemId)),
      );
      expect(stock?.quantity).toBe(10_000);
      const movements = await inShop(a, (tx) =>
        tx.select().from(stockMovements).where(eq(stockMovements.itemId, itemId)),
      );
      expect(movements).toHaveLength(1);
    });

    it("keeps each branch's alert apart", async () => {
      const itemId = await addItem(a, 5_000);
      const otherBranch = await addBranch(a);
      await open(a, itemId, 4_000);
      await move(a, [{ itemId, kind: 'opening', quantity: 50_000, unitCost: 4_000 }], {
        branchId: otherBranch,
      });
      expect(await openAlertsOf(a, itemId)).toMatchObject([{ branchId: a.branchId }]);
      await setLevel(a, itemId, 60_000, otherBranch);
      expect(await openAlertsOf(a, itemId)).toHaveLength(2);
    });
  });

  describe('when the level changes or the item is archived', () => {
    it('raises when the level goes above the stock and clears when it goes under', async () => {
      const itemId = await addItem(a);
      await open(a, itemId, 8_000);
      expect(await alertsOf(a, itemId)).toEqual([]);

      await setLevel(a, itemId, 10_000);
      expect(await openAlertsOf(a, itemId)).toMatchObject([
        { type: 'low_stock', details: { quantity: 8_000, level: 10_000 } },
      ]);
      await setLevel(a, itemId, 12_000);
      expect(await openAlertsOf(a, itemId)).toMatchObject([{ details: { level: 12_000 } }]);

      await setLevel(a, itemId, 2_000);
      expect(await openAlertsOf(a, itemId)).toEqual([]);
      expect(await alertsOf(a, itemId)).toHaveLength(1);
      await setLevel(a, itemId, 0);
      expect(await openAlertsOf(a, itemId)).toEqual([]);
    });

    it('makes no alert for an item nothing has moved at the branch', async () => {
      const itemId = await addItem(a, 5_000);
      await setLevel(a, itemId, 9_000);
      expect(await alertsOf(a, itemId)).toEqual([]);
    });

    it('clears on archive and raises again on restore', async () => {
      const itemId = await addItem(a, 5_000);
      await open(a, itemId, 3_000);
      expect(await openAlertsOf(a, itemId)).toHaveLength(1);
      const setArchived = (archivedAt: Date | null) =>
        inShop(a, async (tx) => {
          await tx.update(items).set({ archivedAt }).where(eq(items.id, itemId));
          await syncStockAlerts(tx, { itemIds: [itemId] });
        });
      await setArchived(new Date());
      expect(await openAlertsOf(a, itemId)).toEqual([]);
      await setArchived(null);
      expect(await openAlertsOf(a, itemId)).toHaveLength(1);
      expect(await alertsOf(a, itemId)).toHaveLength(2);
    });

    it('does nothing for no items', async () => {
      await expect(
        inShop(a, (tx) => syncStockAlerts(tx, { itemIds: [] })),
      ).resolves.toBeUndefined();
    });
  });

  // The promise of raising in the same transaction: no open alert without its condition.
  it('has no open alert whose stock no longer says so (a final audit)', async () => {
    const result = await inShop(a, (tx) =>
      tx.execute<{ subject_id: string }>(sql`
        select al.subject_id
          from alerts al
          join item_stock s on s.item_id = al.subject_id and s.branch_id = al.branch_id
          left join item_branch_levels l on l.item_id = s.item_id and l.branch_id = s.branch_id
         where al.cleared_at is null
           and not ((al.type = 'out_of_stock' and s.quantity <= 0)
                 or (al.type = 'low_stock' and s.quantity > 0
                     and l.low_stock_level > 0 and s.quantity <= l.low_stock_level))`),
    );
    expect(result.rows).toEqual([]);
  });
});
