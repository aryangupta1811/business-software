// Integration test on a throwaway PostgreSQL (ADR 0013): migration 0018's rules hold in the
// database itself (P2.3 design section 3; Module 05 #1, #3, #29–#31; ADR 0048).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { runMigrations } from './migrate.js';
import { attendanceMarks, branches, salaryRates, shopHolidays, users } from './schema.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, testBranch, type TestDatabase } from './testing.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
// 23514 check, 23505 unique, 23503 foreign key, 42501 no privilege or row-level security.
function failsWith(code: string, constraint?: string) {
  return {
    cause: expect.objectContaining({ code, ...(constraint && { constraint }) }) as unknown,
  };
}

describe('staff records, salary rates, attendance marks and shop holidays', () => {
  let server: TestDatabase;
  let runtime: Database;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));
  const inShop = <T>(shop: Shop, work: (tx: Transaction) => Promise<T>) =>
    withBusiness(runtime.db, shop.businessId, work);

  let staffCount = 0;
  /** A staff record with no login (`00` #19): no username, no password. */
  const addStaff = (shop: Shop, overrides: Partial<typeof users.$inferInsert> = {}) =>
    inShop(shop, async (tx) => {
      staffCount += 1;
      const [row] = await tx
        .insert(users)
        .values({
          businessId: shop.businessId,
          role: 'staff',
          name: `Person ${String(staffCount)}`,
          homeBranchId: shop.branchId,
          joiningDate: '2026-11-01',
          ...overrides,
        })
        .returning({ id: users.id });
      if (row === undefined) throw new Error('no row');
      return row.id;
    });

  const rate = (shop: Shop, userId: string, overrides: Record<string, unknown> = {}) => ({
    businessId: shop.businessId,
    userId,
    fromMonth: '2026-11-01',
    kind: 'monthly',
    amountPaise: 1_200_000,
    createdBy: shop.ownerId,
    ...overrides,
  });

  const mark = (shop: Shop, userId: string, overrides: Record<string, unknown> = {}) => ({
    businessId: shop.businessId,
    userId,
    branchId: shop.branchId,
    date: '2026-11-20',
    status: 'present',
    updatedBy: shop.ownerId,
    ...overrides,
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

  describe('the staff record', () => {
    it('holds a person with no login, and fills the defaults', async () => {
      const id = await addStaff(a, {
        phone: '9876543210',
        weeklyOffDay: 0,
        overtimeRatePaise: 15_000,
      });
      const [row] = await inShop(a, (tx) => tx.select().from(users).where(eq(users.id, id)));
      expect(row).toMatchObject({
        role: 'staff',
        username: null,
        passwordHash: null,
        phone: '9876543210',
        joiningDate: '2026-11-01',
        weeklyOffDay: 0,
        paidLeavesPerMonth: 0,
        overtimeRatePaise: 15_000,
        version: 1,
      });
    });

    it.each([
      ['no joining date', { joiningDate: null }, 'users_staff_joining_date_check'],
      ['a phone that is not 10 digits', { phone: '12345' }, 'users_phone_check'],
      ['a weekly off day of 7', { weeklyOffDay: 7 }, 'users_weekly_off_check'],
      ['32 paid leaves', { paidLeavesPerMonth: 32 }, 'users_paid_leaves_check'],
      ['an overtime rate of 0', { overtimeRatePaise: 0 }, 'users_overtime_rate_check'],
    ])('refuses staff with %s', async (_name, change, constraint) => {
      await expect(addStaff(a, change)).rejects.toMatchObject(failsWith('23514', constraint));
    });

    it("keeps the owner's row free of record fields", async () => {
      await expect(
        inShop(a, (tx) =>
          tx.update(users).set({ phone: '9876543210' }).where(eq(users.id, a.ownerId)),
        ),
      ).rejects.toMatchObject(failsWith('23514', 'users_owner_record_check'));
    });
  });

  describe('salary_rates (append-only, 05 #3)', () => {
    it('stores a rate, and never lets the app change or delete one', async () => {
      const person = await addStaff(a);
      await inShop(a, (tx) => tx.insert(salaryRates).values(rate(a, person)));
      await expect(
        inShop(a, (tx) => tx.update(salaryRates).set({ amountPaise: 1 })),
      ).rejects.toMatchObject(failsWith('42501'));
      await expect(inShop(a, (tx) => tx.delete(salaryRates))).rejects.toMatchObject(
        failsWith('42501'),
      );
      const rows = await inShop(a, (tx) =>
        tx.select().from(salaryRates).where(eq(salaryRates.userId, person)),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fromMonth: '2026-11-01', amountPaise: 1_200_000 });
    });

    it('keeps several rates for one person, even two for the same month', async () => {
      const person = await addStaff(a);
      await inShop(a, async (tx) => {
        await tx.insert(salaryRates).values(rate(a, person, { fromMonth: '2026-11-01' }));
        await tx.insert(salaryRates).values(rate(a, person, { fromMonth: '2026-12-01' }));
        await tx
          .insert(salaryRates)
          .values(rate(a, person, { fromMonth: '2026-12-01', amountPaise: 1_300_000 }));
      });
      const rows = await inShop(a, (tx) =>
        tx.select().from(salaryRates).where(eq(salaryRates.userId, person)),
      );
      expect(rows).toHaveLength(3);
    });

    it.each([
      [
        'a month that does not start on the 1st',
        { fromMonth: '2026-11-15' },
        'salary_rates_month_check',
      ],
      ['an amount of 0', { amountPaise: 0 }, 'salary_rates_amount_check'],
      ['a kind that does not exist', { kind: 'weekly' }, 'salary_rates_kind_check'],
    ])('refuses %s', async (_name, change, constraint) => {
      const person = await addStaff(a);
      await expect(
        inShop(a, (tx) => tx.insert(salaryRates).values(rate(a, person, change))),
      ).rejects.toMatchObject(failsWith('23514', constraint));
    });
  });

  describe('attendance_marks', () => {
    it('keeps one mark per person per day, updated in place with a version', async () => {
      const person = await addStaff(a);
      await inShop(a, (tx) => tx.insert(attendanceMarks).values(mark(a, person)));
      await expect(
        inShop(a, (tx) => tx.insert(attendanceMarks).values(mark(a, person, { status: 'absent' }))),
      ).rejects.toMatchObject(failsWith('23505', 'attendance_marks_day_unique'));
      await inShop(a, (tx) =>
        tx
          .update(attendanceMarks)
          .set({ status: 'absent', version: sql`${attendanceMarks.version} + 1` })
          .where(eq(attendanceMarks.userId, person)),
      );
      const [row] = await inShop(a, (tx) =>
        tx.select().from(attendanceMarks).where(eq(attendanceMarks.userId, person)),
      );
      expect(row).toMatchObject({ status: 'absent', version: 2, late: false, overtimeMinutes: 0 });
      // The register never deletes a day (ADR 0007).
      await expect(inShop(a, (tx) => tx.delete(attendanceMarks))).rejects.toMatchObject(
        failsWith('42501'),
      );
    });

    it('lets a present day carry late and overtime in half-hour steps', async () => {
      const person = await addStaff(a);
      await inShop(a, (tx) =>
        tx.insert(attendanceMarks).values(mark(a, person, { late: true, overtimeMinutes: 720 })),
      );
    });

    it.each([
      ['late on an absent day', { status: 'absent', late: true }, 'attendance_marks_present_check'],
      [
        'overtime on a half-day',
        { status: 'half_day', overtimeMinutes: 30 },
        'attendance_marks_present_check',
      ],
      ['overtime of 45 minutes', { overtimeMinutes: 45 }, 'attendance_marks_overtime_check'],
      ['overtime of 750 minutes', { overtimeMinutes: 750 }, 'attendance_marks_overtime_check'],
      ['a status that does not exist', { status: 'sick' }, 'attendance_marks_status_check'],
    ])('refuses %s', async (_name, change, constraint) => {
      const person = await addStaff(a);
      await expect(
        inShop(a, (tx) => tx.insert(attendanceMarks).values(mark(a, person, change))),
      ).rejects.toMatchObject(failsWith('23514', constraint));
    });
  });

  describe('shop_holidays (archived, never deleted)', () => {
    const holiday = (shop: Shop, overrides: Record<string, unknown> = {}) => ({
      businessId: shop.businessId,
      date: '2026-11-09',
      name: 'Diwali',
      ...overrides,
    });

    it('allows one live holiday per scope per date, and the date again once archived', async () => {
      const shop = await signUp('Holidays');
      const second = await inShop(shop, async (tx) => {
        const [row] = await tx
          .insert(branches)
          .values(testBranch(shop.businessId, 'Andheri', 'AND'))
          .returning({ id: branches.id });
        if (row === undefined) throw new Error('no row');
        return row.id;
      });
      await inShop(shop, async (tx) => {
        await tx.insert(shopHolidays).values(holiday(shop));
        // A holiday for one branch on the same day is its own scope.
        await tx.insert(shopHolidays).values(holiday(shop, { branchId: second }));
      });
      await expect(
        inShop(shop, (tx) => tx.insert(shopHolidays).values(holiday(shop, { name: 'Again' }))),
      ).rejects.toMatchObject(failsWith('23505', 'shop_holidays_live_all_unique'));
      await expect(
        inShop(shop, (tx) =>
          tx.insert(shopHolidays).values(holiday(shop, { branchId: second, name: 'Again' })),
        ),
      ).rejects.toMatchObject(failsWith('23505', 'shop_holidays_live_branch_unique'));
      await inShop(shop, (tx) =>
        tx
          .update(shopHolidays)
          .set({ archivedAt: new Date() })
          .where(sql`${shopHolidays.branchId} is null`),
      );
      await inShop(shop, (tx) => tx.insert(shopHolidays).values(holiday(shop, { name: 'Back' })));
      await expect(inShop(shop, (tx) => tx.delete(shopHolidays))).rejects.toMatchObject(
        failsWith('42501'),
      );
    });

    it('refuses another business’s branch', async () => {
      await expect(
        inShop(a, (tx) => tx.insert(shopHolidays).values(holiday(a, { branchId: b.branchId }))),
      ).rejects.toMatchObject(failsWith('23503', 'shop_holidays_branch_fk'));
    });
  });

  describe('two businesses', () => {
    it('keep their rates, marks and holidays apart', async () => {
      const mine = await addStaff(a);
      await inShop(a, async (tx) => {
        await tx.insert(salaryRates).values(rate(a, mine));
        await tx.insert(attendanceMarks).values(mark(a, mine, { date: '2026-11-19' }));
        await tx
          .insert(shopHolidays)
          .values({ businessId: a.businessId, date: '2026-11-21', name: 'Private' });
      });
      for (const table of [salaryRates, attendanceMarks, shopHolidays]) {
        expect(await inShop(b, (tx) => tx.select().from(table))).toEqual([]);
      }
      // B can neither write a row for A nor point one at A's person.
      await expect(
        inShop(b, (tx) => tx.insert(salaryRates).values(rate(a, mine))),
      ).rejects.toMatchObject(failsWith('42501'));
      await expect(
        inShop(b, (tx) =>
          tx.insert(salaryRates).values({ ...rate(b, mine), createdBy: b.ownerId }),
        ),
      ).rejects.toMatchObject(failsWith('23503', 'salary_rates_user_fk'));
      await expect(
        inShop(b, (tx) =>
          tx.insert(attendanceMarks).values({ ...mark(b, mine), branchId: b.branchId }),
        ),
      ).rejects.toMatchObject(failsWith('23503', 'attendance_marks_user_fk'));
    });
  });
});

