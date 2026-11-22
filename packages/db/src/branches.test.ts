// Integration test on a throwaway PostgreSQL (ADR 0013): migration 0014's rules hold in the
// database itself (P1.6 design, sections 5 and 10; Module 00 #12, #35, #54–#60).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { runMigrations } from './migrate.js';
import { branches, staffBranches, users } from './schema.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, testBranch, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
// 23514 check, 23505 unique, 23503 foreign key, 42501 no privilege.
function failsWith(code: string, constraint?: string) {
  return {
    cause: expect.objectContaining({ code, ...(constraint && { constraint }) }) as unknown,
  };
}

describe('branches and staff_branches', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  const inShop = <T>(shop: Shop, work: (tx: Transaction) => Promise<T>) =>
    withBusiness(runtime.db, shop.businessId, work);

  const addBranch = (shop: Shop, code: string, name = `Branch ${code}`) =>
    inShop(shop, async (tx) => {
      const [row] = await tx
        .insert(branches)
        .values(testBranch(shop.businessId, name, code))
        .returning({ id: branches.id });
      if (row === undefined) throw new Error('no row');
      return row.id;
    });

  const addStaff = (shop: Shop, username: string) =>
    inShop(shop, async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          businessId: shop.businessId,
          role: 'staff',
          username,
          homeBranchId: shop.branchId,
        })
        .returning({ id: users.id });
      if (row === undefined) throw new Error('no row');
      return row.id;
    });

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

  describe('the branch code', () => {
    it.each(['AND', 'T1', 'A1B2', '7'])('accepts %j', async (code) => {
      expect(await addBranch(a, code)).toBeTruthy();
    });

    it.each(['', 'and', 'ABCDE', 'TOOLONG', 'A B', 'A-B', 'ÀB'])('refuses %j', async (code) => {
      await expect(addBranch(a, code)).rejects.toMatchObject(
        failsWith('23514', 'branches_code_check'),
      );
    });

    it('refuses a missing code', async () => {
      await expect(
        inShop(a, (tx) =>
          tx.execute(sql`insert into branches (business_id, name, state_code)
            values (${a.businessId}, 'No code', '27')`),
        ),
      ).rejects.toMatchObject(failsWith('23502'));
    });

    it('keeps a code unique within its business only', async () => {
      await addBranch(a, 'DUP');
      await addBranch(b, 'DUP');
      await expect(addBranch(a, 'DUP', 'Another')).rejects.toMatchObject(
        failsWith('23505', 'branches_business_id_code_unique'),
      );
    });

    it('gives a new branch no archive date, and lets it be archived and restored', async () => {
      const id = await addBranch(a, 'ARC');
      const archivedAt = (tx: Transaction) =>
        tx
          .select({ at: branches.archivedAt })
          .from(branches)
          .where(sql`${branches.id} = ${id}`);
      expect(await inShop(a, archivedAt)).toEqual([{ at: null }]);
      await inShop(a, (tx) =>
        tx
          .update(branches)
          .set({ archivedAt: new Date() })
          .where(sql`${branches.id} = ${id}`),
      );
      expect((await inShop(a, archivedAt))[0]?.at).toBeInstanceOf(Date);
    });
  });

  describe('staff_branches', () => {
    it('stores an extra branch and refuses it twice', async () => {
      const staff = await addStaff(a, 'extra.once');
      const branchId = await addBranch(a, 'EX1');
      const tick = () =>
        inShop(a, (tx) =>
          tx.insert(staffBranches).values({ businessId: a.businessId, userId: staff, branchId }),
        );
      await tick();
      await expect(tick()).rejects.toMatchObject(failsWith('23505'));
    });

    it("refuses another business's branch, and another business's login", async () => {
      const staff = await addStaff(a, 'extra.cross');
      const foreignBranch = await addBranch(b, 'FOR');
      await expect(
        inShop(a, (tx) =>
          tx
            .insert(staffBranches)
            .values({ businessId: a.businessId, userId: staff, branchId: foreignBranch }),
        ),
      ).rejects.toMatchObject(failsWith('23503', 'staff_branches_branch_fk'));
      const ownBranch = await addBranch(a, 'OWN');
      const foreignStaff = await addStaff(b, 'extra.cross');
      await expect(
        inShop(a, (tx) =>
          tx
            .insert(staffBranches)
            .values({ businessId: a.businessId, userId: foreignStaff, branchId: ownBranch }),
        ),
      ).rejects.toMatchObject(failsWith('23503', 'staff_branches_user_fk'));
    });

    it('is invisible to another business, and refuses a row for one', async () => {
      const staff = await addStaff(a, 'extra.rls');
      const branchId = await addBranch(a, 'RLS');
      await inShop(a, (tx) =>
        tx.insert(staffBranches).values({ businessId: a.businessId, userId: staff, branchId }),
      );
      expect(await inShop(b, (tx) => tx.select().from(staffBranches))).toEqual([]);
      await expect(
        inShop(b, (tx) =>
          tx.insert(staffBranches).values({ businessId: a.businessId, userId: staff, branchId }),
        ),
      ).rejects.toMatchObject(failsWith('42501'));
    });

    it('lets the app remove a row: the one table it may delete from', async () => {
      const staff = await addStaff(a, 'extra.delete');
      const branchId = await addBranch(a, 'DEL');
      await inShop(a, (tx) =>
        tx.insert(staffBranches).values({ businessId: a.businessId, userId: staff, branchId }),
      );
      const removed = await inShop(a, (tx) =>
        tx
          .delete(staffBranches)
          .where(sql`${staffBranches.userId} = ${staff}`)
          .returning({ id: staffBranches.id }),
      );
      expect(removed).toHaveLength(1);
      // Branches and logins are business records: still never deleted.
      await expect(
        inShop(a, (tx) => tx.delete(branches).where(sql`${branches.id} = ${branchId}`)),
      ).rejects.toMatchObject(failsWith('42501'));
    });
  });
});

