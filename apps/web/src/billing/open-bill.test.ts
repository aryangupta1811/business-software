import { calculateBill, cartToBillInput, type BillingContext } from '@business-software/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { catalogueItem } from '../test/catalogue';
import { CatalogueCopy } from './catalogue-copy';
import {
  clearOpenBills,
  isLoose,
  lineProblem,
  loadOpenBill,
  parseEntry,
  priceOpenBill,
  quantityProblem,
  repriceBill,
  saveOpenBill,
  shortOfStock,
  startBill,
} from './open-bill';

const CONTEXT: BillingContext = {
  scheme: 'regular',
  branchStateCode: '27',
  features: [],
  negativeStock: 'warn',
  canViewStock: true,
  canManageItems: true,
  canViewCustomers: true,
  canManageCustomers: true,
  canDiscount: true,
};

const USER = '00000000-0000-4000-8000-000000000001';

const PACK = {
  id: '00000000-0000-4000-8000-0000000000b1',
  unitCode: 'box' as const,
  unitName: null,
  size: 12_000,
  sellingPrice: null,
  mrp: null,
  soldAsPack: true,
};

const salt = catalogueItem({ packs: [PACK] });
const rice = catalogueItem({
  id: '00000000-0000-4000-8000-0000000000a3',
  name: 'Basmati rice',
  code: 'RICE',
  stockUnit: 'kg',
  sellingPrice: 12_000,
  barcodes: [],
});

function copyOf(...items: ReturnType<typeof catalogueItem>[]) {
  const copy = new CatalogueCopy();
  copy.apply({ items, stock: null, serverTime: '2026-11-21T10:00:00.000Z' }, true);
  return copy;
}

afterEach(() => {
  sessionStorage.clear();
});

describe('the open bill', () => {
  test('starts empty, in retail, supplied in the branch’s state, with a fresh key', () => {
    const first = startBill('27');
    expect(first).toEqual({
      billKey: expect.any(String) as unknown,
      priceList: 'retail',
      customerId: null,
      placeOfSupplyStateCode: '27',
      lines: [],
    });
    expect(startBill('27').billKey).not.toBe(first.billKey);
  });

  test.each([
    ['8901234567890', null, '8901234567890'],
    ['3*8901234567890', 3_000, '8901234567890'],
    ['0.75*rice', 750, 'rice'],
    ['2 * salt', 2_000, 'salt'],
    ['0*salt', null, '0*salt'],
    ['1.2345*salt', null, '1.2345*salt'],
    ['salt*', null, 'salt*'],
  ])('reads %j as quantity %j of %j', (text, quantity, query) => {
    expect(parseEntry(text)).toEqual({ quantityThousandths: quantity, query });
  });

  test('loose items take a typed quantity; whole units refuse a part', () => {
    expect(isLoose(rice, null)).toBe(true);
    expect(isLoose(salt, null)).toBe(false);
    expect(quantityProblem(salt, null, 1_500)).toBe('whole_units_only');
    expect(quantityProblem(salt, PACK.id, 500)).toBe('whole_units_only');
    expect(quantityProblem(rice, null, 750)).toBeNull();
    expect(quantityProblem(rice, null, 0)).toBe('invalid');
  });

  test('warns when the lines of one item take more than the branch has, packs counted in', () => {
    const copy = new CatalogueCopy();
    copy.apply(
      {
        items: [salt, rice],
        stock: [
          { itemId: salt.id, quantity: 20_000, lowStockLevel: null },
          { itemId: rice.id, quantity: 5_000, lowStockLevel: null },
        ],
        serverTime: '2026-11-21T10:00:00.000Z',
      },
      true,
    );
    const lines = [
      { itemId: salt.id, packId: PACK.id, quantityThousandths: 1_000, shownUnitPricePaise: 33_600 },
      { itemId: salt.id, packId: null, quantityThousandths: 9_000, shownUnitPricePaise: 2_800 },
      { itemId: rice.id, packId: null, quantityThousandths: 5_000, shownUnitPricePaise: 12_000 },
    ];
    expect(shortOfStock(lines, copy)).toEqual(new Map([[salt.id, 20_000]]));
  });

  test('names a line that can no longer be sold', () => {
    const copy = copyOf(salt, catalogueItem({ ...rice, gstRate: null }));
    const line = (itemId: string) => ({
      itemId,
      packId: null,
      quantityThousandths: 1_000,
      shownUnitPricePaise: 0,
    });
    expect(lineProblem(line(salt.id), copy, 'regular')).toBeNull();
    expect(lineProblem(line(rice.id), copy, 'regular')).toBe('no_gst');
    expect(lineProblem(line(rice.id), copy, 'composition')).toBeNull();
    expect(lineProblem(line('00000000-0000-4000-8000-0000000000ff'), copy, 'regular')).toBe('gone');
  });

  test('prices the bill with the GST engine itself, and not while a line is unsellable', () => {
    const copy = copyOf(salt, rice);
    const bill = {
      ...startBill('27'),
      lines: [
        { itemId: salt.id, packId: null, quantityThousandths: 2_000, shownUnitPricePaise: 2_800 },
        { itemId: rice.id, packId: null, quantityThousandths: 750, shownUnitPricePaise: 12_000 },
      ],
    };
    const expected = calculateBill(
      cartToBillInput(bill, {
        scheme: 'regular',
        supplierStateCode: '27',
        catalogue: copy.entries,
      }),
    );
    expect(priceOpenBill(bill, CONTEXT, copy)).toEqual(expected);
    expect(priceOpenBill({ ...bill, lines: [] }, CONTEXT, copy)).toBeNull();
    expect(priceOpenBill(bill, CONTEXT, copyOf(salt))).toBeNull();
  });

  test('takes new prices from the copy and says which lines changed', () => {
    const bill = {
      ...startBill('27'),
      lines: [
        { itemId: salt.id, packId: null, quantityThousandths: 2_000, shownUnitPricePaise: 2_800 },
        { itemId: rice.id, packId: null, quantityThousandths: 750, shownUnitPricePaise: 12_000 },
      ],
    };
    expect(repriceBill(bill, copyOf(salt, rice))).toEqual({ bill, changed: [] });
    const dearer = copyOf(salt, catalogueItem({ ...rice, sellingPrice: 13_000 }));
    const repriced = repriceBill(bill, dearer);
    expect(repriced.changed).toEqual([1]);
    expect(repriced.bill.lines[1]?.shownUnitPricePaise).toBe(13_000);
    // A line that can't be priced any more keeps its price; the screen marks it instead.
    expect(repriceBill(bill, copyOf(salt)).changed).toEqual([]);
  });

  test('is kept for this user across a reload, and forgotten at logout', () => {
    const bill = {
      ...startBill('27'),
      lines: [
        { itemId: salt.id, packId: null, quantityThousandths: 2_000, shownUnitPricePaise: 2_800 },
      ],
    };
    saveOpenBill(USER, bill);
    expect(loadOpenBill(USER)).toEqual(bill);
    expect(loadOpenBill('00000000-0000-4000-8000-000000000009')).toBeNull();
    clearOpenBills();
    expect(loadOpenBill(USER)).toBeNull();
  });

  test('an empty bill leaves nothing behind, and a broken copy is ignored', () => {
    saveOpenBill(USER, startBill('27'));
    expect(sessionStorage.length).toBe(0);
    sessionStorage.setItem(`bill:${USER}`, '{"lines":"nope"}');
    expect(loadOpenBill(USER)).toBeNull();
  });
});
