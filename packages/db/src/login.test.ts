// Integration test on a throwaway PostgreSQL (ADR 0013) for P1.4's database rules: D4 (only the
// database sets an entry's id, business and time), the one cross-business read for login by
// email, and the login columns and tables.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { recordEntry } from './entry-log.js';
import { entryLog, sessions, users } from './schema.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code is on `cause`.
// 42501 insufficient_privilege, 23503 foreign key, 23505 unique, 23514 check, P0002 raised
// by our function.
function failsWith(code: string) {
  return { cause: expect.objectContaining({ code }) as unknown };
}

const HASH = 'a'.repeat(64);
const entity = '0190f0f0-0000-7000-8000-00000000e001';

describe('login database rules', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  const findOwner = async (tx: Transaction | Database['db'], email: string) => {
    const { rows } = await tx.execute<{ business_id: string; user_id: string }>(
      sql`select * from app_find_owner_login(${email})`,
    );
    return rows;
  };

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

  describe('D4: the database sets id, business and time', () => {
    it.each(['id', 'business_id', 'created_at'])('refuses an insert naming %s', async (column) => {
      const value = column === 'created_at' ? sql`now() - interval '30 days'` : sql`uuidv7()`;
      await expect(
        withBusiness(runtime.db, a.businessId, (tx) =>
          tx.execute(sql`insert into entry_log (${sql.raw(column)}, action, entity_type, entity_id)
                         values (${value}, 'stock.adjusted', 'item', ${entity})`),
        ),
      ).rejects.toMatchObject(failsWith('42501'));
    });

    // Drizzle names every column, sending `default` for the ones left out.
    it('refuses a plain Drizzle insert', async () => {
      await expect(
        withBusiness(runtime.db, a.businessId, (tx) =>
          tx
            .insert(entryLog)
            .values({ action: 'stock.adjusted', entityType: 'item', entityId: entity }),
        ),
      ).rejects.toMatchObject(failsWith('42501'));
    });

    it('lets recordEntry write, with the database choosing id, business and time', async () => {
      const started = Date.now();
      await withBusiness(runtime.db, a.businessId, (tx) =>
        recordEntry(tx, {
          actorId: a.ownerId,
          action: 'user.logged_in',
          entityType: 'session',
          entityId: entity,
          branchId: a.branchId,
          after: { note: 'ok' },
        }),
      );
      const rows = await withBusiness(runtime.db, a.businessId, (tx) =>
        tx
          .select()
          .from(entryLog)
          .where(sql`${entryLog.action} = 'user.logged_in'`),
      );
      expect(rows).toEqual([
        expect.objectContaining({
          businessId: a.businessId,
          branchId: a.branchId,
          actorId: a.ownerId,
          before: null,
          after: { note: 'ok' },
        }),
      ]);
      expect(rows[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(started - 5_000);
    });
  });

  describe('login by email', () => {
    it('finds an owner with no business set, and returns only the two IDs', async () => {
      const { rows } = await runtime.pool.query('select * from app_find_owner_login($1)', [
        `owner-${a.businessId}@example.test`,
      ]);
      expect(rows).toEqual([{ business_id: a.businessId, user_id: a.ownerId }]);
    });

    it('finds nothing for an unknown email', async () => {
      expect(await findOwner(runtime.db, 'nobody@example.test')).toEqual([]);
    });

    it("can't register another business's owner", async () => {
      await expect(
        withBusiness(runtime.db, b.businessId, (tx) =>
          tx.execute(sql`select app_register_owner_login(${a.ownerId})`),
        ),
      ).rejects.toMatchObject(failsWith('P0002'));
    });

    it('registers an owner once', async () => {
      await expect(
        withBusiness(runtime.db, a.businessId, (tx) =>
          tx.execute(sql`select app_register_owner_login(${a.ownerId})`),
        ),
      ).rejects.toMatchObject(failsWith('23505'));
    });

    it('keeps app_runtime out of schema auth', async () => {
      await expect(runtime.pool.query('select * from auth.owner_logins')).rejects.toMatchObject({
        code: '42501',
      });
      const { rows } = await runtime.pool.query<{ usage: boolean }>(
        "select has_schema_privilege('app_runtime', 'auth', 'USAGE') as usage",
      );
      expect(rows).toEqual([{ usage: false }]);
    });
  });

  describe('users and sessions', () => {
    const addStaff = (shop: Shop, username: string) =>
      withBusiness(runtime.db, shop.businessId, (tx) =>
        tx.insert(users).values({ businessId: shop.businessId, role: 'staff', username }),
      );

    it('keeps a username unique within its business only', async () => {
      await addStaff(a, 'ramesh');
      await addStaff(b, 'ramesh');
      await expect(addStaff(a, 'ramesh')).rejects.toMatchObject(failsWith('23505'));
    });

    it.each(['Ramesh', 'ab', 'has space', 'x'.repeat(33)])(
      'refuses the username %j',
      async (username) => {
        await expect(addStaff(a, username)).rejects.toMatchObject(failsWith('23514'));
      },
    );

    it('gives an owner no username', async () => {
      await expect(
        withBusiness(runtime.db, a.businessId, (tx) =>
          tx
            .update(users)
            .set({ username: 'owner' })
            .where(sql`${users.id} = ${a.ownerId}`),
        ),
      ).rejects.toMatchObject(failsWith('23514'));
    });

    const openSession = (shop: Shop, overrides: Partial<typeof sessions.$inferInsert> = {}) =>
      withBusiness(runtime.db, shop.businessId, (tx) =>
        tx.insert(sessions).values({
          businessId: shop.businessId,
          userId: shop.ownerId,
          branchId: shop.branchId,
          tokenHash: HASH,
          csrfHash: HASH,
          ...overrides,
        }),
      );

    it('refuses a token that is not a hash, and an end without a reason', async () => {
      await expect(openSession(a, { tokenHash: 'plain-token' })).rejects.toMatchObject(
        failsWith('23514'),
      );
      await expect(
        openSession(a, { tokenHash: 'b'.repeat(64), endedAt: new Date() }),
      ).rejects.toMatchObject(failsWith('23514'));
    });

    // Foreign-key checks skip RLS: the composite key stops a session naming another business's user.
    it("refuses a session for another business's user", async () => {
      await expect(
        openSession(a, { userId: b.ownerId, tokenHash: 'c'.repeat(64) }),
      ).rejects.toMatchObject(failsWith('23503'));
    });
  });
});
