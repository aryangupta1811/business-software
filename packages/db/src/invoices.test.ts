import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { takeInvoiceSequence } from './invoices.js';
import { branches } from './schema.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, testBranch, type TestDatabase } from './testing.js';

describe('takeInvoiceSequence (ADR 0007 rule 5)', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));
  const inShop = <T>(shop: Shop, work: (tx: Transaction) => Promise<T>) =>
    withBusiness(runtime.db, shop.businessId, work);
  const take = (shop: Shop, branchId: string, financialYear = '2026-27') =>
    inShop(shop, (tx) => takeInvoiceSequence(tx, { branchId, financialYear }));

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

  it('starts each branch and year at 1 and counts up', async () => {
    expect(await take(a, a.branchId)).toBe(1);
    expect(await take(a, a.branchId)).toBe(2);
    expect(await take(a, a.branchId, '2027-28')).toBe(1);
    // Another business has its own series.
    expect(await take(b, b.branchId)).toBe(1);
  });

  it('gives a number back when the bill rolls back: no gaps', async () => {
    const shop = await signUp('Rollback');
    await expect(
      inShop(shop, async (tx) => {
        expect(
          await takeInvoiceSequence(tx, { branchId: shop.branchId, financialYear: '2026-27' }),
        ).toBe(1);
        throw new Error('the save failed after taking its number');
      }),
    ).rejects.toThrow('the save failed');
    expect(await take(shop, shop.branchId)).toBe(1);
  });

  it('never gives two counters the same number, and leaves no gap', async () => {
    const shop = await signUp('Busy');
    const numbers = await Promise.all(Array.from({ length: 20 }, () => take(shop, shop.branchId)));
    expect([...numbers].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("doesn't make one branch wait for another's open bill", async () => {
    const shop = await signUp('Two shops');
    const other = await inShop(shop, async (tx) => {
      const [row] = await tx
        .insert(branches)
        .values(testBranch(shop.businessId, 'Andheri', 'AND'))
        .returning({ id: branches.id });
      if (row === undefined) throw new Error('no row');
      return row.id;
    });
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The head office's bill holds its counter row open...
    const slow = inShop(shop, async (tx) => {
      const number = await takeInvoiceSequence(tx, {
        branchId: shop.branchId,
        financialYear: '2026-27',
      });
      await held;
      return number;
    });
    // ...while Andheri numbers its own bill straight away.
    expect(await take(shop, other)).toBe(1);
    release();
    expect(await slow).toBe(1);
  });
});
