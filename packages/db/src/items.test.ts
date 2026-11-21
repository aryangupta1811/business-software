// Integration test on a throwaway PostgreSQL (ADR 0013): migration 0005's rules hold in the
// database itself, whatever the code above it does (Module 01 #1–3, #8, #16; P1.7 design §4).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { categories, itemBarcodes, itemBranchLevels, items, itemUnits, units } from './schema.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
// 23514 check, 23505 unique, 23503 foreign key.
function failsWith(code: string, constraint?: string) {
  return {
    cause: expect.objectContaining({ code, ...(constraint && { constraint }) }) as unknown,
  };
}

const atta = (overrides: Partial<typeof items.$inferInsert> = {}) => ({
  kind: 'goods',
  name: 'Atta',
  stockUnit: 'kg',
  sellingPrice: 5_200,
  mrp: 5_500,
  gstRate: 500,
  hsn: '1101',
  ...overrides,
});

describe('item tables', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  const inA = <T>(work: (tx: Transaction) => Promise<T>) =>
    withBusiness(runtime.db, a.businessId, work);

  async function addItem(shop: Shop, overrides: Partial<typeof items.$inferInsert> = {}) {
    return withBusiness(runtime.db, shop.businessId, async (tx) => {
      const [row] = await tx
        .insert(items)
        .values({ ...atta(), name: `Item ${crypto.randomUUID()}`, ...overrides })
        .returning();
      if (row === undefined) throw new Error('no row');
      return row;
    });
  }

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    a = await signUp('Shop A');
    b = await signUp('Shop B');
  });

  afterAll(async () => {
    await runtime.close();
    await server.stop();
  });

  describe('items', () => {
    it('stores an item with defaults', async () => {
      const row = await addItem(a);
      expect(row).toMatchObject({
        businessId: a.businessId,
        priceIncludesTax: true,
        version: 1,
        archivedAt: null,
      });
    });

    it.each([
      ['a price above MRP', { sellingPrice: 5_501 }, 'items_mrp_check'],
      ['a wholesale price above MRP', { wholesalePrice: 5_501 }, 'items_mrp_check'],
      ['an MRP with a price before tax', { priceIncludesTax: false }, 'items_mrp_check'],
      ['a negative price', { sellingPrice: -1, mrp: null }, 'items_prices_check'],
      ['an MRP of 0', { mrp: 0, sellingPrice: 0 }, 'items_prices_check'],
      ['a service with an MRP', { kind: 'service', hsn: '998719' }, 'items_service_check'],
      ['a GST rate not in the list', { gstRate: 1200 }, 'items_gst_rate_check'],
      ['a 5-digit HSN', { hsn: '11011' }, 'items_hsn_check'],
      ['an HSN on a service', { kind: 'service', mrp: null }, 'items_hsn_check'],
      ['an unknown unit', { stockUnit: 'crate' }, 'items_stock_unit_check'],
      ['an unknown kind', { kind: 'gift', hsn: null }, 'items_kind_check'],
      ['an empty name', { name: '' }, 'items_name_check'],
      ['a code with a space', { code: 'A B' }, 'items_code_check'],
    ])('refuses %s', async (_, overrides, constraint) => {
      await expect(addItem(a, overrides)).rejects.toMatchObject(failsWith('23514', constraint));
    });

    it('allows a price equal to the MRP, and any price with no MRP', async () => {
      await expect(
        addItem(a, { sellingPrice: 5_500, wholesalePrice: 5_500 }),
      ).resolves.toBeDefined();
      await expect(
        addItem(a, { mrp: null, sellingPrice: 9_999, priceIncludesTax: false }),
      ).resolves.toBeDefined();
    });

    it('allows every rate in GST_RATES, including 1.5% (migration 0010)', async () => {
      for (const gstRate of [0, 25, 150, 300, 500, 1800, 4000]) {
        await expect(
          addItem(a, { gstRate, name: `Rate ${String(gstRate)}` }),
        ).resolves.toBeDefined();
      }
    });

    it('allows a service with a SAC code and no MRP', async () => {
      await expect(
        addItem(a, { kind: 'service', mrp: null, hsn: '998719' }),
      ).resolves.toBeDefined();
    });

    it('refuses two live items with one name, case ignored, until one is archived', async () => {
      const first = await addItem(a, { name: 'Basmati Rice' });
      await expect(addItem(a, { name: 'BASMATI rice' })).rejects.toMatchObject(
        failsWith('23505', 'items_live_name_unique'),
      );
      // Another business may use the name.
      await expect(addItem(b, { name: 'Basmati Rice' })).resolves.toBeDefined();
      await inA((tx) =>
        tx
          .update(items)
          .set({ archivedAt: new Date() })
          .where(sql`${items.id} = ${first.id}`),
      );
      await expect(addItem(a, { name: 'Basmati Rice' })).resolves.toBeDefined();
    });

    it('refuses one short code twice in a business, case ignored', async () => {
      await addItem(a, { code: 'R12' });
      await expect(addItem(a, { code: 'r12' })).rejects.toMatchObject(
        failsWith('23505', 'items_live_code_unique'),
      );
      await expect(addItem(b, { code: 'R12' })).resolves.toBeDefined();
    });

    it("can't use another business's category", async () => {
      const [category] = await withBusiness(runtime.db, b.businessId, (tx) =>
        tx.insert(categories).values({ name: 'Grains' }).returning(),
      );
      await expect(addItem(a, { categoryId: category?.id })).rejects.toMatchObject(
        failsWith('23503', 'items_category_fk'),
      );
    });
  });

  describe('categories and units', () => {
    it('refuses a duplicate live category name, case ignored', async () => {
      await inA((tx) => tx.insert(categories).values({ name: 'Snacks' }));
      await expect(
        inA((tx) => tx.insert(categories).values({ name: 'SNACKS' })),
      ).rejects.toMatchObject(failsWith('23505', 'categories_live_name_unique'));
    });

    it('refuses an own unit named like a built-in one, or of size 0', async () => {
      const crate = { name: 'Crate', baseUnit: 'piece', defaultSize: 24_000 };
      await expect(inA((tx) => tx.insert(units).values(crate))).resolves.toBeDefined();
      await expect(
        inA((tx) => tx.insert(units).values({ ...crate, name: 'Dozen' })),
      ).rejects.toMatchObject(failsWith('23514', 'units_not_built_in_check'));
      await expect(
        inA((tx) => tx.insert(units).values({ ...crate, name: 'Tray', defaultSize: 0 })),
      ).rejects.toMatchObject(failsWith('23514', 'units_default_size_check'));
      await expect(
        inA((tx) => tx.insert(units).values({ ...crate, name: 'Tray', baseUnit: 'crate' })),
      ).rejects.toMatchObject(failsWith('23514', 'units_base_unit_check'));
    });
  });

  describe('packs', () => {
    const bag = { unitCode: 'bag', size: 50_000, soldAsPack: true, boughtAsPack: true };

    it('takes exactly one of a built-in unit and an own unit', async () => {
      const item = await addItem(a);
      const [crate] = await inA((tx) =>
        tx.insert(units).values({ name: 'Sack', baseUnit: 'kg', defaultSize: 25_000 }).returning(),
      );
      await expect(
        inA((tx) => tx.insert(itemUnits).values({ ...bag, itemId: item.id })),
      ).resolves.toBeDefined();
      await expect(
        inA((tx) =>
          tx
            .insert(itemUnits)
            .values({ ...bag, unitCode: null, unitId: crate?.id, itemId: item.id }),
        ),
      ).resolves.toBeDefined();
      await expect(
        inA((tx) =>
          tx
            .insert(itemUnits)
            .values({ ...bag, unitCode: 'box', unitId: crate?.id, itemId: item.id }),
        ),
      ).rejects.toMatchObject(failsWith('23514', 'item_units_one_unit_check'));
      await expect(
        inA((tx) => tx.insert(itemUnits).values({ ...bag, unitCode: null, itemId: item.id })),
      ).rejects.toMatchObject(failsWith('23514', 'item_units_one_unit_check'));
    });

    it('refuses the same unit twice on one item while live', async () => {
      const item = await addItem(a);
      const [first] = await inA((tx) =>
        tx
          .insert(itemUnits)
          .values({ ...bag, itemId: item.id })
          .returning(),
      );
      await expect(
        inA((tx) => tx.insert(itemUnits).values({ ...bag, itemId: item.id })),
      ).rejects.toMatchObject(failsWith('23505', 'item_units_live_unit_unique'));
      await inA((tx) =>
        tx
          .update(itemUnits)
          .set({ archivedAt: new Date() })
          .where(sql`${itemUnits.id} = ${first?.id}`),
      );
      await expect(
        inA((tx) => tx.insert(itemUnits).values({ ...bag, itemId: item.id })),
      ).resolves.toBeDefined();
    });

    it('refuses a size of 0 and a price above its own MRP', async () => {
      const item = await addItem(a);
      await expect(
        inA((tx) => tx.insert(itemUnits).values({ ...bag, size: 0, itemId: item.id })),
      ).rejects.toMatchObject(failsWith('23514', 'item_units_numbers_check'));
      await expect(
        inA((tx) =>
          tx
            .insert(itemUnits)
            .values({ ...bag, sellingPrice: 260_001, mrp: 260_000, itemId: item.id }),
        ),
      ).rejects.toMatchObject(failsWith('23514', 'item_units_mrp_check'));
    });

    it("can't hang a pack on another business's item", async () => {
      const theirs = await addItem(b);
      await expect(
        inA((tx) => tx.insert(itemUnits).values({ ...bag, itemId: theirs.id })),
      ).rejects.toMatchObject(failsWith('23503', 'item_units_item_fk'));
    });
  });

  describe('barcodes', () => {
    it('gives a code to one live item per business, until it is removed', async () => {
      const first = await addItem(a);
      const second = await addItem(a);
      const [code] = await inA((tx) =>
        tx.insert(itemBarcodes).values({ itemId: first.id, code: '8901725181222' }).returning(),
      );
      await expect(
        inA((tx) => tx.insert(itemBarcodes).values({ itemId: second.id, code: '8901725181222' })),
      ).rejects.toMatchObject(failsWith('23505', 'item_barcodes_live_code_unique'));
      // Business B's code is its own.
      const theirs = await addItem(b);
      await expect(
        withBusiness(runtime.db, b.businessId, (tx) =>
          tx.insert(itemBarcodes).values({ itemId: theirs.id, code: '8901725181222' }),
        ),
      ).resolves.toBeDefined();
      await inA((tx) =>
        tx
          .update(itemBarcodes)
          .set({ removedAt: new Date() })
          .where(sql`${itemBarcodes.id} = ${code?.id}`),
      );
      await expect(
        inA((tx) => tx.insert(itemBarcodes).values({ itemId: second.id, code: '8901725181222' })),
      ).resolves.toBeDefined();
    });

    it("refuses a pack that isn't the item's own", async () => {
      const first = await addItem(a);
      const second = await addItem(a);
      const [pack] = await inA((tx) =>
        tx
          .insert(itemUnits)
          .values({
            itemId: first.id,
            unitCode: 'box',
            size: 12_000,
            soldAsPack: true,
            boughtAsPack: false,
          })
          .returning(),
      );
      await expect(
        inA((tx) =>
          tx
            .insert(itemBarcodes)
            .values({ itemId: second.id, itemUnitId: pack?.id, code: 'BOX-1' }),
        ),
      ).rejects.toMatchObject(failsWith('23503', 'item_barcodes_pack_fk'));
      await expect(
        inA((tx) =>
          tx.insert(itemBarcodes).values({ itemId: first.id, itemUnitId: pack?.id, code: 'BOX-1' }),
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a code with spaces or under 4 characters', async () => {
      const item = await addItem(a);
      for (const code of ['12 34', '123']) {
        await expect(
          inA((tx) => tx.insert(itemBarcodes).values({ itemId: item.id, code })),
        ).rejects.toMatchObject(failsWith('23514', 'item_barcodes_code_check'));
      }
    });
  });

  describe('low-stock levels', () => {
    it('one per item per branch, never negative, never at another business', async () => {
      const item = await addItem(a);
      const level = { itemId: item.id, branchId: a.branchId, lowStockLevel: 5_000 };
      await inA((tx) => tx.insert(itemBranchLevels).values(level));
      await expect(inA((tx) => tx.insert(itemBranchLevels).values(level))).rejects.toMatchObject(
        failsWith('23505', 'item_branch_levels_item_branch_unique'),
      );
      const other = await addItem(a);
      await expect(
        inA((tx) =>
          tx.insert(itemBranchLevels).values({ ...level, itemId: other.id, lowStockLevel: -1 }),
        ),
      ).rejects.toMatchObject(failsWith('23514', 'item_branch_levels_level_check'));
      await expect(
        inA((tx) =>
          tx.insert(itemBranchLevels).values({ ...level, itemId: other.id, branchId: b.branchId }),
        ),
      ).rejects.toMatchObject(failsWith('23503', 'item_branch_levels_branch_fk'));
    });
  });

  // ADR 0019's open point: the same order locally and on RDS (check RDS when it next runs).
  it('sorts names with item_name: Latin, then Devanagari, numbers by value, case ignored', async () => {
    const names = [
      'Atta 10 kg',
      'atta 5 kg',
      'आटा',
      'Basmati',
      'बासमती',
      'Amul',
      'अमूल',
      'Atta 2 kg',
    ];
    const { rows } = await runtime.pool.query<{ name: string }>(
      `select name from unnest($1::text[]) as n(name) order by name collate item_name`,
      [names],
    );
    expect(rows.map((row) => row.name)).toEqual([
      'Amul',
      'Atta 2 kg',
      'atta 5 kg',
      'Atta 10 kg',
      'Basmati',
      'अमूल',
      'आटा',
      'बासमती',
    ]);
  });
});