describe('migration 0014 on a database that already has branches', () => {
  let server: TestDatabase;
  let admin: Pool;
  let owner: Pool;
  let scratch: string;

  const urlOf = (base: string, database: string) => {
    const url = new URL(base);
    url.pathname = `/${database}`;
    return url.toString();
  };

  beforeAll(async () => {
    server = await startTestDatabase();
    const root = new Pool({ connectionString: server.adminUrl });
    await root.query('create database before_branches owner app_owner');
    await root.end();
    // Everything up to 0013, as production has it.
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
    scratch = mkdtempSync(join(tmpdir(), 'migrations-0013-'));
    cpSync(migrations, scratch, { recursive: true });
    const journalFile = join(scratch, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 13);
    writeFileSync(journalFile, JSON.stringify(journal), { encoding: 'utf8' });
    owner = new Pool({
      connectionString: urlOf(server.ownerUrl, 'before_branches'),
      max: 1,
    });
    await migrate(drizzle(owner), { migrationsFolder: scratch });
    admin = new Pool({ connectionString: urlOf(server.adminUrl, 'before_branches'), max: 1 });
  });

  afterAll(async () => {
    await admin.end();
    await owner.end();
    rmSync(scratch, { recursive: true, force: true });
    await server.stop();
  });

  it('fills every existing branch with a code: the oldest of each business is HO', async () => {
    const business = (name: string) =>
      admin.query<{ id: string }>(
        `insert into businesses (name, business_type, phone, gst_status, features)
         values ($1, 'kirana', '9111111111', 'unregistered', '{}') returning id`,
        [name],
      );
    const branch = (businessId: string, name: string, createdAt: string) =>
      admin.query(
        `insert into branches (business_id, name, state_code, created_at)
         values ($1, $2, '27', $3)`,
        [businessId, name, createdAt],
      );
    const one = (await business('One branch')).rows[0]?.id ?? '';
    const two = (await business('Two branches')).rows[0]?.id ?? '';
    await branch(one, 'Only', '2026-01-01T00:00:00Z');
    // Inserted newest first, so the order of the code isn't the order of the insert.
    await branch(two, 'Third', '2026-03-01T00:00:00Z');
    await branch(two, 'First', '2026-01-01T00:00:00Z');
    await branch(two, 'Second', '2026-02-01T00:00:00Z');

    // The trap (ADR 0027): the migration role sees no rows under FORCE ROW LEVEL SECURITY, so a
    // plain UPDATE would change nothing, with no error.
    const seen = await owner.query<{ n: number }>('select count(*)::int as n from branches');
    expect(seen.rows[0]?.n).toBe(0);

    await runMigrations(urlOf(server.ownerUrl, 'before_branches'));

    const rows = await admin.query<{ name: string; code: string }>(
      'select name, code from branches order by business_id, created_at',
    );
    expect(rows.rows.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { name: 'First', code: 'HO' },
      { name: 'Only', code: 'HO' },
      { name: 'Second', code: 'B2' },
      { name: 'Third', code: 'B3' },
    ]);
    // Row-level security is forced again, and the column can no longer be empty.
    const state = await admin.query<{ relforcerowsecurity: boolean; attnotnull: boolean }>(
      `select c.relforcerowsecurity, a.attnotnull from pg_class c
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'code'
        where c.oid = 'branches'::regclass`,
    );
    expect(state.rows).toEqual([{ relforcerowsecurity: true, attnotnull: true }]);
  });
});
