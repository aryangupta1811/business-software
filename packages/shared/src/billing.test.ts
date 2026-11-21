import { describe, expect, it } from 'vitest';
import {
  addToCart,
  billCartSchema,
  billDraftSchema,
  cartToBillInput,
  createCatalogueSearch,
  discountShares,
  discountWithinLimit,
  linePrice,
  type CartLine,
  type CatalogueItem,
} from './billing.js';
import { fieldErrors } from './fields.js';
import type { BillInput, Discount } from './gst.js';

const RICE = '00000000-0000-7000-8000-000000000001';
const SALT = '00000000-0000-7000-8000-000000000002';
const BAG = '00000000-0000-7000-8000-000000000003';
const BOX = '00000000-0000-7000-8000-000000000004';
const KEY = '00000000-0000-7000-8000-0000000000aa';

/** Loose rice: ₹120 a kg incl. 5%, wholesale ₹110; a 25 kg bag at its own price. */
const rice: CatalogueItem = {
  id: RICE,
  archived: false,
  kind: 'goods',
  name: 'Basmati Rice',
  hindiName: 'बासमती चावल',
  code: 'R12',
  stockUnit: 'kg',
  sellingPrice: 12_000,
  wholesalePrice: 11_000,
  mrp: null,
  priceIncludesTax: true,
  gstRate: 500,
  hsn: '1006',
  version: 3,
  packs: [
    {
      id: BAG,
      unitCode: 'bag',
      unitName: null,
      size: 25_000,
      sellingPrice: 280_000,
      mrp: null,
      soldAsPack: true,
    },
    {
      id: BOX,
      unitCode: 'box',
      unitName: null,
      size: 5_000,
      sellingPrice: null,
      mrp: null,
      soldAsPack: false,
    },
  ],
  barcodes: [],
};

/** Salt: ₹28 incl. 0%, MRP ₹28, no wholesale price. */
const salt: CatalogueItem = {
  ...rice,
  id: SALT,
  name: 'Tata Salt 1 kg',
  hindiName: null,
  code: null,
  stockUnit: 'piece',
  sellingPrice: 2_800,
  wholesalePrice: null,
  mrp: 2_800,
  gstRate: 0,
  hsn: '2501',
  packs: [],
};

const catalogue = new Map([rice, salt].map((item) => [item.id, item]));

function cartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    itemId: SALT,
    packId: null,
    quantityThousandths: 1_000,
    shownUnitPricePaise: 2_800,
    ...overrides,
  };
}

describe('linePrice', () => {
  it('is the item price for the stock unit', () => {
    expect(linePrice(rice, null, 'retail')).toBe(12_000);
  });

  it("is a pack's own price, or size × the item's price", () => {
    expect(linePrice(rice, BAG, 'retail')).toBe(280_000);
    expect(
      linePrice(
        { ...rice, packs: rice.packs.map((pack) => ({ ...pack, sellingPrice: null })) },
        BAG,
        'retail',
      ),
    ).toBe(300_000);
  });

  it('uses the wholesale price in a wholesale bill, and retail where an item has none', () => {
    expect(linePrice(rice, null, 'wholesale')).toBe(11_000);
    expect(linePrice(salt, null, 'wholesale')).toBe(2_800);
  });

  it('never makes a wholesale price above the retail one (a pack priced below size × price)', () => {
    // 25 × ₹110 = ₹2,750 is less than the bag's own ₹2,800; at ₹115 it would be ₹2,875.
    expect(linePrice(rice, BAG, 'wholesale')).toBe(275_000);
    expect(linePrice({ ...rice, wholesalePrice: 11_500 }, BAG, 'wholesale')).toBe(280_000);
  });

  it("refuses a pack the item doesn't have, or one that isn't sold as a pack", () => {
    expect(() => linePrice(rice, SALT, 'retail')).toThrow(RangeError);
    expect(() => linePrice(rice, BOX, 'retail')).toThrow(RangeError);
  });
});

