// Integration test on a throwaway PostgreSQL (ADR 0013) for P1.20's database rules (ADR 0016's
// 2026-11-24 note): the demo flag on a business, and the one cross-business read the one-click
// demo login needs. Nothing here deletes a row: a reset archives the old demo.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { businesses } from './schema.js';
import { withBusiness, withNewBusiness } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code is on `cause`.
// 23505 unique, P0002 raised by our function.
function failsWith(code: string) {
  return { cause: expect.objectContaining({ code }) as unknown };
}

describe('the demo registry', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  /** What signup plus the seed do last: flag the business and put it in the registry. */
  async function makeDemo(shop: Shop): Promise<void> {
    await withBusiness(runtime.db, shop.businessId, async (tx) => {
      await tx.update(businesses).set({ demo: true }).where(eq(businesses.id, shop.businessId));
      await tx.execute(sql`select app_register_demo_business()`);
    });
  }

  const current = async () => {
    const { rows } = await runtime.pool.query<{ business_id: string }>(
      'select business_id from app_find_demo_business()',
    );
    return rows.map((row) => row.business_id);
  };

  const archiveAllBut = async (keep: string) => {
    const { rows } = await runtime.pool.query<{ archived: number }>(
      'select app_archive_demo_businesses($1) as archived',
      [keep],
    );
    return rows[0]?.archived;
  };

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
  });

  afterAll(async () => {
    await runtime.close();
    await server.stop();
  });

  it('starts every business as a real one', async () => {
    const shop = await signUp('Real shop');
    const [row] = await withBusiness(runtime.db, shop.businessId, (tx) =>
      tx.select({ demo: businesses.demo }).from(businesses),
    );
    expect(row?.demo).toBe(false);
    expect(await current()).toEqual([]);
  });

  it("refuses to register a business that isn't flagged as a demo", async () => {
    const shop = await signUp('Not a demo');
    await expect(
      withBusiness(runtime.db, shop.businessId, (tx) =>
        tx.execute(sql`select app_register_demo_business()`),
      ),
    ).rejects.toMatchObject(failsWith('P0002'));
  });

  it("can't register a business with none set", async () => {
    await expect(runtime.pool.query('select app_register_demo_business()')).rejects.toMatchObject({
      code: 'P0002',
    });
  });

  it('finds the newest demo with no business set, and answers only its ID and time', async () => {
    const first = await signUp('Demo one');
    await makeDemo(first);
    const second = await signUp('Demo two');
    await makeDemo(second);
    const { rows } = await runtime.pool.query('select * from app_find_demo_business()');
    expect(rows).toEqual([
      { business_id: second.businessId, created_at: expect.any(Date) as Date },
    ]);
  });

  it('registers a demo once', async () => {
    const shop = await signUp('Demo twice');
    await makeDemo(shop);
    await expect(
      withBusiness(runtime.db, shop.businessId, (tx) =>
        tx.execute(sql`select app_register_demo_business()`),
      ),
    ).rejects.toMatchObject(failsWith('23505'));
  });

  it('archives the older demos and keeps the one named, deleting nothing', async () => {
    const old = await signUp('Old demo');
    await makeDemo(old);
    const fresh = await signUp('Fresh demo');
    await makeDemo(fresh);
    expect(await archiveAllBut(fresh.businessId)).toBeGreaterThan(0);
    expect(await current()).toEqual([fresh.businessId]);
    // The old business and its rows are all still there.
    const [kept] = await withBusiness(runtime.db, old.businessId, (tx) =>
      tx.select({ name: businesses.name }).from(businesses),
    );
    expect(kept?.name).toBe('Old demo');
    // A second run has nothing left to archive.
    expect(await archiveAllBut(fresh.businessId)).toBe(0);
  });

  it('keeps app_runtime out of the registry table', async () => {
    await expect(runtime.pool.query('select * from auth.demo_businesses')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.pool.query('delete from auth.demo_businesses')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
