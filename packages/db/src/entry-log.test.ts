// Integration test on a throwaway PostgreSQL (ADR 0013): the entry log is append-only, belongs
// to one business, and commits or rolls back with the action it describes (ADRs 0007, 0028).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { recordEntry, type EntryAction, type EntryInput } from './entry-log.js';
import { branches, businesses, entryLog } from './schema.js';
import { withBusiness, withNewBusiness } from './tenancy.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code is on `cause`.
// 42501 insufficient_privilege (also RLS WITH CHECK), 22P02 invalid text, 23503 foreign key.
function failsWith(code: string) {
  return { cause: expect.objectContaining({ code }) as unknown };
}

const adjust = (overrides: Partial<EntryInput> = {}): EntryInput => ({
  actorId: '0190f0f0-0000-7000-8000-00000000a001',
  action: 'stock.adjusted',
  entityType: 'item',
  entityId: '0190f0f0-0000-7000-8000-00000000e001',
  reason: 'Damaged in transit',
  before: { quantity: 10 },
  after: { quantity: 8 },
  ...overrides,
});

describe('entry log', () => {
  let server: TestDatabase;
  let runtime: Database;
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

  const entriesOf = (businessId: string) =>
    withBusiness(runtime.db, businessId, (tx) => tx.select().from(entryLog));

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

  it('records a row with every field', async () => {
    const before = (await entriesOf(a.businessId)).length;
    await withBusiness(runtime.db, a.businessId, (tx) => recordEntry(tx, adjust()));
    await withBusiness(runtime.db, a.businessId, (tx) =>
      recordEntry(tx, adjust({ branchId: a.branchId })),
    );
    const rows = (await entriesOf(a.businessId)).slice(before);
    expect(rows).toEqual([
      {
        ...adjust(),
        id: expect.any(String) as unknown,
        businessId: a.businessId,
        branchId: null,
        createdAt: expect.any(Date) as unknown,
      },
      expect.objectContaining({ branchId: a.branchId }),
    ]);
    expect(Math.abs(Date.now() - (rows[0]?.createdAt.getTime() ?? 0))).toBeLessThan(5_000);
  });

  it('rolls back with the action it describes', async () => {
    const count = (await entriesOf(a.businessId)).length;
    await expect(
      withBusiness(runtime.db, a.businessId, async (tx) => {
        await recordEntry(tx, adjust());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await entriesOf(a.businessId)).toHaveLength(count);
  });

  it('keeps businesses apart', async () => {
    await withBusiness(runtime.db, a.businessId, (tx) => recordEntry(tx, adjust()));
    expect(await entriesOf(b.businessId)).toEqual([]);
    await expect(
      withBusiness(runtime.db, b.businessId, (tx) =>
        tx.insert(entryLog).values({
          businessId: a.businessId,
          action: 'stock.adjusted',
          entityType: 'item',
          entityId: adjust().entityId,
        }),
      ),
    ).rejects.toMatchObject(failsWith('42501'));
  });

  // With no business set, business_id defaults to NULL; the RLS check (NULL = NULL is not
  // true) runs before the NOT NULL check, so this is 42501, not 23502.
  it('fails with no business set', async () => {
    await expect(runtime.db.transaction((tx) => recordEntry(tx, adjust()))).rejects.toMatchObject(
      failsWith('42501'),
    );
  });

  it.each([undefined, '', '   '])('refuses stock.adjusted with reason %j', async (reason) => {
    const count = (await entriesOf(a.businessId)).length;
    const entry = adjust();
    if (reason === undefined) delete entry.reason;
    else entry.reason = reason;
    await expect(
      withBusiness(runtime.db, a.businessId, (tx) => recordEntry(tx, entry)),
    ).rejects.toThrow('Entry action "stock.adjusted" needs a reason');
    expect(await entriesOf(a.businessId)).toHaveLength(count);
  });

  // Every real action today needs a reason, so an action not in ENTRY_ACTIONS stands in for
  // one that doesn't; recordEntry treats an unknown action as reason-optional.
  it('stores a blank optional reason as null', async () => {
    const [row] = await withBusiness(runtime.db, b.businessId, async (tx) => {
      await recordEntry(tx, adjust({ action: 'test.optional' as EntryAction, reason: '  ' }));
      return tx.select({ reason: entryLog.reason }).from(entryLog);
    });
    expect(row).toEqual({ reason: null });
  });

  it.each(['update entry_log set reason = null', 'delete from entry_log', 'truncate entry_log'])(
    'refuses to let the runtime role run %s',
    async (sql) => {
      await expect(runtime.pool.query(sql)).rejects.toMatchObject({ code: '42501' });
    },
  );

  it('refuses a branch from another business', async () => {
    await expect(
      withBusiness(runtime.db, b.businessId, (tx) =>
        recordEntry(tx, adjust({ branchId: a.branchId })),
      ),
    ).rejects.toMatchObject(failsWith('23503'));
  });

  it('refuses a value that cannot become JSON', async () => {
    const count = (await entriesOf(a.businessId)).length;
    await expect(
      withBusiness(runtime.db, a.businessId, (tx) =>
        recordEntry(tx, adjust({ before: { quantity: 10n } })),
      ),
    ).rejects.toThrow(TypeError);
    expect(await entriesOf(a.businessId)).toHaveLength(count);
  });

  it('refuses a malformed actor ID', async () => {
    await expect(
      withBusiness(runtime.db, a.businessId, (tx) =>
        recordEntry(tx, adjust({ actorId: 'staff-1' })),
      ),
    ).rejects.toMatchObject(failsWith('22P02'));
  });

  it('logs at signup once the business exists', async () => {
    await withNewBusiness(runtime.db, async (tx, businessId) => {
      await tx.insert(businesses).values({ id: businessId, name: 'Shop C' });
      await recordEntry(tx, adjust());
    });
    await expect(
      withNewBusiness(runtime.db, (tx) => recordEntry(tx, adjust())),
    ).rejects.toMatchObject(failsWith('23503'));
  });

  it('orders two entries in one transaction by id', async () => {
    const rows = await withBusiness(runtime.db, a.businessId, async (tx) => {
      await recordEntry(tx, adjust({ reason: 'first' }));
      await recordEntry(tx, adjust({ reason: 'second' }));
      return tx.select().from(entryLog);
    });
    // now() is the transaction's start time, so only the UUIDv7 id keeps the order.
    const pair = rows
      .filter((row) => row.reason === 'first' || row.reason === 'second')
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(pair.map((row) => row.reason)).toEqual(['first', 'second']);
    expect(pair[1]?.createdAt).toEqual(pair[0]?.createdAt);
  });
});