describe('migration 0018 on a database that already has staff logins', () => {
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
    await root.query('create database before_attendance owner app_owner');
    await root.end();
    // Everything up to 0017, as production has it.
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
    scratch = mkdtempSync(join(tmpdir(), 'migrations-0017-'));
    cpSync(migrations, scratch, { recursive: true });
    const journalFile = join(scratch, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 17);
    writeFileSync(journalFile, JSON.stringify(journal), { encoding: 'utf8' });
    owner = new Pool({ connectionString: urlOf(server.ownerUrl, 'before_attendance'), max: 1 });
    await migrate(drizzle(owner), { migrationsFolder: scratch });
    admin = new Pool({ connectionString: urlOf(server.adminUrl, 'before_attendance'), max: 1 });
  });

  afterAll(async () => {
    await admin.end();
    await owner.end();
    rmSync(scratch, { recursive: true, force: true });
    await server.stop();
  });

  it('gives each existing login the IST day it was made as its joining date', async () => {
    const business = await admin.query<{ id: string }>(
      `insert into businesses (name, business_type, phone, gst_status, features)
       values ('Old shop', 'kirana', '9111111111', 'unregistered', '{}') returning id`,
    );
    const businessId = business.rows[0]?.id ?? '';
    const branch = await admin.query<{ id: string }>(
      `insert into branches (business_id, name, code, state_code) values ($1, 'Main', 'HO', '27')
       returning id`,
      [businessId],
    );
    const branchId = branch.rows[0]?.id ?? '';
    await admin.query(
      `insert into users (business_id, role, email) values ($1, 'owner', 'old-owner@example.test')`,
      [businessId],
    );
    // 01:30 on the 22nd in India is still the 21st in UTC: the IST day is what counts.
    for (const [username, createdAt] of [
      ['late.night', '2026-11-21T20:00:00Z'],
      ['midday', '2026-11-21T10:00:00Z'],
    ] as const) {
      await admin.query(
        `insert into users (business_id, role, username, password_hash, home_branch_id, created_at)
         values ($1, 'staff', $2, 'hash', $3, $4)`,
        [businessId, username, branchId, createdAt],
      );
    }

    // The trap (ADR 0027): the migration role sees no rows under FORCE ROW LEVEL SECURITY.
    const seen = await owner.query<{ n: number }>('select count(*)::int as n from users');
    expect(seen.rows[0]?.n).toBe(0);

    await runMigrations(urlOf(server.ownerUrl, 'before_attendance'));

    const rows = await admin.query<{
      role: string;
      username: string | null;
      joining: string | null;
    }>(`select role, username, joining_date::text as joining from users order by role, username`);
    expect(rows.rows).toEqual([
      { role: 'owner', username: null, joining: null },
      { role: 'staff', username: 'late.night', joining: '2026-11-22' },
      { role: 'staff', username: 'midday', joining: '2026-11-21' },
    ]);
    // Row-level security is forced again, and the new tables follow the same rules.
    const state = await admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select relname, relforcerowsecurity from pg_class
        where relname in ('users', 'salary_rates', 'attendance_marks', 'shop_holidays')
        order by relname`,
    );
    expect(state.rows.every((row) => row.relforcerowsecurity)).toBe(true);
    expect(state.rows).toHaveLength(4);
  });
});
