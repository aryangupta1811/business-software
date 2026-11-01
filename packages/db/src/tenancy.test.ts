// Integration test on a throwaway PostgreSQL (ADR 0013): Row-Level Security must keep each
// business's rows apart even when code asks for someone else's (ADRs 0006, 0027).
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { branches, businesses } from './schema.js';
import { withBusiness, withNewBusiness } from './tenancy.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code is on `cause`.
// 42501 insufficient_privilege (also RLS WITH CHECK), 22P02 invalid text, 23503 foreign key.
function failsWith(code: string) {
  return { cause: expect.objectContaining({ code }) as unknown };
}

const unknownBusiness = '0190f0f0-0000-7000-8000-000000000000';

describe('tenancy', () => {
  let server: TestDatabase;
  let runtime: Database;
  let owner: Pool;
  let a: { businessId: string; branchId: string };
  let b: { businessId: string; branchId: string };

  async function signUp(name: string): Promise<{ businessId: string; branchId: string }> {
    return withNewBusiness(runtime.db, async (tx, businessId) => {
      await tx.insert(businesses).values({ id: businessId, name });
      const [branch] = await tx
        .insert(branches)
        .values({ businessId, name: `${name} main` })
        .returning({ id: branches.id });
      if (branch === undefined) throw new Error('no branch returned');
      return { businessId, branchId: branch.id };
    });
  }

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    owner = new Pool({ connectionString: server.ownerUrl });
    a = await signUp('Shop A');
    b = await signUp('Shop B');
  });

  afterAll(async () => {
    await runtime.close();
    await owner.end();
    await server.stop();
  });

  it('sees only its own business and branches', async () => {
    const seen = await withBusiness(runtime.db, a.businessId, async (tx) => ({
      businesses: await tx.select({ id: businesses.id, name: businesses.name }).from(businesses),
      branches: await tx.select({ id: branches.id }).from(branches),
    }));
    expect(seen).toEqual({
      businesses: [{ id: a.businessId, name: 'Shop A' }],
      branches: [{ id: a.branchId }],
    });
  });

  it("cannot see or update another business's rows", async () => {
    await withBusiness(runtime.db, b.businessId, async (tx) => {
      expect(await tx.select({ id: businesses.id }).from(businesses)).toEqual([
        { id: b.businessId },
      ]);
      expect(await tx.select().from(branches).where(eq(branches.id, a.branchId))).toEqual([]);
      const updated = await tx
        .update(branches)
        .set({ name: 'x' })
        .where(eq(branches.id, a.branchId));
      expect(updated.rowCount).toBe(0);
    });
    const names = await withBusiness(runtime.db, a.businessId, (tx) =>
      tx.select({ name: branches.name }).from(branches),
    );
    expect(names).toEqual([{ name: 'Shop A main' }]);
  });

  it('refuses to insert a row for another business', async () => {
    await expect(
      withBusiness(runtime.db, b.businessId, (tx) =>
        tx.insert(branches).values({ businessId: a.businessId, name: 'sneaky' }),
      ),
    ).rejects.toMatchObject(failsWith('42501'));
  });

  it('refuses to move a row to another business', async () => {
    await expect(
      withBusiness(runtime.db, b.businessId, (tx) =>
        tx.update(branches).set({ businessId: a.businessId }).where(eq(branches.id, b.branchId)),
      ),
    ).rejects.toMatchObject(failsWith('42501'));
  });

  it('shows nothing and refuses inserts when no business is set', async () => {
    expect(await runtime.db.select().from(branches)).toEqual([]);
    await expect(
      runtime.db.insert(businesses).values({ name: 'No business set' }),
    ).rejects.toMatchObject(failsWith('42501'));
  });

  // A transaction-local setting reads back as '' (not NULL) on the same connection after
  // its transaction ends, and ''::uuid throws. One connection makes the reuse certain.
  it('forgets the business when the transaction ends, on the same connection', async () => {
    const pool = new Pool({ connectionString: server.runtimeUrl, max: 1 });
    const db = drizzle(pool);
    try {
      await withBusiness(db, a.businessId, (tx) => tx.select().from(branches));
      expect(await db.select().from(branches)).toEqual([]);

      await expect(
        withBusiness(db, a.businessId, () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      expect(await db.select().from(branches)).toEqual([]);
    } finally {
      await pool.end();
    }
  });

  it.each(['not-a-uuid', ''])(
    'refuses the business ID %j before running any work',
    async (businessId) => {
      const work = vi.fn();
      await expect(withBusiness(runtime.db, businessId, work)).rejects.toMatchObject(
        failsWith('22P02'),
      );
      expect(work).not.toHaveBeenCalled();
    },
  );

  it('keeps concurrent businesses apart', async () => {
    const branchesSeenBy = (businessId: string) =>
      withBusiness(runtime.db, businessId, async (tx) => {
        await tx.execute('select pg_sleep(0.1)');
        return tx.select({ id: branches.id }).from(branches);
      });
    const [seenByA, seenByB] = await Promise.all([
      branchesSeenBy(a.businessId),
      branchesSeenBy(b.businessId),
    ]);
    expect(seenByA).toEqual([{ id: a.branchId }]);
    expect(seenByB).toEqual([{ id: b.branchId }]);
  });

  it('sees nothing for a business that does not exist', async () => {
    await withBusiness(runtime.db, unknownBusiness, async (tx) => {
      expect(await tx.select().from(branches)).toEqual([]);
    });
    await expect(
      withBusiness(runtime.db, unknownBusiness, (tx) =>
        tx.insert(branches).values({ businessId: unknownBusiness, name: 'Orphan' }),
      ),
    ).rejects.toMatchObject(failsWith('23503'));
  });

  it('filters the table owner too (FORCE)', async () => {
    const { rows } = await owner.query('select count(*)::int as n from branches');
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('creates a business with a version-7 UUID', () => {
    expect(a.businessId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it.each(['businesses', 'branches'])('refuses to delete from %s', async (table) => {
    await expect(runtime.pool.query(`delete from ${table}`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('does not accept a transaction in place of the database', async () => {
    await withBusiness(runtime.db, a.businessId, (tx) => {
      const nested = () =>
        // @ts-expect-error a transaction would open a savepoint whose setting outlives it
        withBusiness(tx, b.businessId, () => Promise.resolve());
      expect(typeof nested).toBe('function');
      return Promise.resolve();
    });
  });
});
