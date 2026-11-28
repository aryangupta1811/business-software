// Integration test on a throwaway PostgreSQL (ADR 0013): the demo seed (P1.20, ADR 0016). It builds
// a few days of a shop through the real HTTP routes, then checks what a seed that inserted rows
// directly could get wrong: stock against its movements, invoice numbers without gaps, udhaar
// balances against their ledger, the log, the business dates, and that nothing a real person could
// answer to is in it. It also checks that the reset only ever adds and archives.
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import { businessDate, isValidGstin } from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findDemoBusiness } from './registry.js';
import { assertSeedAllowed, ensureDemoShop } from './reset.js';
import { gstinWith } from './seed.js';
import { BUSINESS_CUSTOMER, CUSTOMERS, ITEMS, SERVICE, SHOP, STAFF } from './shop.js';

const NOW = new Date('2026-11-28T06:00:00Z');
const DAYS = 4;

describe('the demo seed', () => {
  let server: TestDatabase;
  let admin: Database;
  let businessId: string;
  let ownerEmail: string;
  let first: Awaited<ReturnType<typeof ensureDemoShop>>;

  const rows = async <T>(text: string, values: unknown[] = []) =>
    (await admin.pool.query<T & Record<string, unknown>>(text, values)).rows;
  const one = async <T>(text: string, values: unknown[] = []) => (await rows<T>(text, values))[0];

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    first = await ensureDemoShop({ databaseUrl: server.runtimeUrl, now: NOW, days: DAYS });
    if (first.action !== 'created') throw new Error('Expected a new shop');
    businessId = first.result.businessId;
    ownerEmail = first.result.ownerEmail;
  }, 300_000);

  afterAll(async () => {
    await admin.close();
    await server.stop();
  });

  it('registers one demo business, flagged, with the owner and a cashier login', async () => {
    const found = await findDemoBusiness(createDatabase(server.runtimeUrl, () => undefined));
    expect(found?.businessId).toBe(businessId);
    expect(await one('select demo from businesses where id = $1', [businessId])).toMatchObject({
      demo: true,
    });
    const people = await rows<{ role: string; username: string | null; name: string | null }>(
      'select role, username, name from users where business_id = $1 order by role, name',
      [businessId],
    );
    expect(people.map((person) => person.username)).toContain('cashier');
    expect(people.filter((person) => person.role === 'owner')).toHaveLength(1);
    expect(people.filter((person) => person.role === 'staff').map((p) => p.name)).toEqual([
      STAFF.cashier.name,
      STAFF.helper.name,
    ]);
  });

  it('puts the lock times back to the ordinary ones when it has finished', async () => {
    expect(
      await one('select owner_lock_minutes, staff_idle_minutes from businesses where id = $1', [
        businessId,
      ]),
    ).toEqual({ owner_lock_minutes: 5, staff_idle_minutes: 30 });
  });

  it('makes history that ends yesterday and starts DAYS earlier, in Indian time', async () => {
    const range = await one<{ first: string; last: string; days: string }>(
      `select min(business_date)::text as first, max(business_date)::text as last,
              count(distinct business_date)::text as days
         from bills where business_id = $1`,
      [businessId],
    );
    expect(range?.last).toBe('2026-11-27');
    expect(range?.first).toBe('2026-11-24');
    expect(Number(range?.days)).toBe(DAYS);
    expect(businessDate(NOW)).toBe('2026-11-28');
  });

  it("numbers every branch's invoices from 1 with no gaps, as the counter does", async () => {
    const gaps = await rows(
      `select financial_year, count(*), max(sequence) from bills
        where business_id = $1 group by financial_year having count(*) <> max(sequence)`,
      [businessId],
    );
    expect(gaps).toEqual([]);
    const total = await one<{ count: string }>(
      'select count(*) from bills where business_id = $1',
      [businessId],
    );
    expect(Number(total?.count)).toBe((first as { result: { bills: number } }).result.bills);
    expect(Number(total?.count)).toBeGreaterThan(60);
  });

  it("keeps every item's stock equal to the sum of its movements, never below zero", async () => {
    const mismatches = await rows(
      `select s.item_id from item_stock s
        where s.business_id = $1
          and s.quantity <> (select coalesce(sum(m.quantity), 0) from stock_movements m
                              where m.item_id = s.item_id and m.branch_id = s.branch_id)`,
      [businessId],
    );
    expect(mismatches).toEqual([]);
    const negative = await rows(
      'select item_id from item_stock where business_id = $1 and quantity < 0',
      [businessId],
    );
    expect(negative).toEqual([]);
    const sold = await one<{ lines: string }>(
      `select count(*) as lines from stock_movements where business_id = $1 and kind = 'sale'`,
      [businessId],
    );
    expect(Number(sold?.lines)).toBeGreaterThan(100);
  });

  it('gives every bill its log entry and the payments of exactly its total', async () => {
    const unlogged = await rows(
      `select b.id from bills b
        where b.business_id = $1
          and not exists (select 1 from entry_log e where e.entity_id = b.id and e.action = 'bill.created')`,
      [businessId],
    );
    expect(unlogged).toEqual([]);
    const unbalanced = await rows(
      `select b.id from bills b
        where b.business_id = $1
          and b.grand_total_paise <> (select coalesce(sum(p.amount_paise), 0) from bill_payments p
                                       where p.bill_id = b.id)`,
      [businessId],
    );
    expect(unbalanced).toEqual([]);
  });

  it('adds GST to the bills: tax invoices with CGST and SGST, GST-inclusive prices', async () => {
    const tax = await one<{ taxed: string; cgst: string; sgst: string; igst: string }>(
      `select count(*) filter (where cgst_paise > 0) as taxed, sum(cgst_paise)::text as cgst,
              sum(sgst_paise)::text as sgst, sum(igst_paise)::text as igst
         from bills where business_id = $1`,
      [businessId],
    );
    expect(Number(tax?.taxed)).toBeGreaterThan(0);
    // The shop and every customer are in Maharashtra: no IGST, and CGST equals SGST.
    expect(tax?.igst).toBe('0');
    expect(tax?.cgst).toBe(tax?.sgst);
    const rates = await rows<{ rate_basis_points: number }>(
      'select distinct rate_basis_points from bill_lines where business_id = $1 order by 1',
      [businessId],
    );
    expect(rates.map((row) => row.rate_basis_points).length).toBeGreaterThan(2);
  });

  it('keeps each udhaar account equal to the last entry of its ledger, and some owe money', async () => {
    const mismatches = await rows(
      `select a.customer_id from udhaar_accounts a
        where a.business_id = $1
          and a.balance_paise <> coalesce((select e.balance_after_paise from udhaar_entries e
                                            where e.customer_id = a.customer_id
                                            order by e.id desc limit 1), 0)`,
      [businessId],
    );
    expect(mismatches).toEqual([]);
    const owing = await one<{ count: string }>(
      'select count(*) from udhaar_accounts where business_id = $1 and balance_paise > 0',
      [businessId],
    );
    expect(Number(owing?.count)).toBeGreaterThan(0);
  });

  it('uses no phone number a real person could answer: every one starts with 1', async () => {
    const phones = await rows<{ phone: string }>(
      `select phone from businesses where id = $1 and phone is not null
       union all select phone from customers where business_id = $1 and phone is not null
       union all select phone from users where business_id = $1 and phone is not null`,
      [businessId],
    );
    expect(phones.length).toBeGreaterThan(10);
    for (const { phone } of phones) expect(phone).toMatch(/^1\d{9}$/);
    // The same holds for the fixed data, so a new customer added to it can't slip through.
    for (const phone of [
      SHOP.phone,
      BUSINESS_CUSTOMER.phone,
      STAFF.cashier.phone,
      STAFF.helper.phone,
      ...CUSTOMERS.map((customer) => customer.phone),
    ]) {
      expect(phone).toMatch(/^1\d{9}$/);
    }
  });

  it('uses made-up GSTINs that pass the same check as real ones', () => {
    expect(isValidGstin(SHOP.gstin)).toBe(true);
    expect(isValidGstin(gstinWith(BUSINESS_CUSTOMER.gstin.slice(0, 14)))).toBe(true);
  });

  it('has items with GST rates, HSN codes, MRPs and packs, plus a service', async () => {
    const items = await rows<{ name: string; gst_rate: number | null; hsn: string | null }>(
      'select name, gst_rate, hsn from items where business_id = $1',
      [businessId],
    );
    expect(items).toHaveLength(ITEMS.length + 1);
    expect(items.every((item) => item.hsn !== null && item.gst_rate !== null)).toBe(true);
    expect(items.find((item) => item.name === SERVICE.name)?.hsn).toBe(SERVICE.sac);
    const packs = await one<{ count: string }>(
      'select count(*) from item_units where business_id = $1',
      [businessId],
    );
    expect(Number(packs?.count)).toBe(ITEMS.filter((item) => item.pack !== undefined).length);
  });

  it('gives the same shop for the same seed and the same day', async () => {
    const again = await ensureDemoShop({
      databaseUrl: server.runtimeUrl,
      now: NOW,
      days: DAYS,
      force: true,
    });
    if (again.action !== 'created' || first.action !== 'created') throw new Error('Expected shops');
    expect(again.result.bills).toBe(first.result.bills);
    expect(again.result.billedPaise).toBe(first.result.billedPaise);
    expect(again.result.udhaarPayments).toBe(first.result.udhaarPayments);
    expect(again.result.ownerEmail).not.toBe(ownerEmail);
  }, 300_000);

  describe('the reset', () => {
    it('keeps a young demo shop and builds nothing', async () => {
      const before = await one<{ count: string }>('select count(*) from businesses');
      const outcome = await ensureDemoShop({ databaseUrl: server.runtimeUrl, now: NOW });
      expect(outcome.action).toBe('kept');
      expect(await one('select count(*) from businesses')).toEqual(before);
    });

    it('builds a new shop, archives the old ones and deletes nothing', async () => {
      const before = await one<{ businesses: string; bills: string; entries: string }>(
        `select (select count(*) from businesses)::text as businesses,
                (select count(*) from bills)::text as bills,
                (select count(*) from entry_log)::text as entries`,
      );
      const current = await findDemoBusiness(createDatabase(server.runtimeUrl, () => undefined));
      const later = new Date(NOW.getTime() + 9 * 24 * 60 * 60_000);
      const outcome = await ensureDemoShop({ databaseUrl: server.runtimeUrl, now: later, days: 2 });
      if (outcome.action !== 'created') throw new Error('Expected a new shop');
      expect(outcome.archived).toBeGreaterThan(0);
      expect(outcome.result.businessId).not.toBe(current?.businessId);
      const after = await one<{ businesses: string; bills: string; entries: string }>(
        `select (select count(*) from businesses)::text as businesses,
                (select count(*) from bills)::text as bills,
                (select count(*) from entry_log)::text as entries`,
      );
      // One more business, more bills and entries; not one row fewer anywhere.
      expect(Number(after?.businesses)).toBe(Number(before?.businesses) + 1);
      expect(Number(after?.bills)).toBeGreaterThan(Number(before?.bills));
      expect(Number(after?.entries)).toBeGreaterThan(Number(before?.entries));
      const newest = await findDemoBusiness(createDatabase(server.runtimeUrl, () => undefined));
      expect(newest?.businessId).toBe(outcome.result.businessId);
    }, 300_000);
  });
});

describe('where the seed may run', () => {
  it('runs against a local database', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'db']) {
      expect(() => {
        assertSeedAllowed({ DATABASE_URL: `postgresql://u:p@${host}:5432/x` });
      }).not.toThrow();
    }
  });

  it('runs against a database marked as the demo', () => {
    expect(() => {
      assertSeedAllowed({
        DEMO_ENABLED: 'true',
        DATABASE_URL: 'postgresql://u:p@demo.example.internal:5432/x',
      });
    }).not.toThrow();
  });

  it('refuses any other database, without showing its address', () => {
    const attempt = () => {
      assertSeedAllowed({ DATABASE_URL: 'postgresql://user:secret@prod.example.com:5432/x' });
    };
    expect(attempt).toThrow('Refusing to seed');
    expect(attempt).not.toThrow(/secret|prod\.example/);
  });

  it('refuses when no database is named', () => {
    expect(() => {
      assertSeedAllowed({});
    }).toThrow('Refusing to seed');
  });
});
