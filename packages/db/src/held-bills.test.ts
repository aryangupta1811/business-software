// The held bills and owner approvals tables' own rules (P1.13 design §6, §9, §11), on a
// throwaway PostgreSQL. The tenancy guard checks their policies, FORCE and keys.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { heldBills, ownerApprovals } from './schema.js';
import { withBusiness, withNewBusiness } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
function failsWith(code: string, constraint: string) {
  return { cause: expect.objectContaining({ code, constraint }) as unknown };
}

describe('held bills and owner approvals', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  function hold(shop: Shop, values: Partial<typeof heldBills.$inferInsert> = {}) {
    return withBusiness(runtime.db, shop.businessId, async (tx) => {
      const [row] = await tx
        .insert(heldBills)
        .values({
          branchId: shop.branchId,
          billKey: crypto.randomUUID(),
          draft: { lines: [] },
          totalPaise: 14_100,
          lineCount: 2,
          heldBy: shop.ownerId,
          ...values,
        })
        .returning();
      if (row === undefined) throw new Error('no row');
      return row;
    });
  }

  function approve(shop: Shop, values: Partial<typeof ownerApprovals.$inferInsert> = {}) {
    return withBusiness(runtime.db, shop.businessId, async (tx) => {
      const [row] = await tx
        .insert(ownerApprovals)
        .values({
          branchId: shop.branchId,
          billKey: crypto.randomUUID(),
          kind: 'discount',
          lineBasisPoints: 1_500,
          billBasisPoints: 500,
          requestedBy: shop.ownerId,
          approvedBy: shop.ownerId,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          ...values,
        })
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

  it('stores a held bill, open', async () => {
    expect(await hold(a, { label: 'blue shirt' })).toMatchObject({
      businessId: a.businessId,
      resumedAt: null,
      discardedAt: null,
      closedBy: null,
    });
  });

  it('closes a held bill one way only, and always says who closed it', async () => {
    const now = new Date();
    for (const values of [
      { resumedAt: now, discardedAt: now, closedBy: a.ownerId },
      { resumedAt: now },
      { closedBy: a.ownerId },
    ]) {
      await expect(hold(a, values)).rejects.toMatchObject(
        failsWith('23514', 'held_bills_closed_check'),
      );
    }
    await expect(hold(a, { discardedAt: now, closedBy: a.ownerId })).resolves.toBeDefined();
  });

  it.each([
    ['an empty label', { label: '' }, 'held_bills_label_check'],
    ['no lines', { lineCount: 0 }, 'held_bills_numbers_check'],
  ])('refuses %s', async (_, values, constraint) => {
    await expect(hold(a, values)).rejects.toMatchObject(failsWith('23514', constraint));
  });

  it('keeps one open copy of a bill, and allows it again once closed', async () => {
    const first = await hold(a);
    await expect(hold(a, { billKey: first.billKey })).rejects.toMatchObject(
      failsWith('23505', 'held_bills_open_bill_key_unique'),
    );
    await withBusiness(runtime.db, a.businessId, (tx) =>
      tx
        .update(heldBills)
        .set({ resumedAt: new Date(), closedBy: a.ownerId })
        .where(sql`${heldBills.id} = ${first.id}`),
    );
    await expect(hold(a, { billKey: first.billKey })).resolves.toBeDefined();
  });

  it("refuses a held bill for another business's branch", async () => {
    await expect(hold(a, { branchId: b.branchId })).rejects.toMatchObject(
      failsWith('23503', 'held_bills_branch_fk'),
    );
  });

  it('stores an approval, and refuses an unknown kind, a share over 100% or no expiry', async () => {
    expect(await approve(a)).toMatchObject({ usedAt: null, kind: 'discount' });
    await expect(approve(a, { kind: 'credit_limit' })).rejects.toMatchObject(
      failsWith('23514', 'owner_approvals_kind_check'),
    );
    await expect(approve(a, { billBasisPoints: 10_001 })).rejects.toMatchObject(
      failsWith('23514', 'owner_approvals_shares_check'),
    );
    await expect(approve(a, { expiresAt: new Date(Date.now() - 1_000) })).rejects.toMatchObject(
      failsWith('23514', 'owner_approvals_expiry_check'),
    );
  });

  it("refuses an approval by another business's owner", async () => {
    await expect(approve(a, { approvedBy: b.ownerId })).rejects.toMatchObject(
      failsWith('23503', 'owner_approvals_approved_by_fk'),
    );
  });
});
