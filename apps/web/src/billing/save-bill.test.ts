import { billDraftSchema, type SavedBillView } from '@business-software/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { Approval } from './discounts';
import { startBill, type OpenBill } from './open-bill';
import { applyNewPrices, billDraft, saveBill, saveProblem } from './save-bill';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Made-up ids.
const ITEM = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const HELD = '00000000-0000-4000-8000-0000000000e1';

function open(): OpenBill {
  return {
    ...startBill('27'),
    lines: [
      { itemId: ITEM, packId: null, quantityThousandths: 2_000, shownUnitPricePaise: 2_800 },
      { itemId: OTHER, packId: null, quantityThousandths: 1_000, shownUnitPricePaise: 1_000 },
    ],
  };
}

const SAVED: SavedBillView = {
  id: '00000000-0000-4000-8000-0000000000f1',
  number: 'ABC/26-27/42',
  document: 'tax_invoice',
  businessDate: '2026-11-22',
  grandTotalPaise: 6_600,
  changePaise: 400,
  warnings: [],
  creditWarning: null,
};

describe('billDraft', () => {
  test('is the open bill, its payments and the total the cashier saw, in the request shape', () => {
    const bill = open();
    const draft = billDraft(
      bill,
      [{ mode: 'cash', amountPaise: 6_600, tenderedPaise: 7_000 }],
      6_600,
      null,
      null,
    );
    expect(draft).toEqual({
      billKey: bill.billKey,
      priceList: 'retail',
      customerId: null,
      placeOfSupplyStateCode: '27',
      lines: bill.lines,
      payments: [{ mode: 'cash', amountPaise: 6_600, tenderedPaise: 7_000 }],
      shownGrandTotalPaise: 6_600,
    });
    expect(billDraftSchema.safeParse(draft).success).toBe(true);
  });

  test("carries the owner's OK and the held bill only when they belong to this bill", () => {
    const bill = open();
    const approval: Approval = {
      approvalId: '00000000-0000-4000-8000-0000000000d1',
      billKey: bill.billKey,
      expiresAt: '2026-11-22T10:00:00.000Z',
      lineBasisPoints: 500,
      billBasisPoints: 0,
    };
    const pay = [{ mode: 'upi' as const, amountPaise: 6_600 }];
    expect(
      billDraft(bill, pay, 6_600, approval, { id: HELD, billKey: bill.billKey }),
    ).toMatchObject({
      approvalId: approval.approvalId,
      heldBillId: HELD,
    });
    const other = billDraft(
      bill,
      pay,
      6_600,
      { ...approval, billKey: 'x' },
      { id: HELD, billKey: 'y' },
    );
    expect(other).not.toHaveProperty('approvalId');
    expect(other).not.toHaveProperty('heldBillId');
  });
});

describe('billDraft with udhaar', () => {
  const credit = {
    approvalId: '00000000-0000-4000-8000-0000000000d2',
    billKey: '',
    amountPaise: 6_600,
    expiresAt: '2026-11-22T10:00:00.000Z',
  };

  test("carries the owner's credit OK only on a bill with udhaar, and only for this bill", () => {
    const bill = open();
    const udhaar = [
      { mode: 'cash' as const, amountPaise: 600 },
      { mode: 'udhaar' as const, amountPaise: 6_000 },
    ];
    const withOk = billDraft({ ...bill, customerId: HELD }, udhaar, 6_600, null, null, {
      ...credit,
      billKey: bill.billKey,
    });
    expect(withOk).toMatchObject({ creditApprovalId: credit.approvalId });
    expect(billDraftSchema.safeParse(withOk).success).toBe(true);
    // Another bill's OK, or no udhaar on this bill, sends nothing.
    expect(billDraft(bill, udhaar, 6_600, null, null, credit)).not.toHaveProperty(
      'creditApprovalId',
    );
    expect(
      billDraft(bill, [{ mode: 'cash', amountPaise: 6_600 }], 6_600, null, null, {
        ...credit,
        billKey: bill.billKey,
      }),
    ).not.toHaveProperty('creditApprovalId');
  });
});

