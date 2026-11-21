// The customers table's own rules (P1.13 design §7, §11), on a throwaway PostgreSQL. The
// tenancy guard checks its policies, FORCE and keys with every other tenant table.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { customers } from './schema.js';
import { withBusiness, withNewBusiness } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
function failsWith(code: string, constraint: string) {
  return { cause: expect.objectContaining({ code, constraint }) as unknown };
}

const GSTIN = '27AAPFU0939F1ZV';
const b2b = {
  name: 'Ravi',
  gstin: GSTIN,
  legalName: 'Ravi Traders',
  address: '12 MG Road, Pune',
  stateCode: '27',
};

describe('customers table', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  function add(shop: Shop, values: Partial<typeof customers.$inferInsert>) {
    return withBusiness(runtime.db, shop.businessId, async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({ name: 'Sunita', ...values })
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

  it('stores a walk-in name alone and a business customer in full', async () => {
    expect(await add(a, {})).toMatchObject({ businessId: a.businessId, version: 1, phone: null });
    expect(await add(a, b2b)).toMatchObject({ gstin: GSTIN, stateCode: '27' });
  });

  it.each([
    ['an empty name', { name: '' }, 'customers_name_check'],
    ['a short phone', { phone: '98200' }, 'customers_phone_check'],
    ['a lower-case GSTIN', { ...b2b, gstin: GSTIN.toLowerCase() }, 'customers_gstin_check'],
    ['a GSTIN in another state', { ...b2b, stateCode: '09' }, 'customers_gstin_check'],
    ['a GSTIN with no legal name', { ...b2b, legalName: null }, 'customers_gstin_check'],
    ['a GSTIN with no address', { ...b2b, address: null }, 'customers_gstin_check'],
    ['a 5-digit PIN code', { pinCode: '41100' }, 'customers_pin_code_check'],
    ['an unknown state', { stateCode: '00' }, 'customers_state_code_check'],
  ])('refuses %s', async (_, values, constraint) => {
    await expect(add(a, values)).rejects.toMatchObject(failsWith('23514', constraint));
  });

  it('keeps a live phone and GSTIN to one customer per business, until it is archived', async () => {
    const first = await add(a, {
      ...b2b,
      phone: '9820011111',
      gstin: '29AAPFU0939F1ZR',
      stateCode: '29',
    });
    await expect(add(a, { phone: '9820011111' })).rejects.toMatchObject(
      failsWith('23505', 'customers_live_phone_unique'),
    );
    await expect(
      add(a, { ...b2b, gstin: '29AAPFU0939F1ZR', stateCode: '29' }),
    ).rejects.toMatchObject(failsWith('23505', 'customers_live_gstin_unique'));
    // Another business may have the same customer.
    await expect(add(b, { phone: '9820011111' })).resolves.toBeDefined();

    await withBusiness(runtime.db, a.businessId, (tx) =>
      tx
        .update(customers)
        .set({ archivedAt: new Date() })
        .where(sql`${customers.id} = ${first.id}`),
    );
    await expect(add(a, { phone: '9820011111' })).resolves.toBeDefined();
  });
});
