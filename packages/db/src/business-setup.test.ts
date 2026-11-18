// Integration test on a throwaway PostgreSQL (ADR 0013): migration 0003's rules hold in the
// database itself, whatever the code above it does (Module 00 #6–8, #14, #21, #27, #29, #31).
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { branches, businesses, recoveryKeys, users } from './schema.js';
import { withBusiness, withNewBusiness } from './tenancy.js';
import {
  insertTestBusiness,
  startTestDatabase,
  testBranch,
  testBusiness,
  type TestDatabase,
} from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code is on `cause`.
// 23514 check, 23505 unique, 23503 foreign key, 42501 insufficient privilege.
function failsWith(code: string) {
  return { cause: expect.objectContaining({ code }) as unknown };
}

const HASH = 'a'.repeat(64);

describe('business setup tables', () => {
  let server: TestDatabase;
  let runtime: Database;
  let admin: Pool;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    admin = new Pool({ connectionString: server.adminUrl });
    a = await signUp('Shop A');
    b = await signUp('Shop B');
  });

  afterAll(async () => {
    await runtime.close();
    await admin.end();
    await server.stop();
  });

  describe('businesses', () => {
    it.each([
      ['an unknown business type', { businessType: 'bakery' }],
      ['an unknown GST status', { gstStatus: 'exempt' }],
      ['a phone that is not 10 digits', { phone: '+919111111111' }],
      ['a phone starting with 0', { phone: '0111111111' }],
      ['a lower-case PAN', { pan: 'abcde1234f' }],
      ['an unknown feature', { features: ['teleport'] }],
      ['a null feature', { features: [null as unknown as string] }],
      ['an auto-lock of 0 minutes', { ownerLockMinutes: 0 }],
      ['an auto-lock of 31 minutes', { ownerLockMinutes: 31 }],
      ['a staff idle time of 4 minutes', { staffIdleMinutes: 4 }],
      ['a staff idle time of 121 minutes', { staffIdleMinutes: 121 }],
    ])('refuses %s', async (_, change) => {
      await expect(
        withNewBusiness(runtime.db, (tx, id) =>
          tx.insert(businesses).values({ ...testBusiness('Bad', id), ...change }),
        ),
      ).rejects.toMatchObject(failsWith('23514'));
    });

    it('defaults the lock times to 5 and 30 minutes (#21, #29)', async () => {
      const [row] = await withBusiness(runtime.db, a.businessId, (tx) =>
        tx
          .select({ lock: businesses.ownerLockMinutes, idle: businesses.staffIdleMinutes })
          .from(businesses),
      );
      expect(row).toEqual({ lock: 5, idle: 30 });
    });
  });

  describe('branches', () => {
    const update = (change: Partial<typeof branches.$inferInsert>) =>
      withBusiness(runtime.db, a.businessId, (tx) =>
        tx.update(branches).set(change).where(eq(branches.id, a.branchId)),
      );

    it('accepts a GSTIN that starts with its own state code', async () => {
      await update({ stateCode: '27', gstin: '27ABCDE1234F1Z0' });
    });

    it.each([
      ['a GSTIN from another state', { stateCode: '29', gstin: '27ABCDE1234F1Z0' }],
      ['a malformed GSTIN', { gstin: '27ABCDE1234F1YV' }],
      // No GSTIN on these two, so only the state check can refuse them.
      ['a one-digit state code', { stateCode: '7', gstin: null }],
      // 97, Other Territory, is a place of supply, never where a shop stands.
      ['state 97, Other Territory', { stateCode: '97', gstin: null }],
      ['a PIN code starting with 0', { pinCode: '011001' }],
      ['an FSSAI number of 13 digits', { fssai: '1234567890123' }],
    ])('refuses %s', async (_, change) => {
      await expect(update(change)).rejects.toMatchObject(failsWith('23514'));
    });
  });

  describe('users', () => {
    it('refuses a second owner with the same email, in another business (#27)', async () => {
      const [owner] = await withBusiness(runtime.db, a.businessId, (tx) =>
        tx.select({ email: users.email }).from(users),
      );
      await expect(
        withNewBusiness(runtime.db, async (tx, id) => {
          await tx.insert(businesses).values(testBusiness('Copycat', id));
          await tx.insert(users).values({ businessId: id, role: 'owner', email: owner?.email });
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: '23505',
          constraint: 'users_owner_email_unique',
        }) as unknown,
      });
    });

    it('lets a staff row share an owner email', async () => {
      const [owner] = await withBusiness(runtime.db, a.businessId, (tx) =>
        tx.select({ email: users.email }).from(users).where(eq(users.role, 'owner')),
      );
      await withBusiness(runtime.db, b.businessId, (tx) =>
        tx.insert(users).values({ businessId: b.businessId, role: 'staff', email: owner?.email }),
      );
    });

    it('refuses a second owner in one business', async () => {
      await expect(
        withBusiness(runtime.db, a.businessId, (tx) =>
          tx
            .insert(users)
            .values({ businessId: a.businessId, role: 'owner', email: 'two@example.test' }),
        ),
      ).rejects.toMatchObject(failsWith('23505'));
    });

    it.each([
      ['an email with capitals', { role: 'staff', email: 'Staff@Example.test' }],
      ['an email with spaces', { role: 'staff', email: ' staff@example.test' }],
      // One mailbox, one spelling (#27): printable ASCII only.
      ['an email with a zero-width space', { role: 'staff', email: 'sta\u200Bff@example.test' }],
      ['an email with a Cyrillic letter', { role: 'staff', email: 'st\u0430ff@example.test' }],
      ['an owner without an email', { role: 'owner', email: null }],
      ['an unknown role', { role: 'admin', email: null }],
    ])('refuses %s', async (_, change) => {
      await expect(
        withNewBusiness(runtime.db, async (tx, id) => {
          await tx.insert(businesses).values(testBusiness('Users', id));
          await tx.insert(users).values({ businessId: id, ...change });
        }),
      ).rejects.toMatchObject(failsWith('23514'));
    });

    // The race the unique index settles: the second waits for the first, then fails.
    it('lets only one of two signups with one email commit', async () => {
      const attempt = (name: string) =>
        withNewBusiness(runtime.db, async (tx, id) => {
          await tx.insert(businesses).values(testBusiness(name, id));
          await tx.insert(branches).values(testBranch(id, name));
          await tx
            .insert(users)
            .values({ businessId: id, role: 'owner', email: 'race@example.test' });
          await tx.execute(sql`select pg_sleep(0.2)`);
        });
      const results = await Promise.allSettled([attempt('Race 1'), attempt('Race 2')]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const { rows } = await admin.query<{ n: number }>(
        "select count(*)::int as n from businesses where name like 'Race %'",
      );
      expect(rows[0]?.n).toBe(1);
    });
  });

  describe('recovery keys', () => {
    it('allows one unused key per user and keeps used ones', async () => {
      await withBusiness(runtime.db, a.businessId, async (tx) => {
        await tx.insert(recoveryKeys).values({
          businessId: a.businessId,
          userId: a.ownerId,
          keyHash: HASH,
          usedAt: new Date(),
        });
        await tx
          .insert(recoveryKeys)
          .values({ businessId: a.businessId, userId: a.ownerId, keyHash: HASH });
      });
      await expect(
        withBusiness(runtime.db, a.businessId, (tx) =>
          tx
            .insert(recoveryKeys)
            .values({ businessId: a.businessId, userId: a.ownerId, keyHash: HASH }),
        ),
      ).rejects.toMatchObject(failsWith('23505'));
    });

    it("refuses a key for another business's user", async () => {
      await expect(
        withBusiness(runtime.db, b.businessId, (tx) =>
          tx
            .insert(recoveryKeys)
            .values({ businessId: b.businessId, userId: a.ownerId, keyHash: HASH }),
        ),
      ).rejects.toMatchObject(failsWith('23503'));
    });

    it('refuses a hash that is not 64 hex characters', async () => {
      await expect(
        withBusiness(runtime.db, b.businessId, (tx) =>
          tx
            .insert(recoveryKeys)
            .values({ businessId: b.businessId, userId: b.ownerId, keyHash: 'A'.repeat(64) }),
        ),
      ).rejects.toMatchObject(failsWith('23514'));
    });
  });

  it.each(['users', 'recovery_keys'])(
    'refuses to let the runtime role delete from %s',
    async (table) => {
      await expect(runtime.pool.query(`delete from ${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    },
  );
});
