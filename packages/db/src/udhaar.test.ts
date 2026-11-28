// Integration test on a throwaway PostgreSQL (ADR 0013): the udhaar ledger (P1.18 design §3, §4,
// §8). The tables' own rules hold whatever the code does, and moveUdhaar is the one write path.
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { bills, customers, udhaarAccounts, udhaarEntries } from './schema.js';
import { withBusiness, withNewBusiness, type Transaction } from './tenancy.js';
import { insertTestBusiness, startTestDatabase, type TestDatabase } from './testing.js';
import {
  findUdhaarMismatches,
  lockUdhaarAccount,
  moveUdhaar,
  UdhaarRuleError,
  type MoveUdhaarInput,
} from './udhaar.js';

// Drizzle wraps driver errors; the PostgreSQL error code and constraint are on `cause`.
function failsWith(code: string, constraint?: string) {
  return {
    cause: expect.objectContaining({ code, ...(constraint && { constraint }) }) as unknown,
  };
}

const ruleError = (code: string, extra: Record<string, unknown> = {}): object =>
  expect.objectContaining({ code, ...extra }) as object;

describe('udhaar ledger', () => {
  let server: TestDatabase;
  let runtime: Database;
  let admin: Pool;
  type Shop = Awaited<ReturnType<typeof insertTestBusiness>>;
  let a: Shop;
  let b: Shop;
  let sequence = 0;

  const signUp = (name: string): Promise<Shop> =>
    withNewBusiness(runtime.db, (tx, businessId) => insertTestBusiness(tx, businessId, name));

  const inShop = <T>(shop: Shop, work: (tx: Transaction) => Promise<T>) =>
    withBusiness(runtime.db, shop.businessId, work);

  async function addCustomer(shop: Shop, overrides: Partial<typeof customers.$inferInsert> = {}) {
    const [row] = await inShop(shop, (tx) =>
      tx
        .insert(customers)
        .values({ name: `Customer ${crypto.randomUUID()}`, ...overrides })
        .returning({ id: customers.id }),
    );
    if (row === undefined) throw new Error('no row');
    return row.id;
  }

  async function addBill(shop: Shop) {
    const number = ++sequence;
    const [row] = await inShop(shop, (tx) =>
      tx
        .insert(bills)
        .values({
          branchId: shop.branchId,
          billKey: crypto.randomUUID(),
          requestHash: 'x',
          financialYear: '2026-27',
          sequence: number,
          number: `26-27/${String(number)}`,
          document: 'bill',
          businessDate: '2026-11-20',
          priceList: 'retail',
          supplierStateCode: '27',
          placeOfSupplyStateCode: '27',
          tax: 'none',
          seller: {},
          grossPaise: 0,
          subtotalPaise: 0,
          billDiscountPaise: 0,
          taxablePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          totalPaise: 0,
          roundOffPaise: 0,
          grandTotalPaise: 0,
          createdBy: shop.ownerId,
        })
        .returning({ id: bills.id }),
    );
    if (row === undefined) throw new Error('no row');
    return row.id;
  }

  /** One call of moveUdhaar at the shop's branch, as its owner, on 2026-11-20. */
  function move(
    shop: Shop,
    customerId: string,
    input: Pick<MoveUdhaarInput, 'kind' | 'amountPaise'> & Partial<MoveUdhaarInput>,
    database: Database = runtime,
  ) {
    return withBusiness(database.db, shop.businessId, (tx) =>
      moveUdhaar(tx, {
        customerId,
        branchId: shop.branchId,
        actorId: shop.ownerId,
        businessDate: '2026-11-20',
        ...input,
      }),
    );
  }

  const sell = async (shop: Shop, customerId: string, amountPaise: number) =>
    move(shop, customerId, { kind: 'bill', amountPaise, billId: await addBill(shop) });
  const pay = (shop: Shop, customerId: string, amountPaise: number, extra = {}) =>
    move(shop, customerId, { kind: 'payment', amountPaise: -amountPaise, mode: 'cash', ...extra });

  async function accountOf(shop: Shop, customerId: string) {
    const [row] = await inShop(shop, (tx) =>
      tx
        .select()
        .from(udhaarAccounts)
        .where(sql`${udhaarAccounts.customerId} = ${customerId}`),
    );
    return row;
  }

  const entriesOf = (shop: Shop, customerId: string) =>
    inShop(shop, (tx) =>
      tx
        .select()
        .from(udhaarEntries)
        .where(sql`${udhaarEntries.customerId} = ${customerId}`)
        .orderBy(udhaarEntries.id),
    );

  beforeAll(async () => {
    server = await startTestDatabase();
    runtime = createDatabase(server.runtimeUrl, vi.fn());
    admin = new Pool({ connectionString: server.adminUrl });
    a = await signUp('Shop A');
    b = await signUp('Shop B');
  });

  // The ledger's promise: every balance equals the sum of its entries and its last balance_after.
  afterEach(async () => {
    for (const shop of [a, b]) {
      expect(await inShop(shop, (tx) => findUdhaarMismatches(tx))).toEqual([]);
    }
  });

  afterAll(async () => {
    await admin.end();
    await runtime.close();
    await server.stop();
  });

  describe('the tables', () => {
    it('never lets the app change or delete an entry or an account (append-only)', async () => {
      const customerId = await addCustomer(a);
      await sell(a, customerId, 5_000);
      await expect(
        inShop(a, (tx) => tx.execute(sql`update udhaar_entries set amount_paise = 1`)),
      ).rejects.toMatchObject(failsWith('42501'));
      await expect(
        inShop(a, (tx) => tx.execute(sql`delete from udhaar_entries`)),
      ).rejects.toMatchObject(failsWith('42501'));
      await expect(
        inShop(a, (tx) => tx.execute(sql`delete from udhaar_accounts`)),
      ).rejects.toMatchObject(failsWith('42501'));
    });

    const row = (shop: Shop, customerId: string, overrides: Record<string, unknown> = {}) => ({
      customerId,
      branchId: shop.branchId,
      kind: 'payment',
      amountPaise: -100,
      balanceAfterPaise: -100,
      mode: 'cash',
      businessDate: '2026-11-20',
      createdBy: shop.ownerId,
      ...overrides,
    });

    it.each([
      ['a payment above zero', { amountPaise: 100 }, 'udhaar_entries_amount_check'],
      ['a payment of nothing', { amountPaise: 0 }, 'udhaar_entries_amount_check'],
      ['a payment with no mode', { mode: null }, 'udhaar_entries_mode_check'],
      ['a cheque with no number', { mode: 'cheque' }, 'udhaar_entries_mode_check'],
      ['a mode that is not money', { mode: 'udhaar' }, 'udhaar_entries_mode_check'],
      // PostgreSQL checks constraints by name, and the amount check also names the kinds it knows.
      ['an unknown kind', { kind: 'gift' }, 'udhaar_entries_amount_check'],
      [
        'a bill entry with no bill',
        { kind: 'bill', amountPaise: 100, mode: null, dueDate: '2026-12-20' },
        'udhaar_entries_bill_check',
      ],
      [
        'an entry above zero with no due date',
        { kind: 'opening', amountPaise: 100, mode: null, reason: 'old' },
        'udhaar_entries_due_date_check',
      ],
      ['a payment with a due date', { dueDate: '2026-12-20' }, 'udhaar_entries_due_date_check'],
      [
        'a reversal pointing at nothing',
        {
          kind: 'payment_reversal',
          amountPaise: 100,
          mode: null,
          dueDate: '2026-12-20',
          reason: 'x',
        },
        'udhaar_entries_reverses_check',
      ],
      ['a payment with a reason', { reason: 'x' }, 'udhaar_entries_reason_check'],
      [
        'an opening with no reason',
        { kind: 'opening', amountPaise: 100, mode: null, dueDate: '2026-12-20' },
        'udhaar_entries_reason_check',
      ],
    ])('refuses %s whatever the code does', async (_, overrides, constraint) => {
      const customerId = await addCustomer(a);
      await expect(
        inShop(a, (tx) => tx.insert(udhaarEntries).values(row(a, customerId, overrides) as never)),
      ).rejects.toMatchObject(failsWith('23514', constraint));
    });

    it('refuses a due-days value or a credit limit that makes no sense', async () => {
      await expect(addCustomer(a, { dueDays: 366 })).rejects.toMatchObject(
        failsWith('23514', 'customers_due_days_check'),
      );
      await expect(addCustomer(a, { dueDays: -1 })).rejects.toMatchObject(
        failsWith('23514', 'customers_due_days_check'),
      );
      await expect(addCustomer(a, { creditLimitPaise: -1 })).rejects.toMatchObject(
        failsWith('23514', 'customers_credit_limit_check'),
      );
      const customerId = await addCustomer(a);
      expect(
        await inShop(a, (tx) =>
          tx
            .select({ dueDays: customers.dueDays, limit: customers.creditLimitPaise })
            .from(customers)
            .where(sql`${customers.id} = ${customerId}`),
        ),
      ).toEqual([{ dueDays: 30, limit: null }]);
    });
  });

  describe('moveUdhaar', () => {
    it('keeps the balance equal to the sum of the entries after every kind', async () => {
      const customerId = await addCustomer(a);
      await sell(a, customerId, 10_000);
      expect((await accountOf(a, customerId))?.balancePaise).toBe(10_000);
      const paid = await pay(a, customerId, 4_000);
      expect(paid).toMatchObject({ balanceBeforePaise: 10_000, balanceAfterPaise: 6_000 });
      expect((await accountOf(a, customerId))?.balancePaise).toBe(6_000);
      await move(a, customerId, {
        kind: 'payment_reversal',
        amountPaise: 4_000,
        reversesEntryId: paid.entryId,
        reason: 'Wrong customer',
      });
      expect((await accountOf(a, customerId))?.balancePaise).toBe(10_000);

      const other = await addCustomer(a);
      await move(a, other, {
        kind: 'opening',
        amountPaise: 2_500,
        reason: 'Old notebook',
        dueFrom: '2026-10-01',
      });
      expect((await accountOf(a, other))?.balancePaise).toBe(2_500);

      const entries = await entriesOf(a, customerId);
      expect(
        entries.map((entry) => [entry.kind, entry.amountPaise, entry.balanceAfterPaise]),
      ).toEqual([
        ['bill', 10_000, 10_000],
        ['payment', -4_000, 6_000],
        ['payment_reversal', 4_000, 10_000],
      ]);
      expect((await accountOf(a, customerId))?.lastEntryId).toBe(entries[2]?.id);
    });

    it('lets a payment above what is owed leave an advance, and uses it later', async () => {
      const customerId = await addCustomer(a);
      await sell(a, customerId, 1_000);
      await pay(a, customerId, 1_500);
      expect((await accountOf(a, customerId))?.balancePaise).toBe(-500);
      const billId = await addBill(a);
      const used = await move(a, customerId, {
        kind: 'advance_used',
        amountPaise: 300,
        billId,
      });
      expect(used).toMatchObject({ balanceBeforePaise: -500, balanceAfterPaise: -200 });
      await move(a, customerId, { kind: 'bill', amountPaise: 700, billId });
      expect((await accountOf(a, customerId))?.balancePaise).toBe(500);
    });

    it('fixes each due date when the entry is made: the day plus the customer due days', async () => {
      const customerId = await addCustomer(a, { dueDays: 15 });
      await sell(a, customerId, 1_000);
      const opening = await addCustomer(a);
      await move(a, opening, {
        kind: 'opening',
        amountPaise: 900,
        reason: 'Notebook',
        dueFrom: '2026-10-01',
      });
      await pay(a, customerId, 100);
      expect((await entriesOf(a, customerId)).map((entry) => entry.dueDate)).toEqual([
        '2026-12-05',
        null,
      ]);
      expect((await entriesOf(a, opening)).map((entry) => entry.dueDate)).toEqual(['2026-10-31']);
      // Changing the due days later doesn't move old entries (`03` #22).
      await inShop(a, (tx) =>
        tx.execute(sql`update customers set due_days = 3 where id = ${customerId}`),
      );
      await sell(a, customerId, 50);
      expect((await entriesOf(a, customerId)).map((entry) => entry.dueDate)).toEqual([
        '2026-12-05',
        null,
        '2026-11-23',
      ]);
    });

    it('refuses an advance larger than the advance there is, saying how much there is', async () => {
      const customerId = await addCustomer(a);
      const billId = await addBill(a);
      await expect(
        move(a, customerId, { kind: 'advance_used', amountPaise: 1, billId }),
      ).rejects.toMatchObject(ruleError('advance_changed', { availablePaise: 0 }));
      await sell(a, customerId, 1_000);
      await expect(
        move(a, customerId, { kind: 'advance_used', amountPaise: 1, billId }),
      ).rejects.toMatchObject(ruleError('advance_changed', { availablePaise: 0 }));
      await pay(a, customerId, 1_300);
      await expect(
        move(a, customerId, { kind: 'advance_used', amountPaise: 301, billId }),
      ).rejects.toMatchObject(ruleError('advance_changed', { availablePaise: 300 }));
      await move(a, customerId, { kind: 'advance_used', amountPaise: 300, billId });
      expect((await accountOf(a, customerId))?.balancePaise).toBe(0);
    });

    it('reverses a payment once, and only a payment of that customer, for its exact amount', async () => {
      const customerId = await addCustomer(a);
      const other = await addCustomer(a);
      await sell(a, customerId, 1_000);
      const bill = (await entriesOf(a, customerId))[0];
      const paid = await pay(a, customerId, 600);
      const reverse = (target: string, amountPaise: number, who = customerId) =>
        move(a, who, {
          kind: 'payment_reversal',
          amountPaise,
          reversesEntryId: target,
          reason: 'Typo',
        });
      await expect(reverse(bill?.id ?? '', 1_000)).rejects.toMatchObject(
        ruleError('payment_not_found'),
      );
      await expect(reverse(paid.entryId, 600, other)).rejects.toMatchObject(
        ruleError('payment_not_found'),
      );
      await expect(reverse(paid.entryId, 500)).rejects.toMatchObject(ruleError('invalid'));
      await expect(reverse(crypto.randomUUID(), 600)).rejects.toMatchObject(
        ruleError('payment_not_found'),
      );
      await reverse(paid.entryId, 600);
      await expect(reverse(paid.entryId, 600)).rejects.toMatchObject(ruleError('already_reversed'));
      expect((await accountOf(a, customerId))?.balancePaise).toBe(1_000);
    });

    it('takes an opening balance once per customer', async () => {
      const customerId = await addCustomer(a);
      const opening = {
        kind: 'opening' as const,
        amountPaise: 700,
        reason: 'Notebook',
        dueFrom: '2026-10-01',
      };
      await move(a, customerId, opening);
      await expect(move(a, customerId, opening)).rejects.toMatchObject(ruleError('opening_exists'));
      expect((await accountOf(a, customerId))?.balancePaise).toBe(700);
    });

    it('takes an opening balance after the first entry too (03 #20), still once', async () => {
      const customerId = await addCustomer(a);
      await sell(a, customerId, 1_000);
      const moved = await move(a, customerId, {
        kind: 'opening',
        amountPaise: 700,
        reason: 'Notebook',
        dueFrom: '2026-10-01',
      });
      expect(moved.balanceAfterPaise).toBe(1_700);
      expect(moved.dueDate).toBe('2026-10-31');
      expect((await accountOf(a, customerId))?.balancePaise).toBe(1_700);
      await expect(
        move(a, customerId, { kind: 'opening', amountPaise: 100, reason: 'Again' }),
      ).rejects.toMatchObject(ruleError('opening_exists'));
    });

    it.each([
      ['a bill that takes money off', { kind: 'bill', amountPaise: -1, billIdNeeded: true }],
      ['a bill with no bill', { kind: 'bill', amountPaise: 1 }],
      ['a payment that adds', { kind: 'payment', amountPaise: 1, mode: 'cash' }],
      ['a payment with no mode', { kind: 'payment', amountPaise: -1 }],
      ['a cheque with no number', { kind: 'payment', amountPaise: -1, mode: 'cheque' }],
      ['an opening of nothing', { kind: 'opening', amountPaise: 0, reason: 'x' }],
      ['an opening with no note', { kind: 'opening', amountPaise: 5 }],
      ['a reversal with no reason', { kind: 'payment_reversal', amountPaise: 1 }],
      ['half a paisa', { kind: 'payment', amountPaise: -1.5, mode: 'cash' }],
    ])('refuses %s before writing anything', async (_, input) => {
      const customerId = await addCustomer(a);
      const { billIdNeeded, ...rest } = input as Record<string, unknown>;
      const billId = billIdNeeded === true ? await addBill(a) : undefined;
      await expect(
        move(a, customerId, {
          ...(rest as Pick<MoveUdhaarInput, 'kind' | 'amountPaise'>),
          ...(billId !== undefined && { billId }),
        }),
      ).rejects.toMatchObject(ruleError('invalid'));
      expect(await accountOf(a, customerId)).toBeUndefined();
      expect(await entriesOf(a, customerId)).toEqual([]);
    });

    it('refuses a customer that does not exist, or belongs to another business', async () => {
      const theirs = await addCustomer(b);
      await expect(
        move(a, theirs, { kind: 'payment', amountPaise: -1, mode: 'cash' }),
      ).rejects.toMatchObject(ruleError('not_found'));
      await expect(
        move(a, crypto.randomUUID(), { kind: 'payment', amountPaise: -1, mode: 'cash' }),
      ).rejects.toMatchObject(ruleError('not_found'));
    });

    it('rolls the balance back with the action that failed', async () => {
      const customerId = await addCustomer(a);
      await expect(
        inShop(a, async (tx) => {
          await moveUdhaar(tx, {
            customerId,
            branchId: a.branchId,
            actorId: a.ownerId,
            businessDate: '2026-11-20',
            kind: 'payment',
            amountPaise: -100,
            mode: 'cash',
          });
          throw new Error('the bill failed after taking the payment');
        }),
      ).rejects.toThrow('the bill failed');
      expect(await accountOf(a, customerId)).toBeUndefined();
      expect(await entriesOf(a, customerId)).toEqual([]);
    });

    it('answers a retry on the request key with a database refusal, per business', async () => {
      const customerId = await addCustomer(a);
      const key = crypto.randomUUID();
      await pay(a, customerId, 100, { requestKey: key });
      await expect(pay(a, customerId, 100, { requestKey: key })).rejects.toMatchObject(
        failsWith('23505', 'udhaar_entries_request_key_unique'),
      );
      // The refused try left no trace.
      expect((await accountOf(a, customerId))?.balancePaise).toBe(-100);
      // Another business may use the same key.
      const theirs = await addCustomer(b);
      await pay(b, theirs, 100, { requestKey: key });
    });

    it('lets a bill have one bill entry and one advance entry, so a retry cannot count twice', async () => {
      const customerId = await addCustomer(a);
      const billId = await addBill(a);
      await move(a, customerId, { kind: 'bill', amountPaise: 100, billId });
      await expect(
        move(a, customerId, { kind: 'bill', amountPaise: 100, billId }),
      ).rejects.toMatchObject(failsWith('23505', 'udhaar_entries_bill_unique'));
      expect((await accountOf(a, customerId))?.balancePaise).toBe(100);
    });
  });

  describe('findUdhaarMismatches', () => {
    it('finds a balance that is not the sum of its entries, or not the last balance_after', async () => {
      const shop = await signUp('Tampered');
      const customerId = await addCustomer(shop);
      await sell(shop, customerId, 1_000);
      await pay(shop, customerId, 300);
      expect(await inShop(shop, (tx) => findUdhaarMismatches(tx))).toEqual([]);
      // Only the owner role can do this; the app can't.
      await admin.query('update udhaar_accounts set balance_paise = 1 where customer_id = $1', [
        customerId,
      ]);
      expect(await inShop(shop, (tx) => findUdhaarMismatches(tx))).toEqual([
        { customerId, balancePaise: 1, summedPaise: 700, lastBalancePaise: 700 },
      ]);
      await admin.query('update udhaar_accounts set balance_paise = 700 where customer_id = $1', [
        customerId,
      ]);
      await admin.query(
        `update udhaar_entries set balance_after_paise = 5 where customer_id = $1 and kind = 'bill'`,
        [customerId],
      );
      // The chain is broken at the first entry even though the totals still agree.
      expect(await inShop(shop, (tx) => findUdhaarMismatches(tx))).toEqual([
        { customerId, balancePaise: 700, summedPaise: 700, lastBalancePaise: 700 },
      ]);
    });

    it('finds an entry with no account', async () => {
      const shop = await signUp('No account');
      const customerId = await addCustomer(shop);
      await sell(shop, customerId, 1_000);
      await admin.query('alter table udhaar_accounts disable trigger all');
      await admin.query('update udhaar_entries set last_entry_id = null').catch(() => undefined);
      await admin.query('update udhaar_accounts set last_entry_id = null where customer_id = $1', [
        customerId,
      ]);
      await admin.query('delete from udhaar_accounts where customer_id = $1', [customerId]);
      expect(await inShop(shop, (tx) => findUdhaarMismatches(tx))).toEqual([
        { customerId, balancePaise: 0, summedPaise: 1_000, lastBalancePaise: null },
      ]);
      // Put it right again so the end-of-test audit holds.
      await admin.query('delete from udhaar_entries where customer_id = $1', [customerId]);
    });

    it('sees only its own business', async () => {
      const shop = await signUp('Own');
      const customerId = await addCustomer(shop);
      await sell(shop, customerId, 1_000);
      await admin.query('update udhaar_accounts set balance_paise = 1 where customer_id = $1', [
        customerId,
      ]);
      expect(await inShop(a, (tx) => findUdhaarMismatches(tx))).toEqual([]);
      expect(await inShop(shop, (tx) => findUdhaarMismatches(tx))).toHaveLength(1);
      await admin.query('update udhaar_accounts set balance_paise = 1000 where customer_id = $1', [
        customerId,
      ]);
    });
  });

  describe('two counters at once', () => {
    it('counts 20 simultaneous bills and payments to one customer exactly, in an unbroken chain', async () => {
      const customerId = await addCustomer(a);
      const bills = await Promise.all(Array.from({ length: 10 }, () => addBill(a)));
      await Promise.all([
        ...bills.map((billId) => move(a, customerId, { kind: 'bill', amountPaise: 1_000, billId })),
        ...Array.from({ length: 10 }, () => pay(a, customerId, 300)),
      ]);
      expect((await accountOf(a, customerId))?.balancePaise).toBe(10 * 1_000 - 10 * 300);
      const entries = await entriesOf(a, customerId);
      expect(entries).toHaveLength(20);
      let running = 0;
      for (const entry of entries) {
        running += entry.amountPaise;
        expect(entry.balanceAfterPaise).toBe(running);
      }
    });

    it('makes the account once when two counters give a new customer their first entries together', async () => {
      const customerId = await addCustomer(a);
      await Promise.all(Array.from({ length: 5 }, () => pay(a, customerId, 100)));
      expect((await accountOf(a, customerId))?.balancePaise).toBe(-500);
      const { rows } = await admin.query<{ count: string }>(
        'select count(*) from udhaar_accounts where customer_id = $1',
        [customerId],
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('lets only as much advance be used as there is when two counters use it together', async () => {
      const customerId = await addCustomer(a);
      await pay(a, customerId, 500);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, async () =>
          move(a, customerId, { kind: 'advance_used', amountPaise: 200, billId: await addBill(a) }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(UdhaarRuleError);
          expect(result.reason).toMatchObject({ code: 'advance_changed', availablePaise: 100 });
        }
      }
      expect((await accountOf(a, customerId))?.balancePaise).toBe(-100);
    });

    it('locks the account row, so a second counter waits for the first (ADR 0007 rule 6)', async () => {
      const customerId = await addCustomer(a);
      await pay(a, customerId, 100);
      const holder = await admin.connect();
      const impatient = createDatabase(server.runtimeUrl, vi.fn(), {
        lockTimeoutMs: 200,
        statementTimeoutMs: 5_000,
        idleInTransactionTimeoutMs: 5_000,
      });
      try {
        await holder.query('begin');
        await holder.query('select 1 from udhaar_accounts where customer_id = $1 for update', [
          customerId,
        ]);
        await expect(
          move(a, customerId, { kind: 'payment', amountPaise: -1, mode: 'cash' }, impatient),
        ).rejects.toMatchObject(failsWith('55P03'));
        await expect(inShop(a, (tx) => lockUdhaarAccount(tx, customerId))).resolves.toBeDefined();
      } catch {
        // The second assertion waits for the holder; it is only reached after it lets go.
      } finally {
        await holder.query('rollback');
        holder.release();
        await impatient.close();
      }
      expect((await accountOf(a, customerId))?.balancePaise).toBe(-100);
    });
  });

  describe('two businesses', () => {
    it('keeps each business balances and entries apart', async () => {
      const mine = await addCustomer(a);
      const theirs = await addCustomer(b);
      await sell(a, mine, 1_000);
      await sell(b, theirs, 2_000);
      expect(
        (await inShop(a, (tx) => tx.select().from(udhaarAccounts))).map((r) => r.customerId),
      ).toContain(mine);
      expect(
        await inShop(a, (tx) =>
          tx
            .select()
            .from(udhaarEntries)
            .where(sql`${udhaarEntries.customerId} = ${theirs}`),
        ),
      ).toEqual([]);
      expect(await accountOf(a, theirs)).toBeUndefined();
      expect((await accountOf(b, theirs))?.balancePaise).toBe(2_000);
      // An entry can't be written into the other business's ledger, even by id.
      await expect(
        inShop(a, (tx) =>
          tx.insert(udhaarEntries).values({
            customerId: theirs,
            branchId: a.branchId,
            kind: 'payment',
            amountPaise: -1,
            balanceAfterPaise: -1,
            mode: 'cash',
            businessDate: '2026-11-20',
            createdBy: a.ownerId,
          }),
        ),
      ).rejects.toMatchObject(failsWith('23503'));
    });
  });
});
