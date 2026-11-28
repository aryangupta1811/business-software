// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: reading saved bills for
// the Bills page and for printing (P1.15; `02` #32, #33; design sections 4 and 11).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  businessDate,
  PERMISSIONS,
  type BillDetailView,
  type BillListPage,
  type ItemView,
  type SavedBillView,
} from '@business-software/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashToken } from '../auth/tokens.js';
import type { Caller, SessionResolver } from '../http/session.js';

const CSRF = 'csrf-token-for-tests';
const headerSessions: SessionResolver = {
  resolve(request: IncomingMessage) {
    const header = request.headers['x-test-caller'];
    return Promise.resolve(typeof header === 'string' ? (JSON.parse(header) as Caller) : null);
  },
  recordActivity: () => Promise.resolve(),
};

type Body = Record<string, unknown>;

describe('reading saved bills', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  let signups = 0;
  const today = businessDate(new Date());

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
    return { status: response.status, body: (await response.json()) as T };
  }

  /** A new regular business, with a GSTIN, and its owner. */
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
        email: `read-${tag}@example.com`,
        password: 'correct horse battery',
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

  const cashier = (owner: Caller, branchId = owner.branchId): Caller => ({
    ...owner,
    branchId,
    role: 'staff',
    permissions: ['session.own', 'billing.sell'],
  });

  async function addBranch(owner: Caller): Promise<string> {
    const { rows } = await admin.pool.query<{ id: string }>(
      'insert into branches (business_id, name, state_code, code, gstin) values ($1, $2, $3, $4, $5) returning id',
      [owner.businessId, 'Second branch', '27', 'B2', '27ABCDE1234F1Z5'],
    );
    return rows[0]?.id ?? '';
  }

  /** An item with stock at this caller's branch. */
  async function stocked(caller: Caller, overrides: Body = {}): Promise<ItemView> {
    const made = await call<ItemView>('POST', '/items', caller, {
      kind: 'goods',
      name: `Item ${crypto.randomUUID().slice(0, 8)}`,
      hindiName: 'चावल',
      code: null,
      categoryId: null,
      brand: null,
      stockUnit: 'kg',
      sellingPrice: 12_000,
      wholesalePrice: null,
      purchasePrice: 9_000,
      mrp: null,
      priceIncludesTax: true,
      gstRate: 500,
      hsn: '1006',
      packs: [],
      levels: [],
      barcodes: [],
      ...overrides,
    });
    expect(made.status).toBe(201);
    const opened = await call('POST', `/items/${made.body.id}/stock/opening`, caller, {
      quantity: 100_000,
      requestKey: crypto.randomUUID(),
    });
    expect(opened.status).toBe(201);
    return made.body;
  }

  /** Sells 1 kg of the item for cash at the caller's branch. */
  async function sell(caller: Caller, item: ItemView, extra: Body = {}): Promise<SavedBillView> {
    const body = {
      billKey: crypto.randomUUID(),
      priceList: 'retail',
      customerId: null,
      placeOfSupplyStateCode: '27',
      lines: [
        {
          itemId: item.id,
          packId: null,
          quantityThousandths: 1_000,
          shownUnitPricePaise: item.sellingPrice,
        },
      ],
      payments: [{ mode: 'cash', amountPaise: 12_000, tenderedPaise: 20_000 }],
      shownGrandTotalPaise: 12_000,
      ...extra,
    };
    const saved = await call<SavedBillView>('POST', '/bills', caller, body);
    expect(saved, JSON.stringify(saved.body)).toMatchObject({ status: 201 });
    return saved.body;
  }

  const list = (caller: Caller, query = '') =>
    call<BillListPage>('GET', `/bills${query === '' ? '' : `?${query}`}`, caller);

  async function customer(caller: Caller, name: string, phone: string): Promise<string> {
    const { rows } = await admin.pool.query<{ id: string }>(
      'insert into customers (business_id, name, phone) values ($1, $2, $3) returning id',
      [caller.businessId, name, phone],
    );
    return rows[0]?.id ?? '';
  }

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
    await app.close();
    await admin.close();
    await server.stop();
  });

  describe('one bill', () => {
    it('answers everything the printout needs, and nothing from the purchase side', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      await call('PUT', '/settings/printing', owner, {
        billLanguage: 'hi',
        footerNote: 'Goods once sold will not be taken back.',
      });
      const phone = await customer(owner, 'Meena Devi', '9876543210');
      const saved = await sell(owner, rice, { customerId: phone });

      const response = await call<BillDetailView>('GET', `/bills/${saved.id}`, owner);
      expect(response.status).toBe(200);
      const bill = response.body;
      expect(bill).toMatchObject({
        id: saved.id,
        number: saved.number,
        document: 'tax_invoice',
        businessDate: today,
        tax: 'cgst-sgst',
        grandTotalPaise: 12_000,
        changePaise: 8_000,
        language: 'hi',
        footerNote: 'Goods once sold will not be taken back.',
        customerPhone: '9876543210',
        // The owner has no name: a bill must never carry their email instead.
        cashierName: null,
        buyer: expect.objectContaining({ name: 'Meena Devi' }) as unknown,
        seller: expect.objectContaining({
          gstin: '27ABCDE1234F1Z5',
          phone: '9111111111',
        }) as unknown,
        payments: [{ mode: 'cash', amountPaise: 12_000, tenderedPaise: 20_000, reference: null }],
      });
      expect(bill.lines).toHaveLength(1);
      expect(bill.lines[0]).toMatchObject({
        lineNo: 1,
        itemName: rice.name,
        itemHindiName: 'चावल',
        unit: 'kg',
        hsn: '1006',
        rateBasisPoints: 500,
        quantityThousandths: 1_000,
        unitPricePaise: 12_000,
        taxablePaise: 11_428,
        totalPaise: 12_000,
      });
      // What the shop paid for the item is not on a bill the cashier can read.
      expect(JSON.stringify(bill)).not.toMatch(/unitCost|unit_cost|purchase|9000/);
    });

    it('keeps the language and footer the business has now, not stored on the bill', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const saved = await sell(owner, rice);
      const before = (await call<BillDetailView>('GET', `/bills/${saved.id}`, owner)).body;
      expect(before).toMatchObject({ language: 'en', footerNote: null });
      await call('PUT', '/settings/printing', owner, {
        billLanguage: 'hi-Latn',
        footerNote: 'Dhanyavaad',
      });
      expect((await call<BillDetailView>('GET', `/bills/${saved.id}`, owner)).body).toMatchObject({
        language: 'hi-Latn',
        footerNote: 'Dhanyavaad',
      });
    });

    it('lists its payments in the order they were given, with the reference', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const saved = await sell(owner, rice, {
        payments: [
          { mode: 'cash', amountPaise: 5_000 },
          { mode: 'upi', amountPaise: 7_000, reference: 'UTR998877' },
        ],
      });
      const { payments } = (await call<BillDetailView>('GET', `/bills/${saved.id}`, owner)).body;
      expect(payments.map((payment) => [payment.mode, payment.reference])).toEqual([
        ['cash', null],
        ['upi', 'UTR998877'],
      ]);
    });

    it("shows a cashier their own branch's bill, and says 404 to another branch's", async () => {
      const owner = await shop();
      const second = await addBranch(owner);
      const rice = await stocked(owner);
      const there = await stocked({ ...owner, branchId: second });
      const here = await sell(owner, rice);
      const away = await sell({ ...owner, branchId: second }, there);
      expect((await call('GET', `/bills/${here.id}`, cashier(owner))).status).toBe(200);
      expect(await call('GET', `/bills/${away.id}`, cashier(owner))).toMatchObject({
        status: 404,
        body: { code: 'not_found' },
      });
      // The owner reads any branch's bill, whichever computer they are at.
      expect((await call('GET', `/bills/${away.id}`, owner)).status).toBe(200);
    });

    it('names the cashier by name, else by username, never by email', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const saved = await sell(owner, rice);
      const cashierName = async () =>
        (await call<BillDetailView>('GET', `/bills/${saved.id}`, owner)).body.cashierName;
      await admin.pool.query('update users set name = $2 where id = $1', [owner.userId, 'Asha']);
      expect(await cashierName()).toBe('Asha');
      await admin.pool.query('update users set name = null where id = $1', [owner.userId]);
      expect(await cashierName()).toBeNull();
    });

    it('answers the phone only to someone who may see customers', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const meena = await customer(owner, 'Meena Devi', '9876543210');
      const saved = await sell(owner, rice, { customerId: meena });
      const seller = cashier(owner);
      const viewer: Caller = {
        ...seller,
        permissions: ['session.own', 'billing.sell', 'customers.view'],
      };
      const phone = async (caller: Caller) =>
        (await call<BillDetailView>('GET', `/bills/${saved.id}`, caller)).body.customerPhone;
      expect(await phone(viewer)).toBe('9876543210');
      expect(await phone(seller)).toBeNull();
      expect((await list(viewer, 'q=76543')).body.bills[0]?.customerPhone).toBe('9876543210');
      expect((await list(seller)).body.bills[0]?.customerPhone).toBeNull();
      // Nor can it be found out by searching.
      expect((await list(seller, 'q=76543')).body.bills).toEqual([]);
      expect((await list(seller, 'q=meena')).body.bills).toHaveLength(1);
    });

    it("keeps two businesses apart, even with the other's id", async () => {
      const a = await shop();
      const b = await shop();
      const saved = await sell(a, await stocked(a));
      expect((await call('GET', `/bills/${saved.id}`, b)).status).toBe(404);
      expect((await call('POST', `/bills/${saved.id}/reprints`, b)).status).toBe(404);
    });

    it('says 404 to an id that is not a bill, or not an id at all', async () => {
      const owner = await shop();
      expect((await call('GET', '/bills/0190f0f0-0000-7000-8000-0000000000ff', owner)).status).toBe(
        404,
      );
      expect((await call('GET', '/bills/not-an-id', owner)).status).toBe(404);
    });

    it('needs billing.sell', async () => {
      const owner = await shop();
      const saved = await sell(owner, await stocked(owner));
      const nobody: Caller = { ...cashier(owner), permissions: ['session.own'] };
      expect((await call('GET', `/bills/${saved.id}`, nobody)).status).toBe(403);
      expect((await list(nobody)).status).toBe(403);
      expect((await call('POST', `/bills/${saved.id}/reprints`, nobody)).status).toBe(403);
    });
  });

  describe('the list', () => {
    it("shows a cashier their branch's bills, newest first, and the owner every branch's", async () => {
      const owner = await shop();
      const second = await addBranch(owner);
      const rice = await stocked(owner);
      const there = await stocked({ ...owner, branchId: second });
      const first = await sell(owner, rice);
      const later = await sell(owner, rice);
      const away = await sell({ ...owner, branchId: second }, there);

      const mine = await list(cashier(owner));
      expect(mine.body.bills.map((bill) => bill.id)).toEqual([later.id, first.id]);
      expect(mine.body.next).toBeNull();
      // A cashier can't ask for another branch.
      const asked = await list(cashier(owner), `branch=${second}`);
      expect(asked.body.bills.map((bill) => bill.id)).toEqual([later.id, first.id]);

      const all = await list(owner);
      expect(all.body.bills.map((bill) => bill.id)).toEqual([away.id, later.id, first.id]);
      const one = await list(owner, `branch=${second}`);
      expect(one.body.bills.map((bill) => [bill.id, bill.branchCode])).toEqual([[away.id, 'B2']]);
      const honest = await list(owner, `branch=${owner.branchId}`);
      expect(honest.body.bills.map((bill) => bill.id)).toEqual([later.id, first.id]);
    });

    it('describes each row for the page', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const who = await customer(owner, 'Meena Devi', '9876543210');
      const saved = await sell(owner, rice, {
        customerId: who,
        payments: [
          { mode: 'upi', amountPaise: 7_000 },
          { mode: 'cash', amountPaise: 5_000 },
        ],
      });
      const [row] = (await list(owner)).body.bills;
      expect(row).toEqual({
        id: saved.id,
        number: saved.number,
        document: 'tax_invoice',
        businessDate: today,
        createdAt: expect.any(String) as unknown,
        grandTotalPaise: 12_000,
        branchId: owner.branchId,
        branchCode: expect.any(String) as unknown,
        customerName: 'Meena Devi',
        customerPhone: '9876543210',
        paymentModes: ['cash', 'upi'],
      });
      const walkIn = await sell(owner, rice);
      const [latest] = (await list(owner)).body.bills;
      expect(latest).toMatchObject({
        id: walkIn.id,
        customerName: null,
        customerPhone: null,
      });
    });

    it('searches by number, customer name and phone, ignoring case, and treats % as a letter', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const meena = await customer(owner, 'Meena Devi', '9876543210');
      const ravi = await customer(owner, 'Ravi 100% Trader', '9123456780');
      const one = await sell(owner, rice, { customerId: meena });
      const two = await sell(owner, rice, { customerId: ravi });
      const three = await sell(owner, rice);
      const ids = async (q: string) =>
        (await list(owner, `q=${encodeURIComponent(q)}`)).body.bills.map((bill) => bill.id);

      expect(await ids('meena')).toEqual([one.id]);
      expect(await ids('76543')).toEqual([one.id]);
      expect(await ids('100%')).toEqual([two.id]);
      expect(await ids('%')).toEqual([two.id]);
      expect(await ids('ZZZ')).toEqual([]);
      const lastNumber = three.number.split('/').at(-1) ?? '';
      expect(await ids(three.number)).toEqual([three.id]);
      expect((await ids(lastNumber)).includes(three.id)).toBe(true);
    });

    it('filters by business day, both ends included', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const old = await sell(owner, rice);
      const recent = await sell(owner, rice);
      const current = await sell(owner, rice);
      await admin.pool.query("update bills set business_date = '2026-10-01' where id = $1", [
        old.id,
      ]);
      await admin.pool.query("update bills set business_date = '2026-10-15' where id = $1", [
        recent.id,
      ]);
      const ids = async (query: string) =>
        (await list(owner, query)).body.bills.map((bill) => bill.id);
      expect(await ids('from=2026-10-01&to=2026-10-15')).toEqual([recent.id, old.id]);
      expect(await ids('from=2026-10-02&to=2026-10-31')).toEqual([recent.id]);
      expect(await ids('to=2026-10-01')).toEqual([old.id]);
      expect(await ids(`from=${today}&to=${today}`)).toEqual([current.id]);
      expect((await list(owner, 'from=2026-10-15&to=2026-10-01')).status).toBe(400);
    });

    it('pages with a cursor, 30 at a time, newest first, with no bill twice or missed', async () => {
      const owner = await shop();
      const rice = await stocked(owner);
      const made: string[] = [];
      for (let n = 0; n < 31; n += 1) made.push((await sell(owner, rice)).id);
      const first = await list(owner);
      expect(first.body.bills).toHaveLength(30);
      expect(first.body.next).toBe(first.body.bills.at(-1)?.id);
      const second = await list(owner, `after=${first.body.next ?? ''}`);
      expect(second.body.bills).toHaveLength(1);
      expect(second.body.next).toBeNull();
      expect([...first.body.bills, ...second.body.bills].map((bill) => bill.id)).toEqual(
        made.toReversed(),
      );
    }, 60_000);

    it('keeps two businesses apart', async () => {
      const a = await shop();
      const b = await shop();
      await sell(a, await stocked(a));
      expect((await list(b)).body).toEqual({ bills: [], next: null });
    });
  });

  describe('reprints (02 #32, #33)', () => {
    it('logs who printed which bill again, and answers when', async () => {
      const owner = await shop();
      const saved = await sell(owner, await stocked(owner));
      const staff = cashier(owner);
      const response = await call<{ reprintedAt: string }>(
        'POST',
        `/bills/${saved.id}/reprints`,
        staff,
      );
      expect(response.status).toBe(201);
      expect(Date.now() - Date.parse(response.body.reprintedAt)).toBeLessThan(5_000);
      const { rows } = await admin.pool.query<Body>(
        `select actor_id, branch_id, entity_type, after from entry_log
          where entity_id = $1 and action = 'bill.reprinted'`,
        [saved.id],
      );
      expect(rows).toEqual([
        {
          actor_id: owner.userId,
          branch_id: owner.branchId,
          entity_type: 'bill',
          after: { number: saved.number },
        },
      ]);
      // Every reprint is its own entry.
      await call('POST', `/bills/${saved.id}/reprints`, owner);
      const { rows: again } = await admin.pool.query(
        `select 1 from entry_log where entity_id = $1 and action = 'bill.reprinted'`,
        [saved.id],
      );
      expect(again).toHaveLength(2);
    });

    it("refuses a cashier another branch's bill, and logs nothing", async () => {
      const owner = await shop();
      const second = await addBranch(owner);
      const away = await sell(
        { ...owner, branchId: second },
        await stocked({ ...owner, branchId: second }),
      );
      expect((await call('POST', `/bills/${away.id}/reprints`, cashier(owner))).status).toBe(404);
      const { rows } = await admin.pool.query(
        `select 1 from entry_log where entity_id = $1 and action = 'bill.reprinted'`,
        [away.id],
      );
      expect(rows).toEqual([]);
    });
  });
});