describe('saveBill', () => {
  const draft = billDraft(open(), [{ mode: 'cash', amountPaise: 6_600 }], 6_600, null, null);

  function answers(...steps: (Response | Error)[]) {
    const fetchMock = vi.fn(() => {
      const step = steps.shift();
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const sentKeys = (fetchMock: ReturnType<typeof answers>) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (JSON.parse(init.body as string) as { billKey: string }).billKey,
    );

  test('posts the bill and answers what the server saved', async () => {
    const fetchMock = answers(Response.json(SAVED, { status: 201 }));
    expect(await saveBill(draft, 0)).toEqual(SAVED);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bills',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('a lost answer is sent again with the same bill key until one comes', async () => {
    const fetchMock = answers(
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      Response.json(SAVED, { status: 201 }),
    );
    expect(await saveBill(draft, 0)).toEqual(SAVED);
    expect(sentKeys(fetchMock)).toEqual([draft.billKey, draft.billKey, draft.billKey]);
  });

  test('gives up after three lost answers, as a network error', async () => {
    const fetchMock = answers(
      new TypeError('a'),
      new TypeError('b'),
      new TypeError('c'),
      new TypeError('d'),
    );
    await expect(saveBill(draft, 0)).rejects.toMatchObject({ code: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("an answer from the server is final: it isn't sent again", async () => {
    const fetchMock = answers(
      Response.json({ code: 'stock_short', itemId: ITEM }, { status: 409 }),
    );
    await expect(saveBill(draft, 0)).rejects.toMatchObject({ status: 409, code: 'stock_short' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('applyNewPrices', () => {
  test("puts the server's prices on the lines it named and says which changed", () => {
    const bill = open();
    const next = applyNewPrices(bill, [{ line: 2, unitPricePaise: 1_200 }]);
    expect(next.changed).toEqual([1]);
    expect(next.bill.lines.map((line) => line.shownUnitPricePaise)).toEqual([2_800, 1_200]);
    expect(next.bill.billKey).toBe(bill.billKey);
  });

  test('ignores a line that is not on the bill', () => {
    expect(applyNewPrices(open(), [{ line: 9, unitPricePaise: 1 }]).changed).toEqual([]);
  });
});

describe('saveProblem', () => {
  const api = (status: number, code: string, detail: Record<string, unknown> = {}) =>
    new ApiError(status, code, {}, undefined, detail);

  test('reads the codes the server answers a save with', () => {
    expect(saveProblem(api(409, 'stock_short', { itemId: ITEM }))).toEqual({
      kind: 'stock_short',
      itemId: ITEM,
    });
    expect(saveProblem(api(409, 'items_unavailable', { lines: [2, 3] }))).toEqual({
      kind: 'items_unavailable',
      lines: [2, 3],
    });
    expect(
      saveProblem(
        api(409, 'prices_changed', { lines: [{ line: 1, unitPricePaise: 5 }], grandTotalPaise: 9 }),
      ),
    ).toEqual({ kind: 'prices_changed', lines: [{ line: 1, unitPricePaise: 5 }] });
    for (const code of [
      'approval_required',
      'approval_invalid',
      'gstin_required',
      'buyer_details_required',
      'customer_unavailable',
      'wholesale_off',
      'place_of_supply',
      'held_bill_invalid',
      'invalid_quantity',
      'payments_mismatch',
      'key_reused',
    ]) {
      expect(saveProblem(api(409, code))).toEqual({ kind: code });
    }
  });

  test('a lost connection is its own problem; anything else is a plain failure', () => {
    expect(saveProblem(new ApiError(0, 'network'))).toEqual({ kind: 'network' });
    expect(saveProblem(api(500, 'server'))).toEqual({ kind: 'failed' });
    expect(saveProblem(api(409, 'something_new'))).toEqual({ kind: 'failed' });
    expect(saveProblem(new Error('boom'))).toEqual({ kind: 'failed' });
  });
});
