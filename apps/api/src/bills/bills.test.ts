// Integration test on a throwaway PostgreSQL (ADR 0013), over real HTTP: saving a bill (P1.14,
// design `docs/plans/2026-11-22-p1.14-save-bill-design.md` §3 and §7).
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { startTestDatabase, type TestDatabase } from '@business-software/db/testing';
import {
  businessDate,
  financialYear,
  PERMISSIONS,
  type ApprovalView,
  type ItemView,
  type Permission,
  type SavedBillView,
  type SettingsView,
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
interface Line {
  item: ItemView;
  quantity?: number;
  packId?: string | null;
  price?: number;
  discount?: Body;
}

describe('saving a bill', () => {
  let server: TestDatabase;
  let admin: Database;
  let app: INestApplication;
  let base: string;
  const year = financialYear(businessDate(new Date()));
  const short = `${year.slice(2, 4)}-${year.slice(5)}`;
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
    return { status: response.status, body: (await response.json()) as T };
  }

  /** A new regular business in Maharashtra; with a GSTIN on its branch unless told not to. */
  async function shop(gstin = true): Promise<Caller> {
    const tag = crypto.randomUUID().slice(0, 8);
    // Each from its own computer: signup is rate-limited per address.
    const ip = `10.0.${String(++signups)}.1`;
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
        email: `bills-${tag}@example.com`,
        password: PASSWORD,
      },
      { 'x-forwarded-for': ip },
    );
    expect(created.status).toBe(201);
    const { businessId } = created.body as { businessId: string };
    if (gstin) {
      await admin.pool.query(
        `update branches set gstin = '27ABCDE1234F1Z5' where business_id = $1`,
        [businessId],
      );
    }
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

  const cashier = (caller: Caller, permissions: Permission[] = ['session.own', 'billing.sell']) =>
    ({ ...caller, role: 'staff', permissions }) satisfies Caller;

  async function item(caller: Caller, overrides: Body = {}): Promise<ItemView> {
    const response = await call<ItemView>('POST', '/items', caller, {
      kind: 'goods',
      name: `Item ${crypto.randomUUID().slice(0, 8)}`,
      hindiName: null,
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
    expect(response.status).toBe(201);
    return response.body;
  }

  async function stock(caller: Caller, item: ItemView, quantity: number): Promise<void> {
    const response = await call('POST', `/items/${item.id}/stock/opening`, caller, {
      quantity,
      requestKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
  }

  function cart(lines: Line[], extra: Body = {}): Body {
    return {
      billKey: crypto.randomUUID(),
      priceList: 'retail',
      customerId: null,
      placeOfSupplyStateCode: '27',
      lines: lines.map((line) => ({
        itemId: line.item.id,
        packId: line.packId ?? null,
        quantityThousandths: line.quantity ?? 1_000,
        shownUnitPricePaise: line.price ?? line.item.sellingPrice,
        ...(line.discount !== undefined && { discount: line.discount }),
      })),
      ...extra,
    };
  }

  /** The server's grand total for a cart: its `prices_changed` answer to a total of 0. */
  async function totalOf(caller: Caller, body: Body): Promise<number> {
    const quote = await call<{ code: string; grandTotalPaise: number }>('POST', '/bills', caller, {
      ...body,
      payments: [],
      shownGrandTotalPaise: 0,
    });
    expect(quote.body.code).toBe('prices_changed');
    return quote.body.grandTotalPaise;
  }

  /** The cart paid in cash, `extraCash` handed over beyond the total. */
  async function paid(caller: Caller, body: Body, extraCash = 0): Promise<Body> {
    const total = await totalOf(caller, body);
    return {
      ...body,
      payments: [
        {
          mode: 'cash',
          amountPaise: total,
          ...(extraCash > 0 && { tenderedPaise: total + extraCash }),
        },
      ],
      shownGrandTotalPaise: total,
    };
  }

  const save = async (caller: Caller, body: Body) => {
    const response = await call<SavedBillView & { code?: string }>('POST', '/bills', caller, body);
    return response;
  };

  async function sell(caller: Caller, lines: Line[], extra: Body = {}) {
    return save(caller, await paid(caller, cart(lines, extra)));
  }

  const balance = async (caller: Caller, item: ItemView) => {
    const { rows } = await admin.pool.query<{ quantity: string }>(
      'select quantity from item_stock where branch_id = $1 and item_id = $2',
      [caller.branchId, item.id],
    );
    return Number(rows[0]?.quantity ?? 0);
  };

  const billCount = async (caller: Caller) => {
    const { rows } = await admin.pool.query<{ count: string }>(
      'select count(*) from bills where business_id = $1',
      [caller.businessId],
    );
    return Number(rows[0]?.count);
  };

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

  it('saves a paid bill: numbered, stored with the engine sums, stock out, logged', async () => {
    const a = await shop();
    const rice = await item(a);
    await stock(a, rice, 5_000);
    expect((await sell(a, [{ item: rice, quantity: 2_000 }])).body.number).toBe(`${short}/1`);
    const draft = await paid(a, cart([{ item: rice, quantity: 2_000 }]), 1_000);
    const saved = await save(a, draft);
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({
      number: `${short}/2`,
      document: 'tax_invoice',
      businessDate: businessDate(new Date()),
      grandTotalPaise: 24_000,
      changePaise: 1_000,
      warnings: [],
    });
    // Two bills of 2 kg from 5 kg.
    expect(await balance(a, rice)).toBe(1_000);

    const { rows: bills } = await admin.pool.query<Body>(
      `select sequence, financial_year, tax, taxable_paise, cgst_paise, sgst_paise, total_paise,
              round_off_paise, grand_total_paise, seller->>'gstin' as gstin, created_by
         from bills where id = $1`,
      [saved.body.id],
    );
    // ₹240 with 5% inside: 22,857 taxable + 571.5 → 572 + 571 (the engine's halves).
    expect(bills[0]).toMatchObject({
      sequence: 2,
      financial_year: year,
      tax: 'cgst-sgst',
      grand_total_paise: '24000',
      gstin: '27ABCDE1234F1Z5',
      created_by: a.userId,
    });
    const { rows: lines } = await admin.pool.query<Body>(
      `select line_no, item_name, unit, quantity_thousandths, stock_quantity, unit_price_paise,
              total_paise, unit_cost from bill_lines where bill_id = $1`,
      [saved.body.id],
    );
    expect(lines).toEqual([
      {
        line_no: 1,
        item_name: rice.name,
        unit: 'kg',
        quantity_thousandths: '2000',
        stock_quantity: '2000',
        unit_price_paise: '12000',
        total_paise: '24000',
        unit_cost: '9000',
      },
    ]);
    const { rows: moves } = await admin.pool.query<Body>(
      `select kind, quantity, balance_after from stock_movements where bill_id = $1`,
      [saved.body.id],
    );
    expect(moves).toEqual([{ kind: 'sale', quantity: '-2000', balance_after: '1000' }]);
    const { rows: payments } = await admin.pool.query<Body>(
      'select mode, amount_paise, tendered_paise from bill_payments where bill_id = $1',
      [saved.body.id],
    );
    expect(payments).toEqual([{ mode: 'cash', amount_paise: '24000', tendered_paise: '25000' }]);
    const { rows: log } = await admin.pool.query<{ action: string; after: Body }>(
      'select action, after from entry_log where entity_id = $1',
      [saved.body.id],
    );
    expect(log).toEqual([
      {
        action: 'bill.created',
        after: expect.objectContaining({
          number: `${short}/2`,
          lineCount: 1,
          grandTotalPaise: 24_000,
          lineDiscounts: [],
          approvalId: null,
          warned: [],
        }) as Body,
      },
    ]);
  });

  it("starts numbers with the business's prefix, or each branch's code once there are two", async () => {
    const a = await shop();
    const rice = await item(a);
    const settings = await call<SettingsView>('PUT', '/settings/invoices', a, {
      invoicePrefix: 'abc',
    });
    expect(settings.status).toBe(200);
    expect(settings.body.invoices).toEqual({ invoicePrefix: 'ABC' });
    expect((await sell(a, [{ item: rice }])).body.number).toBe(`ABC/${short}/1`);

    await admin.pool.query(
      `insert into branches (business_id, name, code, state_code) values ($1, 'Andheri', 'AND', '27')`,
      [a.businessId],
    );
    // The head office's own code now; its series goes on.
    expect((await sell(a, [{ item: rice }])).body.number).toBe(`HO/${short}/2`);
  });

  it('refuses a prefix that could make a number longer than 16 characters', async () => {
    const a = await shop();
    const response = await call<{ code: string; fields: Body }>('PUT', '/settings/invoices', a, {
      invoicePrefix: 'ABCDE',
    });
    expect(response.status).toBe(400);
    expect(response.body.fields.invoicePrefix).toBeDefined();
  });

  it('answers a retry with the saved bill, and refuses the key for a different bill', async () => {
    const a = await shop();
    const rice = await item(a);
    const draft = await paid(a, cart([{ item: rice }]));
    const first = await save(a, draft);
    const again = await save(a, draft);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await billCount(a)).toBe(1);

    const other = {
      ...(await paid(a, cart([{ item: rice, quantity: 2_000 }]))),
      billKey: draft.billKey,
    };
    expect(await save(a, other)).toMatchObject({ status: 422, body: { code: 'key_reused' } });
  });

  it('answers prices_changed when the cashier saw an old price, and writes nothing', async () => {
    const a = await shop();
    const rice = await item(a);
    const draft = await paid(a, cart([{ item: rice }]));
    await admin.pool.query('update items set selling_price = 13000 where id = $1', [rice.id]);
    expect(await save(a, draft)).toMatchObject({
      status: 409,
      body: {
        code: 'prices_changed',
        lines: [{ line: 1, unitPricePaise: 13_000 }],
        grandTotalPaise: 13_000,
      },
    });
    expect(await billCount(a)).toBe(0);
    // No number was used.
    expect((await sell(a, [{ item: rice, price: 13_000 }])).body.number).toBe(`${short}/1`);
  });

  it('refuses an archived item, a missing GSTIN, wholesale without the switch', async () => {
    const a = await shop();
    const rice = await item(a);
    const draft = await paid(a, cart([{ item: rice }]));
    await admin.pool.query('update items set archived_at = now() where id = $1', [rice.id]);
    expect(await save(a, draft)).toMatchObject({
      status: 409,
      body: { code: 'items_unavailable', lines: [1] },
    });

    const noGstin = await shop(false);
    const dal = await item(noGstin);
    expect(
      await save(noGstin, { ...cart([{ item: dal }]), payments: [], shownGrandTotalPaise: 0 }),
    ).toMatchObject({ status: 409, body: { code: 'gstin_required' } });

    await call('PUT', '/settings/features', a, { features: [] });
    const sugar = await item(a);
    expect(
      await save(a, {
        ...cart([{ item: sugar }], { priceList: 'wholesale' }),
        payments: [],
        shownGrandTotalPaise: 0,
      }),
    ).toMatchObject({ status: 422, body: { code: 'wholesale_off' } });
  });

  it('names the buyer from ₹50,000 of taxable value (Rule 46), not below', async () => {
    const a = await shop();
    const big = (sellingPrice: number) =>
      item(a, { stockUnit: 'piece', sellingPrice, priceIncludesTax: false, purchasePrice: null });
    expect((await sell(a, [{ item: await big(4_999_999) }])).status).toBe(201);

    const tv = await big(5_000_000);
    expect(await sell(a, [{ item: tv }])).toMatchObject({
      status: 422,
      body: { code: 'buyer_details_required' },
    });
    const walkIn = await call<{ id: string }>('POST', '/customers', a, {
      name: 'Sunita',
      phone: null,
      gstin: null,
      legalName: null,
      address: null,
      pinCode: null,
      stateCode: null,
    });
    expect(await sell(a, [{ item: tv }], { customerId: walkIn.body.id })).toMatchObject({
      status: 422,
      body: { code: 'buyer_details_required' },
    });
    const named = await call<{ id: string }>('POST', '/customers', a, {
      name: 'Ramesh',
      phone: null,
      gstin: null,
      legalName: null,
      address: '12 MG Road, Pune',
      pinCode: null,
      stateCode: '27',
    });
    const saved = await sell(a, [{ item: tv }], { customerId: named.body.id });
    expect(saved.status).toBe(201);
    const { rows } = await admin.pool.query<{ buyer: Body }>(
      'select buyer from bills where id = $1',
      [saved.body.id],
    );
    expect(rows[0]?.buyer).toMatchObject({ name: 'Ramesh', address: '12 MG Road, Pune' });
  });

  it("needs the owner's OK for a cashier's discount, and uses it up", async () => {
    const a = await shop();
    const rice = await item(a);
    const desk = cashier(a);
    const discounted = cart([{ item: rice, discount: { kind: 'percent', basisPoints: 1_000 } }]);
    expect(await save(desk, await paid(desk, discounted))).toMatchObject({
      status: 403,
      body: { code: 'approval_required', lineBasisPoints: 1_000 },
    });

    const approve = (billKey: unknown, lineBasisPoints: number) =>
      call<ApprovalView>('POST', '/billing/approvals', desk, {
        billKey,
        kind: 'discount',
        lineBasisPoints,
        billBasisPoints: 1_000,
        ownerPassword: PASSWORD,
      });
    const tooSmall = await approve(discounted.billKey, 500);
    expect(
      await save(desk, { ...(await paid(desk, discounted)), approvalId: tooSmall.body.approvalId }),
    ).toMatchObject({ status: 409, body: { code: 'approval_invalid' } });

    const ok = await approve(discounted.billKey, 1_000);
    const saved = await save(desk, {
      ...(await paid(desk, discounted)),
      approvalId: ok.body.approvalId,
    });
    expect(saved.status).toBe(201);
    const { rows } = await admin.pool.query<{ used: boolean; approval_id: string }>(
      `select o.used_at is not null as used, b.approval_id from owner_approvals o
         join bills b on b.approval_id = o.id where o.id = $1`,
      [ok.body.approvalId],
    );
    expect(rows).toEqual([{ used: true, approval_id: ok.body.approvalId }]);

    // Used up, and only ever for its own bill.
    const next = cart([{ item: rice, discount: { kind: 'percent', basisPoints: 1_000 } }]);
    expect(
      await save(desk, { ...(await paid(desk, next)), approvalId: ok.body.approvalId }),
    ).toMatchObject({ status: 409, body: { code: 'approval_invalid' } });
  });

  it('refuses a held bill that is not this bill', async () => {
    const a = await shop();
    const rice = await item(a);
    expect(
      await save(a, {
        ...(await paid(a, cart([{ item: rice }]))),
        heldBillId: crypto.randomUUID(),
      }),
    ).toMatchObject({ status: 422, body: { code: 'held_bill_invalid' } });
  });

  it('warns below zero, or blocks and gives the number back; services and packs', async () => {
    const a = await shop();
    const rice = await item(a, {
      packs: [
        {
          id: null,
          unitCode: 'bag',
          unitId: null,
          size: 25_000,
          sellingPrice: 280_000,
          mrp: null,
          soldAsPack: true,
          boughtAsPack: true,
        },
      ],
    });
    const repair = await item(a, {
      kind: 'service',
      stockUnit: 'piece',
      sellingPrice: 50_000,
      purchasePrice: null,
      gstRate: 1_800,
      hsn: '998719',
    });
    await stock(a, rice, 30_000);
    const bag = rice.packs[0]?.id ?? '';
    // A bag takes 25 kg; the service takes nothing.
    const first = await sell(a, [{ item: rice, packId: bag, price: 280_000 }, { item: repair }]);
    expect(first.status).toBe(201);
    expect(await balance(a, rice)).toBe(5_000);
    // Warn (the default): sold anyway, and the answer says so.
    const warned = await sell(a, [{ item: rice, quantity: 6_000 }]);
    expect(warned.body.warnings).toEqual([{ itemId: rice.id, balanceAfter: -1_000 }]);

    await call('PUT', '/settings/stock', a, { negativeStock: 'block' });
    expect(await sell(a, [{ item: rice }])).toMatchObject({
      status: 409,
      body: { code: 'stock_short', itemId: rice.id },
    });
    expect((await sell(a, [{ item: repair }])).body.number).toBe(`${short}/3`);
  });

  it('gives 20 bills saved at once the numbers 1 to 20, no gap, no duplicate', async () => {
    const a = await shop();
    const rice = await item(a);
    const drafts = await Promise.all(
      Array.from({ length: 20 }, () => paid(a, cart([{ item: rice }]))),
    );
    const saved = await Promise.all(drafts.map((draft) => save(a, draft)));
    expect(saved.every((response) => response.status === 201)).toBe(true);
    const numbers = saved.map((response) => Number(response.body.number.split('/')[1]));
    expect(numbers.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('makes one bill of the same bill sent twice at once', async () => {
    const a = await shop();
    const rice = await item(a);
    const draft = await paid(a, cart([{ item: rice }]));
    const [one, two] = await Promise.all([save(a, draft), save(a, draft)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(two.body.id).toBe(one.body.id);
    expect(await billCount(a)).toBe(1);
  });

  it('sells the last unit to one of two counters under block', async () => {
    const a = await shop();
    const rice = await item(a);
    await stock(a, rice, 1_000);
    await call('PUT', '/settings/stock', a, { negativeStock: 'block' });
    const results = await Promise.all([sell(a, [{ item: rice }]), sell(a, [{ item: rice }])]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await balance(a, rice)).toBe(0);
    expect(await billCount(a)).toBe(1);
  });

  it('needs billing.sell', async () => {
    const a = await shop();
    const rice = await item(a);
    const viewer = cashier(a, ['session.own', 'items.view']);
    expect((await save(viewer, await paid(a, cart([{ item: rice }])))).status).toBe(403);
  });
});