describe('addToCart (question 2: the same item again adds to its line)', () => {
  it('adds a new line with the price shown', () => {
    expect(addToCart([], salt, null, 2_000, 'retail')).toEqual([
      cartLine({ quantityThousandths: 2_000 }),
    ]);
  });

  it('adds to the line for the same item and pack', () => {
    const lines = addToCart([cartLine()], salt, null, 3_000, 'retail');
    expect(lines).toEqual([cartLine({ quantityThousandths: 4_000 })]);
  });

  it('starts a new line for another pack of the same item', () => {
    const lines = addToCart(
      [cartLine({ itemId: RICE, shownUnitPricePaise: 12_000 })],
      rice,
      BAG,
      1_000,
      'retail',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual(cartLine({ itemId: RICE, packId: BAG, shownUnitPricePaise: 280_000 }));
  });

  it('starts a new line when the matching line has a discount', () => {
    const discounted = cartLine({ discount: { kind: 'percent', basisPoints: 500 } });
    const lines = addToCart([discounted], salt, null, 1_000, 'retail');
    expect(lines).toEqual([discounted, cartLine()]);
  });

  it("doesn't change the lines it was given", () => {
    const before = [cartLine()];
    addToCart(before, salt, null, 1_000, 'retail');
    expect(before).toEqual([cartLine()]);
  });
});

describe('cartToBillInput', () => {
  const context = { scheme: 'regular' as const, supplierStateCode: '09', catalogue };

  it('prices every line from the catalogue, not from the price shown', () => {
    const input = cartToBillInput(
      {
        priceList: 'retail',
        placeOfSupplyStateCode: '09',
        lines: [
          cartLine({ shownUnitPricePaise: 1 }),
          cartLine({
            itemId: RICE,
            packId: BAG,
            quantityThousandths: 2_000,
            shownUnitPricePaise: 1,
          }),
        ],
        billDiscount: { kind: 'amount', paise: 100 },
      },
      context,
    );
    expect(input).toEqual({
      scheme: 'regular',
      supplierStateCode: '09',
      placeOfSupplyStateCode: '09',
      lines: [
        {
          unitPricePaise: 2_800,
          quantityThousandths: 1_000,
          rateBasisPoints: 0,
          priceIncludesTax: true,
          hsn: '2501',
        },
        {
          unitPricePaise: 280_000,
          quantityThousandths: 2_000,
          rateBasisPoints: 500,
          priceIncludesTax: true,
          hsn: '1006',
        },
      ],
      billDiscount: { kind: 'amount', paise: 100 },
    });
  });

  it('keeps a line discount', () => {
    const discount: Discount = { kind: 'percent', basisPoints: 1_000 };
    const input = cartToBillInput(
      { priceList: 'retail', placeOfSupplyStateCode: '09', lines: [cartLine({ discount })] },
      context,
    );
    expect(input.lines[0]?.discount).toEqual(discount);
  });

  it('lets a business without GST bill an item with no rate or HSN', () => {
    const plain = { ...salt, gstRate: null, hsn: null };
    const input = cartToBillInput(
      { priceList: 'retail', placeOfSupplyStateCode: '09', lines: [cartLine()] },
      { ...context, scheme: 'unregistered', catalogue: new Map([[SALT, plain]]) },
    );
    expect(input.lines[0]).toMatchObject({ rateBasisPoints: 0, hsn: '' });
  });

  it('refuses, on a tax invoice, an item with no GST rate or HSN (02 #21, #24)', () => {
    for (const missing of [{ gstRate: null }, { hsn: null }]) {
      expect(() =>
        cartToBillInput(
          { priceList: 'retail', placeOfSupplyStateCode: '09', lines: [cartLine()] },
          { ...context, catalogue: new Map([[SALT, { ...salt, ...missing }]]) },
        ),
      ).toThrow(RangeError);
    }
  });

  it("refuses an item that isn't in the catalogue or is archived", () => {
    const lines = [cartLine({ itemId: BAG })];
    expect(() =>
      cartToBillInput({ priceList: 'retail', placeOfSupplyStateCode: '09', lines }, context),
    ).toThrow(RangeError);
    expect(() =>
      cartToBillInput(
        { priceList: 'retail', placeOfSupplyStateCode: '09', lines: [cartLine()] },
        {
          ...context,
          catalogue: new Map([[SALT, { id: SALT, archived: true, name: 'Salt', barcodes: [] }]]),
        },
      ),
    ).toThrow(RangeError);
  });
});

/** ₹100 before tax at 18% (₹118 paid), quantity 1, with an optional discount, per line. */
function billOf(lines: (Discount | undefined)[], billDiscount?: Discount): BillInput {
  return {
    scheme: 'regular',
    supplierStateCode: '09',
    placeOfSupplyStateCode: '09',
    lines: lines.map((discount) => ({
      unitPricePaise: 10_000,
      quantityThousandths: 1_000,
      rateBasisPoints: 1_800,
      priceIncludesTax: false,
      hsn: '1006',
      ...(discount === undefined ? {} : { discount }),
    })),
    ...(billDiscount === undefined ? {} : { billDiscount }),
  };
}

const percent = (basisPoints: number): Discount => ({ kind: 'percent', basisPoints });
const rupees = (paise: number): Discount => ({ kind: 'amount', paise });

/** Three-line carts, no discounts, whose prices and rates make GST round each tax half. */
function* awkwardPlainCarts(): Generator<BillInput> {
  for (const price of [1, 7, 99, 1_005, 2_499, 9_750]) {
    for (const rate of [0, 25, 150, 500, 1_800, 4_000]) {
      for (const priceIncludesTax of [true, false]) {
        for (const placeOfSupplyStateCode of ['09', '27']) {
          const line = {
            unitPricePaise: price,
            quantityThousandths: 1_333,
            rateBasisPoints: rate,
            priceIncludesTax,
            hsn: '1006',
          };
          yield {
            scheme: 'regular',
            supplierStateCode: '09',
            placeOfSupplyStateCode,
            lines: [line, line, { ...line, unitPricePaise: price + 3 }],
          };
        }
      }
    }
  }
}

/** The same carts with a discount on the first line, and the same discount on the bill. */
function* awkwardCarts(): Generator<BillInput> {
  for (const plain of awkwardPlainCarts()) {
    const [first, ...rest] = plain.lines;
    if (first === undefined) throw new Error('a cart has lines');
    for (const discount of [percent(1_000), rupees(first.unitPricePaise)]) {
      yield { ...plain, lines: [{ ...first, discount }, ...rest], billDiscount: discount };
    }
  }
}

describe('discountShares (what an owner OK must cover)', () => {
  it('is zero for a bill with no discount, or no lines at all', () => {
    const none = { lineBasisPoints: 0, billBasisPoints: 0 };
    expect(discountShares(billOf([undefined]))).toEqual(none);
    expect(discountShares(billOf([]))).toEqual(none);
  });

  it("is the biggest line discount on its own price, and the whole bill's share of the gross", () => {
    // 10% off one of two ₹118 lines, then 5% off the bill: the customer pays ₹213 of ₹236.
    const bill = billOf([percent(1_000), undefined], percent(500));
    expect(discountShares(bill)).toEqual({ lineBasisPoints: 1_000, billBasisPoints: 975 });
  });

  it('rounds a share up: ₹1 off ₹118 is 0.847…%', () => {
    expect(discountShares(billOf([undefined], rupees(100))).billBasisPoints).toBe(85);
  });

  it('always covers the bill it was worked out from', () => {
    for (const cart of awkwardCarts()) {
      expect(discountWithinLimit(cart, discountShares(cart))).toBe(true);
    }
  });
});

describe('discountWithinLimit (02 #12, question 4)', () => {
  it('is always true for the owner (no limit)', () => {
    expect(discountWithinLimit(billOf([percent(10_000)]), null)).toBe(true);
  });

  it('allows no discount at all with a limit of 0', () => {
    expect(discountWithinLimit(billOf([undefined]), 0)).toBe(true);
    expect(discountWithinLimit(billOf([undefined], rupees(1)), 0)).toBe(false);
  });

  it('allows a discount exactly at the limit, on a line and on the bill', () => {
    expect(discountWithinLimit(billOf([percent(1_000)]), 1_000)).toBe(true);
    expect(discountWithinLimit(billOf([undefined, undefined], percent(1_000)), 1_000)).toBe(true);
  });

  it('refuses one line over the limit, even when the bill as a whole is within it', () => {
    // 15% off one of three ₹118 lines is 5% of the bill.
    const bill = billOf([percent(1_500), undefined, undefined]);
    expect(discountWithinLimit(bill, 1_000)).toBe(false);
  });

  it('refuses a bill over the limit even when each line is within it', () => {
    // 10% off a line and 10% off the bill is 19% in all.
    expect(discountWithinLimit(billOf([percent(1_000)], percent(1_000)), 1_000)).toBe(false);
  });

  it('measures rupee discounts too, and refuses one paisa over', () => {
    // ₹10 off a ₹100 (before tax) line is 10%; ₹11.80 off a ₹118 bill is 10%.
    expect(discountWithinLimit(billOf([rupees(1_000)]), 1_000)).toBe(true);
    expect(discountWithinLimit(billOf([rupees(1_001)]), 1_000)).toBe(false);
    expect(discountWithinLimit(billOf([undefined], rupees(1_180)), 1_000)).toBe(true);
    expect(discountWithinLimit(billOf([undefined], rupees(1_181)), 1_000)).toBe(false);
  });

  it('takes separate line and bill limits (an owner OK records both)', () => {
    const bill = billOf([percent(1_500), undefined, undefined]);
    expect(discountWithinLimit(bill, { lineBasisPoints: 1_500, billBasisPoints: 500 })).toBe(true);
    expect(discountWithinLimit(bill, { lineBasisPoints: 1_499, billBasisPoints: 500 })).toBe(false);
  });

  it("never refuses a percent at the limit because of GST's paise rounding", () => {
    for (const plain of awkwardPlainCarts()) {
      const [first, ...rest] = plain.lines;
      if (first === undefined) throw new Error('a cart has lines');
      const onLine = { ...plain, lines: [{ ...first, discount: percent(1_000) }, ...rest] };
      expect(discountWithinLimit(onLine, 1_000)).toBe(true);
      expect(discountWithinLimit({ ...plain, billDiscount: percent(1_000) }, 1_000)).toBe(true);
    }
  });
});

const draft = {
  billKey: KEY,
  priceList: 'retail',
  customerId: null,
  placeOfSupplyStateCode: '09',
  lines: [cartLine()],
};

const paid = {
  ...draft,
  payments: [{ mode: 'cash', amountPaise: 2_800, tenderedPaise: 5_000 }],
  shownGrandTotalPaise: 2_800,
};

function errorsOf(schema: typeof billCartSchema | typeof billDraftSchema, body: unknown) {
  const result = schema.safeParse(body);
  return result.success ? {} : fieldErrors(result.error);
}

describe('billCartSchema (a held bill, design §9)', () => {
  it('accepts a cart', () => {
    expect(errorsOf(billCartSchema, draft)).toEqual({});
    expect(
      errorsOf(billCartSchema, {
        ...draft,
        lines: [cartLine({ discount: percent(500) })],
        billDiscount: rupees(100),
      }),
    ).toEqual({});
  });

  it.each([
    ['an unknown field', { extra: 1 }, 'extra'],
    ['no lines', { lines: [] }, 'lines'],
    ['a bad state', { placeOfSupplyStateCode: '00' }, 'placeOfSupplyStateCode'],
    ['a bad price list', { priceList: 'special' }, 'priceList'],
    [
      'a zero quantity',
      { lines: [cartLine({ quantityThousandths: 0 })] },
      'lines.0.quantityThousandths',
    ],
    ['a discount over 100%', { billDiscount: percent(10_001) }, 'billDiscount.basisPoints'],
    ['a discount of nothing', { billDiscount: rupees(0) }, 'billDiscount.paise'],
    ['payments', { payments: [] }, 'payments'],
  ])('refuses %s', (_, change, field) => {
    expect(Object.keys(errorsOf(billCartSchema, { ...draft, ...change }))).toEqual([field]);
  });
});

describe('billDraftSchema (what P1.14 saves, design §10)', () => {
  it('accepts a paid bill, a split one, and a free one with no payments', () => {
    expect(errorsOf(billDraftSchema, paid)).toEqual({});
    expect(
      errorsOf(billDraftSchema, {
        ...paid,
        payments: [
          { mode: 'upi', amountPaise: 2_000, reference: '4521' },
          { mode: 'cheque', amountPaise: 800, reference: '000123' },
        ],
      }),
    ).toEqual({});
    expect(errorsOf(billDraftSchema, { ...paid, payments: [], shownGrandTotalPaise: 0 })).toEqual(
      {},
    );
  });

  it.each([
    [
      'payments that fall short',
      { payments: [{ mode: 'cash', amountPaise: 2_700 }] },
      'payments',
      'payments_mismatch',
    ],
    [
      'payments that go over',
      { payments: [{ mode: 'upi', amountPaise: 2_900 }] },
      'payments',
      'payments_mismatch',
    ],
    [
      'cash handed over below its amount',
      { payments: [{ mode: 'cash', amountPaise: 2_800, tenderedPaise: 2_000 }] },
      'payments.0.tenderedPaise',
      'too_small',
    ],
    [
      'money handed over for UPI',
      { payments: [{ mode: 'upi', amountPaise: 2_800, tenderedPaise: 3_000 }] },
      'payments.0.tenderedPaise',
      'cash_only',
    ],
    [
      'a cheque with no number',
      { payments: [{ mode: 'cheque', amountPaise: 2_800 }] },
      'payments.0.reference',
      'required',
    ],
    [
      'an unknown mode',
      { payments: [{ mode: 'udhaar', amountPaise: 2_800 }] },
      'payments.0.mode',
      'invalid',
    ],
  ])('refuses %s', (_, change, field, code) => {
    expect(errorsOf(billDraftSchema, { ...paid, ...change })).toEqual({ [field]: code });
  });
});

describe('createCatalogueSearch (design §4)', () => {
  const entry = (name: string, code: string | null = null, hindiName: string | null = null) => ({
    name,
    code,
    hindiName,
  });
  const items = [
    entry('Rice Flour'),
    entry('Brown Rice'),
    entry('Basmati Rice', 'R12'),
    entry('Ricotta Cheese'),
    entry('Licorice'),
    entry('Café Coffee', 'RICE'),
    entry('Atta', null, 'आटा'),
  ];
  const search = createCatalogueSearch(items);
  const names = (query: string, limit?: number) => search(query, limit).map((item) => item.name);

  it('ranks an exact code, then a name start, then a word start, then anything containing it', () => {
    // "Ricotta" doesn't contain "rice"; "Licorice" does, in the middle of a word.
    expect(names('rice')).toEqual([
      'Café Coffee',
      'Rice Flour',
      'Brown Rice',
      'Basmati Rice',
      'Licorice',
    ]);
  });

  it('ignores case, accents and extra spaces, and finds a code', () => {
    expect(names('  CAFE  coffee ')).toEqual(['Café Coffee']);
    expect(names('r12')).toEqual(['Basmati Rice']);
  });

  it('finds the Hindi name, matras and all', () => {
    expect(names('आटा')).toEqual(['Atta']);
    expect(names('आट')).toEqual(['Atta']);
  });

  it('returns nothing for a blank query, and at most the limit', () => {
    expect(names('   ')).toEqual([]);
    expect(names('ric', 2)).toHaveLength(2);
  });

  it('searches 5,000 items quickly', () => {
    const many = Array.from({ length: 5_000 }, (_, index) =>
      entry(`Item number ${String(index)} masala`, `C${String(index)}`),
    );
    const searchMany = createCatalogueSearch(many);
    const started = Date.now();
    for (const query of ['m', 'ma', 'mas', 'masa', 'item 49']) searchMany(query);
    expect((Date.now() - started) / 5).toBeLessThan(20);
  });
});
