// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: the udhaar ledger at the
// counter and its routes (P1.18 design §5, §6, §8; Module 03).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  addDays,
  businessDate,
  PERMISSIONS,
  type ApprovalView,
  type CustomerView,
  type ItemView,
  type Permission,
  type SavedBillView,
  type SettingsView,
  type UdhaarCustomersView,
  type UdhaarLedgerView,
  type UdhaarMoveView,
  type UdhaarSummaryView,
} from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashToken } from '../auth/tokens.js';
import type { Caller, SessionResolver } from '../http/session.js';

const CSRF = 'csrf-token-for-tests';
const PASSWORD = 'correct horse battery';
const headerSessions: SessionResolver = {
  resolve(request: IncomingMessage) {
    const header = request.headers['x-test-caller'];
    return Promise.resolve(typeof header === 'string' ? (JSON.parse(header) as Caller) : null);
  },
  recordActivity: () => Promise.resolve(),
};

type Body = Record<string, unknown>;
const today = businessDate(new Date());
/** One kilo of the test rice: 5% GST included in its price. */
const RICE = 12_000;

describe('udhaar', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  let signups = 0;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed fetch helper
  async function call<T = Body>(
    method: string,
    path: string,
    caller: Caller | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': CSRF,
        ...(caller && { 'x-test-caller': JSON.stringify(caller) }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    // A 204 has no body.
    const text = await response.text();
    return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
  }

  async function shop(): Promise<Caller> {
    const tag = crypto.randomUUID().slice(0, 8);
    const created = await call(
      'POST',
      '/signup',
      null,
      {
        businessName: `Shop ${tag}`,
        businessType: 'kirana',
        phone: '9111111111',
        stateCode: '27',
        gstStatus: 'regular',
        email: `udhaar-${tag}@example.com`,
        password: PASSWORD,
      },
      { 'x-forwarded-for': `10.1.${String(++signups)}.1` },
    );
    expect(created.status).toBe(201);
    const { businessId } = created.body as { businessId: string };
    await admin.pool.query(`update branches set gstin = '27ABCDE1234F1Z5' where business_id = $1`, [
      businessId,
    ]);
    const { rows } = await admin.pool.query<{ id: string; branch_id: string }>(
      `select u.id, b.id as branch_id from users u join branches b using (business_id)
        where u.business_id = $1 and u.role = 'owner'`,
      [businessId],
    );
    return {
      businessId,
      userId: rows[0]?.id ?? '',
      sessionId: '0190f0f0-0000-7000-8000-0000000000c1',
      branchId: rows[0]?.branch_id ?? '',
      role: 'owner',
      permissions: PERMISSIONS,
      locked: false,
      csrfHash: hashToken(CSRF),
    };
  }

  const staff = (caller: Caller, permissions: Permission[]): Caller => ({
    ...caller,
    role: 'staff',
    permissions,
  });
  const cashier = (caller: Caller) => staff(caller, ['session.own', 'billing.sell']);
  const creditCashier = (caller: Caller) =>
    staff(caller, ['session.own', 'billing.sell', 'billing.udhaar', 'customers.view']);

  async function rice(caller: Caller, units = 100_000): Promise<ItemView> {
    const made = await call<ItemView>('POST', '/items', caller, {
      kind: 'goods',
      name: `Rice ${crypto.randomUUID().slice(0, 8)}`,
      hindiName: null,
      code: null,
      categoryId: null,
      brand: null,
      stockUnit: 'kg',
      sellingPrice: RICE,
      wholesalePrice: null,
      purchasePrice: 9_000,
      mrp: null,
      priceIncludesTax: true,
      gstRate: 500,
      hsn: '1006',
      packs: [],
      levels: [],
      barcodes: [],
    });
    expect(made.status).toBe(201);
    const opening = await call('POST', `/items/${made.body.id}/stock/opening`, caller, {
      quantity: units,
      requestKey: crypto.randomUUID(),
    });
    expect(opening.status).toBe(201);
    return made.body;
  }

  async function customer(caller: Caller, extra: Body = {}): Promise<CustomerView> {
    const made = await call<CustomerView>('POST', '/customers', caller, {
      name: `Customer ${crypto.randomUUID().slice(0, 8)}`,
      phone: String(9_000_000_000 + Math.floor(Math.random() * 999_999_999)),
      gstin: null,
      legalName: null,
      address: null,
      pinCode: null,
      stateCode: null,
      ...extra,
    });
    expect(made.status).toBe(201);
    return made.body;
  }

  /** The owner sets a customer's terms; `version` is read first. */
  async function terms(owner: Caller, who: CustomerView, extra: Body): Promise<CustomerView> {
    const { version, id, ...rest } = who;
    const saved = await call<CustomerView>('PUT', `/customers/${id}`, owner, {
      ...rest,
      version,
      ...extra,
    });
    expect(saved.status).toBe(200);
    return saved.body;
  }

  interface Pay {
    mode: string;
    amountPaise: number;
  }

  /** A bill of `kilos` kg of `item` for `who`, paid with `payments` (the rest in cash). */
  function bill(item: ItemView, who: CustomerView | null, kilos: number, payments: Pay[]): Body {
    const total = RICE * kilos;
    const rest = total - payments.reduce((sum, pay) => sum + pay.amountPaise, 0);
    return {
      billKey: crypto.randomUUID(),
      priceList: 'retail',
      customerId: who?.id ?? null,
      placeOfSupplyStateCode: '27',
      lines: [
        {
          itemId: item.id,
          packId: null,
          quantityThousandths: kilos * 1_000,
          shownUnitPricePaise: RICE,
        },
      ],
      payments: [...payments, ...(rest > 0 ? [{ mode: 'cash', amountPaise: rest }] : [])],
      shownGrandTotalPaise: total,
    };
  }

  const save = (caller: Caller, body: Body) =>
    call<SavedBillView & { code?: string; [key: string]: unknown }>('POST', '/bills', caller, body);

  const udhaar = (amountPaise: number): Pay => ({ mode: 'udhaar', amountPaise });
  const advance = (amountPaise: number): Pay => ({ mode: 'advance', amountPaise });

  /** The owner's OK for `amountPaise` of udhaar on the bill `billKey`. */
  const approveCredit = (caller: Caller, billKey: unknown, amountPaise: number) =>
    call<ApprovalView & { code?: string }>('POST', '/billing/approvals', caller, {
      billKey,
      kind: 'credit_limit',
      amountPaise,
      ownerPassword: PASSWORD,
    });

  const pay = (caller: Caller, who: CustomerView, amountPaise: number, extra: Body = {}) =>
    call<UdhaarMoveView & { code?: string }>('POST', '/udhaar/payments', caller, {
      requestKey: crypto.randomUUID(),
      customerId: who.id,
      amountPaise,
      mode: 'cash',
      ...extra,
    });

  const ledger = (caller: Caller, who: CustomerView, query = '') =>
    call<UdhaarLedgerView>('GET', `/udhaar/customers/${who.id}${query}`, caller);

  const balanceOf = async (who: CustomerView) => {
    const { rows } = await admin.pool.query<{ balance_paise: string }>(
      'select balance_paise from udhaar_accounts where customer_id = $1',
      [who.id],
    );
    return rows[0] === undefined ? null : Number(rows[0].balance_paise);
  };

  const entriesOf = async (who: CustomerView) =>
    (
      await admin.pool.query<{
        kind: string;
        amount_paise: string;
        balance_after_paise: string;
        due_date: string | null;
        bill_id: string | null;
      }>(
        `select kind, amount_paise, balance_after_paise, to_char(due_date, 'YYYY-MM-DD') as due_date, bill_id
           from udhaar_entries where customer_id = $1 order by id`,
        [who.id],
      )
    ).rows.map((row) => ({
      kind: row.kind,
      amount: Number(row.amount_paise),
      after: Number(row.balance_after_paise),
      dueDate: row.due_date,
      billId: row.bill_id,
    }));

  const stockOf = async (caller: Caller, item: ItemView) => {
    const { rows } = await admin.pool.query<{ quantity: string }>(
      'select quantity from item_stock where branch_id = $1 and item_id = $2',
      [caller.branchId, item.id],
    );
    return Number(rows[0]?.quantity ?? 0);
  };

  const billCount = async (caller: Caller) =>
    Number(
      (
        await admin.pool.query<{ count: string }>(
          'select count(*) from bills where business_id = $1',
          [caller.businessId],
        )
      ).rows[0]?.count,
    );

  const logOf = async (caller: Caller, action: string) =>
    (
      await admin.pool.query<{
        entity_id: string;
        reason: string | null;
        before: Body;
        after: Body;
      }>(
        'select entity_id, reason, before, after from entry_log where business_id = $1 and action = $2 order by id',
        [caller.businessId, action],
      )
    ).rows;

  beforeAll(async () => {
    server = await startTestDatabase();
    admin = createDatabase(server.adminUrl, () => undefined);
    app = await createApp(
      { databaseUrl: server.runtimeUrl, host: '127.0.0.1', port: 0, jsonLogs: false },
      { sessions: headerSessions },
    );
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    base = `http://127.0.0.1:${String(port)}/api`;
  });

  afterAll(async () => {
    // Every account in every business a test made equals the sum of its entries.
    const { rows } = await admin.pool.query<{ customer_id: string }>(
      `select a.customer_id from udhaar_accounts a
         left join (select customer_id, sum(amount_paise) as summed, count(*) as entries
                      from udhaar_entries group by customer_id) s using (customer_id)
        where a.balance_paise <> coalesce(s.summed, 0)
           or a.balance_paise <> coalesce((select e.balance_after_paise from udhaar_entries e
                                            where e.id = a.last_entry_id), 0)`,
    );
    expect(rows).toEqual([]);
    await app.close();
    await admin.close();
    await server.stop();
  });

  describe('selling on credit', () => {
    it('puts the unpaid part on the customer, with a due date, and keeps the bill whole', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      const saved = await save(a, bill(item, sunita, 2, [udhaar(15_000)]));
      expect(saved.status).toBe(201);
      expect(saved.body.creditWarning).toBeNull();
      expect(await balanceOf(sunita)).toBe(15_000);
      expect(await entriesOf(sunita)).toEqual([
        {
          kind: 'bill',
          amount: 15_000,
          after: 15_000,
          dueDate: addDays(today, 30),
          billId: saved.body.id,
        },
      ]);
      const { rows } = await admin.pool.query<{ mode: string; amount_paise: string }>(
        'select mode, amount_paise from bill_payments where bill_id = $1 order by mode',
        [saved.body.id],
      );
      expect(rows).toEqual([
        { mode: 'cash', amount_paise: '9000' },
        { mode: 'udhaar', amount_paise: '15000' },
      ]);
      expect(await stockOf(a, item)).toBe(98_000);
      expect((await logOf(a, 'bill.created'))[0]?.after).toMatchObject({
        udhaarPaise: 15_000,
        advancePaise: 0,
        creditApprovalId: null,
        udhaarBalanceAfterPaise: 15_000,
      });
    });

    it("uses the customer's own due days, fixed at the time of the bill", async () => {
      const a = await shop();
      const item = await rice(a);
      const kamal = await terms(a, await customer(a), { dueDays: 10 });
      await save(a, bill(item, kamal, 1, [udhaar(RICE)]));
      await terms(a, kamal, { dueDays: 45 });
      await pay(a, kamal, RICE);
      await save(a, bill(item, kamal, 1, [udhaar(RICE)]));
      expect((await entriesOf(kamal)).map((entry) => entry.dueDate)).toEqual([
        addDays(today, 10),
        null,
        addDays(today, 45),
      ]);
    });

    it('refuses udhaar with no customer, or one with no phone, and writes nothing', async () => {
      const a = await shop();
      const item = await rice(a);
      const noPhone = await customer(a, { phone: null });
      expect(await save(a, bill(item, null, 1, [udhaar(RICE)]))).toMatchObject({
        status: 422,
        body: { code: 'udhaar_needs_customer' },
      });
      expect(await save(a, bill(item, noPhone, 1, [udhaar(RICE)]))).toMatchObject({
        status: 422,
        body: { code: 'udhaar_needs_phone' },
      });
      expect(await save(a, bill(item, null, 1, [advance(RICE)]))).toMatchObject({
        status: 422,
        body: { code: 'udhaar_needs_customer' },
      });
      expect(await billCount(a)).toBe(0);
      expect(await stockOf(a, item)).toBe(100_000);
      expect(await balanceOf(noPhone)).toBeNull();
    });

    it('lets staff give udhaar only with "Give udhaar" on', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await terms(a, await customer(a), { creditLimitPaise: 100_000 });
      expect(await save(cashier(a), bill(item, sunita, 1, [udhaar(RICE)]))).toMatchObject({
        status: 403,
        body: { code: 'udhaar_not_allowed' },
      });
      expect(await balanceOf(sunita)).toBeNull();
      expect((await save(creditCashier(a), bill(item, sunita, 1, [udhaar(RICE)]))).status).toBe(
        201,
      );
      expect(await balanceOf(sunita)).toBe(RICE);
    });

    it('sells without udhaar as before, and makes no account for a cash bill', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      expect((await save(cashier(a), bill(item, sunita, 1, []))).status).toBe(201);
      expect(await balanceOf(sunita)).toBeNull();
    });
  });

  describe('using an advance', () => {
    it('takes the advance as a payment row, and the rest as cash', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      await pay(a, sunita, 5_000);
      expect(await balanceOf(sunita)).toBe(-5_000);
      const saved = await save(cashier(a), bill(item, sunita, 1, [advance(3_000)]));
      expect(saved.status).toBe(201);
      expect(await balanceOf(sunita)).toBe(-2_000);
      expect((await entriesOf(sunita)).map((entry) => [entry.kind, entry.amount])).toEqual([
        ['payment', -5_000],
        ['advance_used', 3_000],
      ]);
      // Advance and udhaar together: the advance goes first, then the rest is owed.
      const both = await save(a, bill(item, sunita, 1, [advance(2_000), udhaar(4_000)]));
      expect(both.status).toBe(201);
      expect(await balanceOf(sunita)).toBe(4_000);
    });

    it('refuses more advance than there is, saying how much there is, and writes nothing', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      await pay(a, sunita, 1_000);
      expect(await save(a, bill(item, sunita, 1, [advance(1_001)]))).toMatchObject({
        status: 409,
        body: { code: 'advance_changed', availablePaise: 1_000 },
      });
      expect(await billCount(a)).toBe(0);
      expect(await stockOf(a, item)).toBe(100_000);
      expect(await balanceOf(sunita)).toBe(-1_000);
    });

    it('lets two counters use one advance only once', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      await pay(a, sunita, 1_000);
      const results = await Promise.all([
        save(a, bill(item, sunita, 1, [advance(1_000)])),
        save(a, bill(item, sunita, 1, [advance(1_000)])),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(results.find((result) => result.status === 409)?.body).toMatchObject({
        code: 'advance_changed',
        availablePaise: 0,
      });
      expect(await balanceOf(sunita)).toBe(0);
      expect(await billCount(a)).toBe(1);
    });
  });

  describe('the credit limit', () => {
    // The table of design §5: who, the setting, the limit, and what happens to a bill that takes
    // the customer from ₹0 to ₹120 (RICE).
    it.each([
      ['owner', 'warn', 5_000, 'warns'],
      ['owner', 'block', 5_000, 'needs the OK'],
      ['staff', 'warn', 5_000, 'needs the OK'],
      ['staff', 'block', 5_000, 'needs the OK'],
      ['owner', 'warn', null, 'saves'],
      ['owner', 'block', null, 'saves'],
      ['staff', 'warn', null, 'needs the OK'],
      ['staff', 'block', null, 'needs the OK'],
      ['owner', 'block', RICE, 'saves'],
      ['staff', 'block', RICE, 'saves'],
      ['staff', 'warn', RICE - 1, 'needs the OK'],
    ] as const)('%s, %s, limit %s: the bill %s', async (who, setting, limit, outcome) => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await terms(a, await customer(a), { creditLimitPaise: limit });
      expect((await call('PUT', '/settings/udhaar', a, { overCreditLimit: setting })).status).toBe(
        200,
      );
      const caller = who === 'owner' ? a : creditCashier(a);
      const draft = bill(item, sunita, 1, [udhaar(RICE)]);
      const saved = await save(caller, draft);
      if (outcome === 'saves') {
        expect(saved.status).toBe(201);
        expect(saved.body.creditWarning).toBeNull();
        expect(await balanceOf(sunita)).toBe(RICE);
      } else if (outcome === 'warns') {
        expect(saved.status).toBe(201);
        expect(saved.body.creditWarning).toEqual({ balanceAfterPaise: RICE, limitPaise: limit });
        expect(await balanceOf(sunita)).toBe(RICE);
      } else {
        expect(saved).toMatchObject({
          status: 409,
          body: { code: 'over_credit_limit', balancePaise: 0, limitPaise: limit },
        });
        expect(await billCount(a)).toBe(0);
        expect(await stockOf(a, item)).toBe(100_000);
        expect(await balanceOf(sunita)).toBeNull();
        // The owner's password lets this one bill through.
        const ok = await approveCredit(caller, draft.billKey, RICE);
        expect(ok.status).toBe(201);
        const again = await save(caller, { ...draft, creditApprovalId: ok.body.approvalId });
        expect(again.status).toBe(201);
        expect(await balanceOf(sunita)).toBe(RICE);
        const { rows } = await admin.pool.query<{ used: boolean; credit_approval_id: string }>(
          `select o.used_at is not null as used, b.credit_approval_id
             from bills b join owner_approvals o on o.id = b.credit_approval_id where b.id = $1`,
          [again.body.id],
        );
        expect(rows).toEqual([{ used: true, credit_approval_id: ok.body.approvalId }]);
      }
    });

    it('counts what the customer already owes, and an advance used on the same bill', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await terms(a, await customer(a), { creditLimitPaise: 20_000 });
      await call('PUT', '/settings/udhaar', a, { overCreditLimit: 'block' });
      expect((await save(a, bill(item, sunita, 1, [udhaar(RICE)]))).status).toBe(201);
      // 12,000 owed; 12,000 more is 24,000 > 20,000.
      expect(await save(a, bill(item, sunita, 1, [udhaar(RICE)]))).toMatchObject({
        status: 409,
        body: { code: 'over_credit_limit', balancePaise: RICE, limitPaise: 20_000 },
      });
      // Paying 5,000 off brings it back inside: 7,000 + 12,000 = 19,000.
      await pay(a, sunita, 5_000);
      expect((await save(a, bill(item, sunita, 1, [udhaar(RICE)]))).status).toBe(201);
      expect(await balanceOf(sunita)).toBe(19_000);
    });

    it("refuses an owner's OK that is too small, used, for another bill or of another kind", async () => {
      const a = await shop();
      const item = await rice(a);
      const desk = creditCashier(a);
      const sunita = await terms(a, await customer(a), { creditLimitPaise: 1_000 });
      const draft = bill(item, sunita, 1, [udhaar(RICE)]);
      const invalid = { status: 409, body: { code: 'approval_invalid' } };

      const small = await approveCredit(desk, draft.billKey, RICE - 1);
      expect(await save(desk, { ...draft, creditApprovalId: small.body.approvalId })).toMatchObject(
        invalid,
      );
      const other = await approveCredit(desk, crypto.randomUUID(), RICE);
      expect(await save(desk, { ...draft, creditApprovalId: other.body.approvalId })).toMatchObject(
        invalid,
      );
      const discount = await call<ApprovalView>('POST', '/billing/approvals', desk, {
        billKey: draft.billKey,
        kind: 'discount',
        lineBasisPoints: 100,
        billBasisPoints: 100,
        ownerPassword: PASSWORD,
      });
      expect(
        await save(desk, { ...draft, creditApprovalId: discount.body.approvalId }),
      ).toMatchObject(invalid);
      expect(await save(desk, { ...draft, creditApprovalId: crypto.randomUUID() })).toMatchObject(
        invalid,
      );
      expect(await balanceOf(sunita)).toBeNull();

      const ok = await approveCredit(desk, draft.billKey, RICE);
      expect(await save(desk, { ...draft, creditApprovalId: ok.body.approvalId })).toMatchObject({
        status: 201,
      });
      // Used up, and only ever for its own bill.
      const next = bill(item, sunita, 1, [udhaar(RICE)]);
      expect(await save(desk, { ...next, creditApprovalId: ok.body.approvalId })).toMatchObject(
        invalid,
      );
      expect(await balanceOf(sunita)).toBe(RICE);
    });

    it('lets one bill need a discount OK and a credit OK, each its own approval', async () => {
      const a = await shop();
      const item = await rice(a);
      const desk = creditCashier(a);
      const sunita = await terms(a, await customer(a), { creditLimitPaise: 1_000 });
      const draft: Body = {
        ...bill(item, sunita, 1, [udhaar(10_800)]),
        lines: [
          {
            itemId: item.id,
            packId: null,
            quantityThousandths: 1_000,
            shownUnitPricePaise: RICE,
            discount: { kind: 'percent', basisPoints: 1_000 },
          },
        ],
        shownGrandTotalPaise: 10_800,
        payments: [udhaar(10_800)],
      };
      const discount = await call<ApprovalView>('POST', '/billing/approvals', desk, {
        billKey: draft.billKey,
        kind: 'discount',
        lineBasisPoints: 1_000,
        billBasisPoints: 1_000,
        ownerPassword: PASSWORD,
      });
      const credit = await approveCredit(desk, draft.billKey, 10_800);
      const saved = await save(desk, {
        ...draft,
        approvalId: discount.body.approvalId,
        creditApprovalId: credit.body.approvalId,
      });
      expect(saved).toMatchObject({ status: 201 });
      expect(await balanceOf(sunita)).toBe(10_800);
    });

    it("logs the owner's OK when it is given, with the amount and who asked", async () => {
      const a = await shop();
      const desk = creditCashier(a);
      const key = crypto.randomUUID();
      const ok = await approveCredit(desk, key, 7_500);
      expect(ok.status).toBe(201);
      const [entry] = await logOf(a, 'credit_limit.approved');
      expect(entry).toMatchObject({
        entity_id: ok.body.approvalId,
        after: { billKey: key, kind: 'credit_limit', amountPaise: 7_500 },
      });
      const wrong = await call('POST', '/billing/approvals', desk, {
        billKey: key,
        kind: 'credit_limit',
        amountPaise: 7_500,
        ownerPassword: 'not the password',
      });
      expect(wrong.status).toBe(401);
      expect(await logOf(a, 'credit_limit.approved')).toHaveLength(1);
    });
  });

  describe('one transaction, never twice', () => {
    it('answers a retry of a bill with the saved bill and one entry, not two', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      const draft = bill(item, sunita, 1, [udhaar(RICE)]);
      const first = await save(a, draft);
      const second = await save(a, draft);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.body.id).toBe(first.body.id);
      expect(await entriesOf(sunita)).toHaveLength(1);
      expect(await balanceOf(sunita)).toBe(RICE);
      const sent = await Promise.all([save(a, draft), save(a, draft), save(a, draft)]);
      expect(sent.map((result) => result.body.id)).toEqual([
        first.body.id,
        first.body.id,
        first.body.id,
      ]);
      expect(await entriesOf(sunita)).toHaveLength(1);
    });

    it('rolls the bill, its stock and its udhaar back together when the stock is short', async () => {
      const a = await shop();
      const item = await rice(a, 1_000);
      await call('PUT', '/settings/stock', a, { negativeStock: 'block' });
      const sunita = await customer(a);
      expect(await save(a, bill(item, sunita, 2, [udhaar(RICE)]))).toMatchObject({
        status: 409,
        body: { code: 'stock_short' },
      });
      expect(await billCount(a)).toBe(0);
      expect(await stockOf(a, item)).toBe(1_000);
      expect(await balanceOf(sunita)).toBeNull();
      expect(await entriesOf(sunita)).toEqual([]);
    });

    it('counts 12 bills saved at once, with payments in between, exactly and without a deadlock', async () => {
      const a = await shop();
      const one = await rice(a);
      const two = await rice(a);
      const sunita = await customer(a);
      const kamal = await customer(a);
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => save(a, bill(one, sunita, 1, [udhaar(RICE)]))),
        ...Array.from({ length: 4 }, () => save(a, bill(two, sunita, 1, [udhaar(5_000)]))),
        ...Array.from({ length: 2 }, () => save(a, bill(one, kamal, 1, [udhaar(RICE)]))),
        ...Array.from({ length: 2 }, () => pay(a, sunita, 1_000)),
      ]);
      expect(results.map((result) => result.status)).toEqual(Array(12).fill(201));
      expect(await balanceOf(sunita)).toBe(4 * RICE + 4 * 5_000 - 2 * 1_000);
      expect(await balanceOf(kamal)).toBe(2 * RICE);
      const chain = await entriesOf(sunita);
      let running = 0;
      for (const entry of chain) {
        running += entry.amount;
        expect(entry.after).toBe(running);
      }
    });

    it('saves two concurrent bills to one customer under the limit check one after the other', async () => {
      const a = await shop();
      const item = await rice(a);
      await call('PUT', '/settings/udhaar', a, { overCreditLimit: 'block' });
      const sunita = await terms(a, await customer(a), { creditLimitPaise: RICE + 1_000 });
      const results = await Promise.all([
        save(a, bill(item, sunita, 1, [udhaar(RICE)])),
        save(a, bill(item, sunita, 1, [udhaar(RICE)])),
      ]);
      // Both would fit alone; together they don't, so exactly one gets the owner's OK question.
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await balanceOf(sunita)).toBe(RICE);
    });
  });

  describe('recording payments', () => {
    it('takes any amount at any time, and an overpayment is an advance', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      await save(a, bill(item, sunita, 1, [udhaar(RICE)]));
      const part = await pay(cashier(a), sunita, 4_000, { mode: 'upi', reference: '1234' });
      expect(part.status).toBe(201);
      expect(part.body).toMatchObject({
        customerId: sunita.id,
        balancePaise: 8_000,
        entry: { kind: 'payment', amountPaise: -4_000, mode: 'upi', reference: '1234' },
      });
      const over = await pay(a, sunita, 10_000, { mode: 'cheque', reference: '000123' });
      expect(over.body.balancePaise).toBe(-2_000);
      expect(await balanceOf(sunita)).toBe(-2_000);
      const [first, second] = await logOf(a, 'udhaar.payment_recorded');
      expect(first).toMatchObject({
        entity_id: sunita.id,
        after: { amountPaise: 4_000, mode: 'upi', balanceAfterPaise: 8_000 },
      });
      expect(second?.after).toMatchObject({ amountPaise: 10_000, mode: 'cheque' });
    });

    it('needs a cheque number, a positive whole amount, and a customer of this business', async () => {
      const a = await shop();
      const b = await shop();
      const sunita = await customer(a);
      const theirs = await customer(b);
      expect((await pay(a, sunita, 100, { mode: 'cheque' })).status).toBe(400);
      expect((await pay(a, sunita, 0)).status).toBe(400);
      expect((await pay(a, sunita, 10.5)).status).toBe(400);
      expect((await pay(a, sunita, 100, { mode: 'udhaar' })).status).toBe(400);
      expect(await pay(a, theirs, 100)).toMatchObject({ status: 404 });
      expect(await balanceOf(sunita)).toBeNull();
      expect(await balanceOf(theirs)).toBeNull();
    });

    it('answers a retry with the first payment, and the same key for another payment with key_reused', async () => {
      const a = await shop();
      const sunita = await customer(a);
      const requestKey = crypto.randomUUID();
      const first = await pay(a, sunita, 700, { requestKey });
      const again = await pay(a, sunita, 700, { requestKey });
      expect(again.status).toBe(201);
      expect(again.body).toEqual(first.body);
      expect(await pay(a, sunita, 800, { requestKey })).toMatchObject({
        status: 422,
        body: { code: 'key_reused' },
      });
      expect(await pay(a, sunita, 700, { requestKey, mode: 'upi' })).toMatchObject({
        status: 422,
        body: { code: 'key_reused' },
      });
      const sent = await Promise.all(
        Array.from({ length: 3 }, () => pay(a, sunita, 50, { requestKey: crypto.randomUUID() })),
      );
      expect(sent.map((result) => result.status)).toEqual([201, 201, 201]);
      const same = crypto.randomUUID();
      const raced = await Promise.all(
        Array.from({ length: 3 }, () => pay(a, sunita, 25, { requestKey: same })),
      );
      expect(raced.map((result) => result.status)).toEqual([201, 201, 201]);
      expect(new Set(raced.map((result) => result.body.entry.id)).size).toBe(1);
      // 700 + 3 × 50 + 25, each once.
      expect(await balanceOf(sunita)).toBe(-(700 + 150 + 25));
    });

    it('needs "Sell at the counter" and no other switch', async () => {
      const a = await shop();
      const sunita = await customer(a);
      expect((await pay(staff(a, ['session.own', 'billing.sell']), sunita, 100)).status).toBe(201);
      expect((await pay(staff(a, ['session.own', 'customers.view']), sunita, 100)).status).toBe(
        403,
      );
    });
  });

  describe('correcting a payment (owner only)', () => {
    const reverse = (caller: Caller, id: string, extra: Body = {}) =>
      call<UdhaarMoveView & { code?: string }>('POST', `/udhaar/payments/${id}/reverse`, caller, {
        reason: 'Wrong customer',
        ownerPassword: PASSWORD,
        ...extra,
      });

    it('takes the payment back with a reversing line, with a reason, once', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      await save(a, bill(item, sunita, 1, [udhaar(RICE)]));
      const paid = await pay(a, sunita, RICE);
      expect(await balanceOf(sunita)).toBe(0);
      const back = await reverse(a, paid.body.entry.id);
      expect(back.status).toBe(201);
      expect(back.body).toMatchObject({
        balancePaise: RICE,
        entry: { kind: 'payment_reversal', amountPaise: RICE, reversesEntryId: paid.body.entry.id },
      });
      expect(await reverse(a, paid.body.entry.id)).toMatchObject({
        status: 409,
        body: { code: 'already_reversed' },
      });
      // The bill is owed again, with its own due date; the payment stays in the ledger.
      const seen = await ledger(a, sunita);
      expect(seen.body.unpaid.map((row) => [row.unpaidPaise, row.entry.dueDate])).toEqual([
        [RICE, addDays(today, 30)],
      ]);
      expect(seen.body.entries.map((entry) => entry.kind)).toEqual([
        'payment_reversal',
        'payment',
        'bill',
      ]);
      expect(await logOf(a, 'udhaar.payment_reversed')).toEqual([
        expect.objectContaining({ entity_id: sunita.id, reason: 'Wrong customer' }) as Body,
      ]);
    });

    it('is the owner alone, with the password and a reason, and only for a payment', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      const billed = await save(a, bill(item, sunita, 1, [udhaar(RICE)]));
      const paid = await pay(a, sunita, 500);
      const everything = PERMISSIONS.filter((permission) => permission !== 'settings.manage');
      expect((await reverse(staff(a, [...everything]), paid.body.entry.id)).status).toBe(403);
      expect(
        await reverse(a, paid.body.entry.id, { ownerPassword: 'not the password' }),
      ).toMatchObject({ status: 401 });
      expect((await reverse(a, paid.body.entry.id, { reason: '' })).status).toBe(400);
      expect((await reverse(a, crypto.randomUUID())).status).toBe(404);
      const [entry] = await entriesOf(sunita);
      expect(entry?.billId).toBe(billed.body.id);
      const billEntry = (await ledger(a, sunita)).body.entries.find((row) => row.kind === 'bill');
      expect((await reverse(a, billEntry?.id ?? '')).status).toBe(404);
      expect(await balanceOf(sunita)).toBe(RICE - 500);
    });
  });

  describe('the old notebook (owner only)', () => {
    const opening = (caller: Caller, who: CustomerView, extra: Body = {}) =>
      call<UdhaarMoveView & { code?: string }>('POST', '/udhaar/opening', caller, {
        requestKey: crypto.randomUUID(),
        customerId: who.id,
        amountPaise: 9_000,
        asOf: '2026-10-01',
        reason: 'Old notebook',
        ...extra,
      });

    it('enters what the customer owed once, due from its date, and logs it', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      const requestKey = crypto.randomUUID();
      const first = await opening(a, sunita, { requestKey });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        balancePaise: 9_000,
        entry: { kind: 'opening', dueDate: '2026-10-31', reason: 'Old notebook' },
      });
      // A retry is answered with the first one; a second opening is refused.
      expect((await opening(a, sunita, { requestKey })).body).toEqual(first.body);
      expect(await opening(a, sunita)).toMatchObject({
        status: 409,
        body: { code: 'opening_exists' },
      });
      expect(await opening(a, sunita, { requestKey, amountPaise: 1 })).toMatchObject({
        status: 422,
        body: { code: 'key_reused' },
      });
      expect(await balanceOf(sunita)).toBe(9_000);
      // The old notebook is the oldest: the next payment clears it before a new bill.
      await save(a, bill(item, sunita, 1, [udhaar(RICE)]));
      await pay(a, sunita, 9_000);
      const seen = await ledger(a, sunita);
      expect(seen.body.unpaid.map((row) => [row.entry.kind, row.unpaidPaise])).toEqual([
        ['bill', RICE],
      ]);
      expect(await logOf(a, 'udhaar.opening_set')).toEqual([
        expect.objectContaining({
          entity_id: sunita.id,
          reason: 'Old notebook',
          after: expect.objectContaining({ amountPaise: 9_000, asOf: '2026-10-01' }) as Body,
        }) as Body,
      ]);
    });

    it('is allowed after the first bill, still once, and counts as the oldest (03 #20)', async () => {
      const a = await shop();
      const item = await rice(a);
      const billed = await customer(a);
      await save(a, bill(item, billed, 1, [udhaar(RICE)]));
      const late = await opening(a, billed, { amountPaise: 4_000 });
      expect(late.status).toBe(201);
      expect(late.body.balancePaise).toBe(4_000 + RICE);
      expect(await opening(a, billed)).toMatchObject({
        status: 409,
        body: { code: 'opening_exists' },
      });
      const view = await ledger(a, billed);
      expect(view.body.unpaid.map((unpaid) => unpaid.entry.kind)).toEqual(['opening', 'bill']);
    });

    it('is refused to staff, bad bodies and future days, and may be an advance', async () => {
      const a = await shop();
      const sunita = await customer(a);
      const everything = PERMISSIONS.filter((permission) => permission !== 'settings.manage');
      expect((await opening(staff(a, [...everything]), sunita)).status).toBe(403);
      expect((await opening(a, sunita, { amountPaise: 0 })).status).toBe(400);
      expect((await opening(a, sunita, { asOf: '2026-02-30' })).status).toBe(400);
      expect((await opening(a, sunita, { reason: '' })).status).toBe(400);
      // A future day would push the due date out, so the customer would never be overdue.
      expect(await opening(a, sunita, { asOf: '2099-01-01' })).toMatchObject({
        status: 422,
        body: { code: 'future_date' },
      });
      expect((await opening(a, sunita, { amountPaise: -2_500 })).body.balancePaise).toBe(-2_500);
    });
  });

  describe('looking at the udhaar', () => {
    it('lists customers with their balance, limit and oldest due date, owing first on request', async () => {
      const a = await shop();
      const b = await shop();
      const item = await rice(a);
      const sunita = await terms(a, await customer(a, { name: 'Sunita Devi' }), {
        creditLimitPaise: 50_000,
      });
      const kamal = await customer(a, { name: 'Kamal Singh' });
      const idle = await customer(a, { name: 'Idle Customer' });
      await customer(b, { name: 'Sunita Other Shop' });
      await save(a, bill(item, sunita, 2, [udhaar(RICE * 2)]));
      await pay(a, kamal, 300);
      const all = await call<UdhaarCustomersView>('GET', '/udhaar/customers', a);
      expect(all.status).toBe(200);
      expect(all.body.customers).toEqual([
        {
          id: idle.id,
          name: 'Idle Customer',
          phone: idle.phone,
          balancePaise: 0,
          creditLimitPaise: null,
          oldestDueDate: null,
        },
        {
          id: kamal.id,
          name: 'Kamal Singh',
          phone: kamal.phone,
          balancePaise: -300,
          creditLimitPaise: null,
          oldestDueDate: null,
        },
        {
          id: sunita.id,
          name: 'Sunita Devi',
          phone: sunita.phone,
          balancePaise: RICE * 2,
          creditLimitPaise: 50_000,
          oldestDueDate: addDays(today, 30),
        },
      ]);
      expect(all.body.more).toBe(false);
      const owing = await call<UdhaarCustomersView>('GET', '/udhaar/customers?owing=true', a);
      expect(owing.body.customers.map((row) => row.name)).toEqual(['Sunita Devi']);
      const found = await call<UdhaarCustomersView>('GET', '/udhaar/customers?q=kamal', a);
      expect(found.body.customers.map((row) => row.name)).toEqual(['Kamal Singh']);
      const page = await call<UdhaarCustomersView>('GET', '/udhaar/customers?offset=2', a);
      expect(page.body.customers.map((row) => row.name)).toEqual(['Sunita Devi']);
      const theirs = await call<UdhaarCustomersView>('GET', '/udhaar/customers', b);
      expect(theirs.body.customers.map((row) => row.name)).toEqual(['Sunita Other Shop']);
    });

    it('shows the ledger with the balance after each line, and what is unpaid, oldest cleared first', async () => {
      const a = await shop();
      const item = await rice(a);
      const sunita = await customer(a);
      const first = await save(a, bill(item, sunita, 1, [udhaar(RICE)]));
      const second = await save(a, bill(item, sunita, 1, [udhaar(RICE)]));
      await pay(a, sunita, 15_000);
      const seen = await ledger(creditCashier(a), sunita);
      expect(seen.status).toBe(200);
      expect(seen.body).toMatchObject({
        customerId: sunita.id,
        balancePaise: 9_000,
        creditLimitPaise: null,
        dueDays: 30,
        next: null,
        // The customer's own record comes with it: the page names them and edits their terms.
        customer: {
          id: sunita.id,
          name: sunita.name,
          phone: sunita.phone,
          version: sunita.version,
        },
      });
      expect(
        seen.body.entries.map((entry) => [entry.kind, entry.amountPaise, entry.balanceAfterPaise]),
      ).toEqual([
        ['payment', -15_000, 9_000],
        ['bill', RICE, 24_000],
        ['bill', RICE, RICE],
      ]);
      expect(seen.body.entries.map((entry) => entry.billNumber)).toEqual([
        null,
        second.body.number,
        first.body.number,
      ]);
      // 15,000 paid clears the first bill and 3,000 of the second.
      expect(seen.body.unpaid.map((row) => [row.entry.billId, row.unpaidPaise])).toEqual([
        [second.body.id, 9_000],
      ]);
    });

    it('pages the ledger newest first', async () => {
      const a = await shop();
      const sunita = await customer(a);
      for (let at = 1; at <= 55; at += 1) await pay(a, sunita, at);
      const one = await ledger(a, sunita);
      expect(one.body.entries).toHaveLength(50);
      expect(one.body.entries[0]?.amountPaise).toBe(-55);
      expect(one.body.next).toBe(one.body.entries[49]?.id);
      const two = await ledger(a, sunita, `?before=${one.body.next ?? ''}`);
      expect(two.body.entries.map((entry) => entry.amountPaise)).toEqual([-5, -4, -3, -2, -1]);
      expect(two.body.next).toBeNull();
    });

    it('needs customers.view, and never shows another business', async () => {
      const a = await shop();
      const b = await shop();
      const sunita = await customer(a);
      expect((await ledger(staff(a, ['session.own', 'billing.sell']), sunita)).status).toBe(403);
      expect((await ledger(b, sunita)).status).toBe(404);
      expect(
        (await call('GET', '/udhaar/customers', staff(a, ['session.own', 'billing.sell']))).status,
      ).toBe(403);
    });
  });

  describe('the setting and the credit terms', () => {
    it('keeps "over the credit limit" in settings, owner only, logged', async () => {
      const a = await shop();
      const read = await call<SettingsView>('GET', '/settings', a);
      expect(read.body.udhaar).toEqual({ overCreditLimit: 'warn' });
      const saved = await call<SettingsView>('PUT', '/settings/udhaar', a, {
        overCreditLimit: 'block',
      });
      expect(saved.body.udhaar).toEqual({ overCreditLimit: 'block' });
      expect(
        (
          await call('PUT', '/settings/udhaar', staff(a, ['session.own', 'settings.view']), {
            overCreditLimit: 'warn',
          })
        ).status,
      ).toBe(403);
      expect((await call('PUT', '/settings/udhaar', a, { overCreditLimit: 'never' })).status).toBe(
        400,
      );
      const { rows } = await admin.pool.query<{ before: Body; after: Body }>(
        `select before, after from entry_log where business_id = $1 and action = 'business.updated'`,
        [a.businessId],
      );
      expect(rows).toContainEqual({
        before: { overCreditLimit: 'warn' },
        after: { overCreditLimit: 'block' },
      });
    });

    it('lets only the owner change a credit limit or due days, even for staff who may edit customers', async () => {
      const a = await shop();
      const desk = staff(a, [
        'session.own',
        'customers.view',
        'customers.manage',
        'billing.udhaar',
      ]);
      const sunita = await customer(a);
      expect(sunita).toMatchObject({ creditLimitPaise: null, dueDays: 30 });
      const { version, id, ...rest } = sunita;
      const edit = (extra: Body) =>
        call<CustomerView & { code?: string }>('PUT', `/customers/${id}`, desk, {
          ...rest,
          version,
          ...extra,
        });
      // Staff see them, and may send them back unchanged (the form does).
      expect((await edit({ creditLimitPaise: null, dueDays: 30, name: 'Sunita B' })).status).toBe(
        200,
      );
      const refused = { status: 403, body: { code: 'credit_terms_owner_only' } };
      const now = (
        await call<CustomerView[]>('GET', `/customers?phone=${sunita.phone ?? ''}`, desk)
      ).body[0];
      const again = (extra: Body) =>
        call<CustomerView & { code?: string }>('PUT', `/customers/${id}`, desk, {
          ...rest,
          version: now?.version,
          ...extra,
        });
      expect(await again({ creditLimitPaise: 999_999 })).toMatchObject(refused);
      expect(await again({ dueDays: 90 })).toMatchObject(refused);
      // Not when adding a customer either: a new customer has no limit and 30 days.
      expect(
        await call('POST', '/customers', desk, {
          ...rest,
          name: 'New',
          phone: null,
          creditLimitPaise: 1,
        }),
      ).toMatchObject(refused);
      expect(
        await call('POST', '/customers', desk, { ...rest, name: 'New', phone: null, dueDays: 7 }),
      ).toMatchObject(refused);
      const { rows } = await admin.pool.query<{
        credit_limit_paise: string | null;
        due_days: number;
      }>('select credit_limit_paise, due_days from customers where id = $1', [id]);
      expect(rows).toEqual([{ credit_limit_paise: null, due_days: 30 }]);
      expect(
        (await call('POST', '/customers', desk, { ...rest, name: 'Plain', phone: null })).status,
      ).toBe(201);

      // The owner can, and the change is in the entry log with before and after.
      const saved = await terms(a, now ?? sunita, { creditLimitPaise: 250_000, dueDays: 15 });
      expect(saved).toMatchObject({ creditLimitPaise: 250_000, dueDays: 15 });
      const [, change] = (
        await admin.pool.query<{ before: Body; after: Body }>(
          `select before, after from entry_log where entity_id = $1 and action = 'customer.updated' order by id`,
          [id],
        )
      ).rows;
      expect(change).toEqual({
        before: { creditLimitPaise: null, dueDays: 30 },
        after: { creditLimitPaise: 250_000, dueDays: 15 },
      });
      // A staff edit that leaves them out keeps them.
      const plain = Object.fromEntries(
        Object.entries(rest).filter(([key]) => key !== 'creditLimitPaise' && key !== 'dueDays'),
      );
      const kept = await call<CustomerView>('PUT', `/customers/${id}`, desk, {
        ...plain,
        version: saved.version,
        name: 'Sunita C',
      });
      expect(kept.body).toMatchObject({ creditLimitPaise: 250_000, dueDays: 15 });
    });
  });

  describe('the udhaar views (P1.19; Module 03 #12, #13, #15)', () => {
    const summary = (caller: Caller) => call<UdhaarSummaryView>('GET', '/udhaar/summary', caller);

    /** The old notebook's balance for `who`, already `daysLate` days past its due date (30 days terms). */
    const owedFor = (caller: Caller, who: CustomerView, amountPaise: number, daysLate: number) =>
      call<UdhaarMoveView>('POST', '/udhaar/opening', caller, {
        requestKey: crypto.randomUUID(),
        customerId: who.id,
        amountPaise,
        asOf: addDays(today, -(30 + daysLate)),
        reason: 'Old notebook',
      });

    /** Moves a payment's day, as if it were taken `daysAgo` days ago (the ledger itself is untouched). */
    const backdate = (who: CustomerView, daysAgo: number) =>
      admin.pool.query(
        `update udhaar_entries set business_date = $2
          where customer_id = $1 and kind = 'payment'`,
        [who.id, addDays(today, -daysAgo)],
      );

    it('sorts what is owed into buckets from the unpaid entries, and lists who to remind', async () => {
      const a = await shop();
      const item = await rice(a);
      const anil = await customer(a, { name: 'Anil' });
      const bina = await customer(a, { name: 'Bina' });
      const chetan = await customer(a, { name: 'Chetan' });
      const dev = await customer(a, { name: 'Dev' });
      const esha = await customer(a, { name: 'Esha' });
      const farid = await customer(a, { name: 'Farid' });
      const gita = await customer(a, { name: 'Gita' });
      const hari = await customer(a, { name: 'Hari' });
      const indu = await customer(a, { name: 'Indu' });
      const jaya = await customer(a, { name: 'Jaya' });
      // Late by 10, 45, 75 and 200 days.
      await owedFor(a, anil, 10_000, 10);
      await owedFor(a, bina, 20_000, 45);
      await owedFor(a, chetan, 30_000, 75);
      await owedFor(a, dev, 40_000, 200);
      await pay(a, dev, 15_000);
      // Not due yet.
      await save(a, bill(item, esha, 1, [udhaar(RICE)]));
      // Only an advance, and a payment that was taken back: neither owes anything.
      await pay(a, farid, 5_000);
      const mistake = await pay(a, jaya, 7_000);
      expect(
        (
          await call('POST', `/udhaar/payments/${mistake.body.entry.id}/reverse`, a, {
            reason: 'Wrong customer',
            ownerPassword: PASSWORD,
          })
        ).status,
      ).toBe(201);
      // 90 days late on the notebook, then a bill today; the payment clears the notebook first,
      // so 5,000 of it is still late and the whole bill is not.
      await owedFor(a, gita, 8_000, 90);
      await save(a, bill(item, gita, 1, [udhaar(RICE)]));
      await pay(a, gita, 3_000);
      // Payments six and seven days ago: only the first is in "the last seven days".
      await pay(a, hari, 2_000);
      await backdate(hari, 6);
      await pay(a, indu, 4_000);
      await backdate(indu, 7);

      const seen = await summary(a);
      expect(seen.status).toBe(200);
      expect(seen.body).toMatchObject({
        today,
        owedPaise: 10_000 + 20_000 + 30_000 + 25_000 + RICE + (5_000 + RICE),
        notDuePaise: RICE + RICE,
        overduePaise: 10_000 + 20_000 + 30_000 + 25_000 + 5_000,
        collected: {
          fromDate: addDays(today, -6),
          toDate: today,
          paise: 15_000 + 5_000 + 3_000 + 2_000,
          payments: 4,
        },
      });
      expect(seen.body.buckets).toEqual([
        { bucket: 'days_1_30', paise: 10_000, customers: 1 },
        { bucket: 'days_31_60', paise: 20_000, customers: 1 },
        { bucket: 'days_61_90', paise: 30_000 + 5_000, customers: 2 },
        { bucket: 'days_over_90', paise: 25_000, customers: 1 },
      ]);
      expect(
        seen.body.topOwing.map((row) => [row.name, row.balancePaise, row.overduePaise]),
      ).toEqual([
        ['Chetan', 30_000, 30_000],
        ['Dev', 25_000, 25_000],
        ['Bina', 20_000, 20_000],
        ['Gita', 5_000 + RICE, 5_000],
        ['Esha', RICE, 0],
      ]);
      expect(
        seen.body.reminders.map((row) => [
          row.name,
          row.daysLate,
          row.oldestDueDate,
          row.overduePaise,
        ]),
      ).toEqual([
        ['Dev', 200, addDays(today, -200), 25_000],
        ['Gita', 90, addDays(today, -90), 5_000],
        ['Chetan', 75, addDays(today, -75), 30_000],
        ['Bina', 45, addDays(today, -45), 20_000],
        ['Anil', 10, addDays(today, -10), 10_000],
      ]);
      expect(seen.body.reminders[0]).toMatchObject({
        id: dev.id,
        phone: dev.phone,
      });
    });

    it('is all zero for a business with nothing owed, and keeps businesses apart', async () => {
      const a = await shop();
      const b = await shop();
      await owedFor(b, await customer(b), 9_000, 40);
      const empty = await summary(a);
      expect(empty.body).toMatchObject({
        today,
        owedPaise: 0,
        notDuePaise: 0,
        overduePaise: 0,
        collected: { paise: 0, payments: 0 },
        topOwing: [],
        reminders: [],
      });
      expect(empty.body.buckets.map((row) => row.paise)).toEqual([0, 0, 0, 0]);
      expect((await summary(b)).body.overduePaise).toBe(9_000);
    });

    it('follows a customer’s own due days, fixed when each entry was made', async () => {
      const a = await shop();
      const sunita = await terms(a, await customer(a), { dueDays: 10 });
      // 10 due days: the notebook as of 25 days ago fell due 15 days ago.
      await call('POST', '/udhaar/opening', a, {
        requestKey: crypto.randomUUID(),
        customerId: sunita.id,
        amountPaise: 4_000,
        asOf: addDays(today, -25),
        reason: 'Old notebook',
      });
      const seen = await summary(a);
      expect(seen.body.reminders.map((row) => row.daysLate)).toEqual([15]);
      // Changing the terms later does not move the entry that was already made.
      await terms(a, sunita, { dueDays: 90 });
      expect((await summary(a)).body.reminders.map((row) => row.daysLate)).toEqual([15]);
    });

    it('needs customers.view', async () => {
      const a = await shop();
      expect((await summary(cashier(a))).status).toBe(403);
      expect((await summary(creditCashier(a))).status).toBe(200);
    });

    it('logs that a reminder was prepared, who did it and what it said', async () => {
      const a = await shop();
      const sunita = await customer(a);
      await owedFor(a, sunita, 4_000, 20);
      const done = await call('POST', '/udhaar/reminders/prepared', creditCashier(a), {
        customerId: sunita.id,
      });
      expect(done.status).toBe(204);
      const [entry] = await logOf(a, 'udhaar.reminder_prepared');
      expect(entry).toMatchObject({
        entity_id: sunita.id,
        after: { balancePaise: 4_000, overduePaise: 4_000, daysLate: 20 },
      });
    });

    it('refuses a reminder for a customer who owes nothing, or who belongs to another business', async () => {
      const a = await shop();
      const b = await shop();
      const sunita = await customer(a);
      const theirs = await customer(b);
      await owedFor(b, theirs, 4_000, 20);
      expect(
        (await call('POST', '/udhaar/reminders/prepared', a, { customerId: sunita.id })).status,
      ).toBe(409);
      expect(
        (await call('POST', '/udhaar/reminders/prepared', a, { customerId: theirs.id })).status,
      ).toBe(404);
      expect(
        (await call('POST', '/udhaar/reminders/prepared', cashier(a), { customerId: sunita.id }))
          .status,
      ).toBe(403);
      expect(
        (await call('POST', '/udhaar/reminders/prepared', a, { customerId: 'x' })).status,
      ).toBe(400);
      expect(await logOf(a, 'udhaar.reminder_prepared')).toEqual([]);
    });
  });
});
