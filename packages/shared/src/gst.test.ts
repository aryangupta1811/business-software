import { describe, expect, it } from 'vitest';
import { calculateBill, type BillInput, type BillLineInput, type Discount } from './gst.js';

/** A line of ₹100 tax-exclusive at 18%, quantity 1, unless overridden. */
function line(overrides: Partial<BillLineInput> = {}): BillLineInput {
  return {
    unitPricePaise: 10000,
    quantityThousandths: 1000,
    rateBasisPoints: 1800,
    priceIncludesTax: false,
    hsn: '1006',
    ...overrides,
  };
}

/** A regular business in Uttar Pradesh (09) selling at its own counter, unless overridden. */
function bill(lines: BillLineInput[], overrides: Partial<BillInput> = {}): BillInput {
  return {
    scheme: 'regular',
    supplierStateCode: '09',
    placeOfSupplyStateCode: '09',
    lines,
    ...overrides,
  };
}

const INTER_STATE = { placeOfSupplyStateCode: '27' } as const;

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

describe('calculateBill: line amount (price × quantity)', () => {
  it.each<[number, number, number]>([
    [10000, 1000, 10000], // 1 piece of ₹100
    [10000, 3000, 30000], // 3 pieces
    [4250, 250, 1063], // 250 g of ₹42.50/kg = ₹10.625, half up
    [4250, 750, 3188], // 750 g = ₹31.875
    [1, 500, 1], // half a paisa rounds up
    [1, 499, 0],
    [0, 1000, 0], // a free item
    [1999, 1, 2], // 1 g of ₹19.99/kg = 1.999 paise
    [900719925474, 10000, 9007199254740], // big, still exact
  ])('%i paise × %i thousandths = %i paise', (unitPricePaise, quantityThousandths, amount) => {
    const result = calculateBill(
      bill([line({ unitPricePaise, quantityThousandths, rateBasisPoints: 0 })]),
    );
    expect(only(result.lines).amountPaise).toBe(amount);
  });
});

describe('calculateBill: tax-exclusive prices', () => {
  it.each<[string, number, number, number, number, number, number]>([
    // name, taxable, rate, CGST, SGST, IGST (inter-state), total
    ['₹100 at 18%', 10000, 1800, 900, 900, 1800, 11800],
    ['₹100 at 0%', 10000, 0, 0, 0, 0, 10000],
    ['₹100 at 5%', 10000, 500, 250, 250, 500, 10500],
    ['₹100 at 40%', 10000, 4000, 2000, 2000, 4000, 14000],
    ['₹10.05 at 5%', 1005, 500, 25, 25, 50, 1055], // 25.125 each; IGST 50.25
    ['₹1 at 3% (gold)', 100, 300, 2, 2, 3, 104], // 1.5 each rounds up; IGST is exactly 3
    ['₹1,000 at 0.25%', 100000, 25, 125, 125, 250, 100250],
    ['₹10 at 0.25%', 1000, 25, 1, 1, 3, 1002], // 1.25 each; IGST 2.5 rounds up
    ['₹97.50 at 18%', 9750, 1800, 878, 878, 1755, 11506], // 877.5 rounds up
  ])('%s', (_name, taxable, rateBasisPoints, cgst, sgst, igst, intraTotal) => {
    const intra = only(
      calculateBill(bill([line({ unitPricePaise: taxable, rateBasisPoints })])).lines,
    );
    expect(intra).toMatchObject({
      taxablePaise: taxable,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: 0,
      totalPaise: intraTotal,
    });

    const inter = only(
      calculateBill(bill([line({ unitPricePaise: taxable, rateBasisPoints })], INTER_STATE)).lines,
    );
    expect(inter).toMatchObject({
      taxablePaise: taxable,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: igst,
      totalPaise: taxable + igst,
    });
  });
});

describe('calculateBill: tax-inclusive prices', () => {
  it.each<[string, number, number, number, number, number, number]>([
    // name, price paid, rate, taxable (intra), CGST = SGST, taxable (inter), IGST
    ['₹118 at 18%', 11800, 1800, 10000, 900, 10000, 1800],
    ['₹100 at 18%', 10000, 1800, 8474, 763, 8475, 1525], // 762.71 each; IGST 1525.42
    ['₹140 at 40%', 14000, 4000, 10000, 2000, 10000, 4000],
    ['₹105 at 5%', 10500, 500, 10000, 250, 10000, 500],
    ['₹50 at 0%', 5000, 0, 5000, 0, 5000, 0],
    ['₹0.01 at 18%', 1, 1800, 1, 0, 1, 0],
    ['₹1.03 at 3%', 103, 300, 99, 2, 100, 3], // 1.5 each rounds up, so the odd paisa leaves taxable
  ])('%s', (_name, paid, rateBasisPoints, intraTaxable, half, interTaxable, igst) => {
    const priced = line({ unitPricePaise: paid, rateBasisPoints, priceIncludesTax: true });

    const intra = only(calculateBill(bill([priced])).lines);
    expect(intra).toMatchObject({
      amountPaise: paid,
      taxablePaise: intraTaxable,
      cgstPaise: half,
      sgstPaise: half,
      igstPaise: 0,
      totalPaise: paid, // the customer pays exactly the price, never a paisa more
    });

    const inter = only(calculateBill(bill([priced], INTER_STATE)).lines);
    expect(inter).toMatchObject({
      taxablePaise: interTaxable,
      igstPaise: igst,
      totalPaise: paid,
    });
  });
});

describe('calculateBill: item discounts (GST after discount)', () => {
  it('takes a percent discount off a tax-inclusive price before working out the tax', () => {
    // ₹118 MRP at 18%, 10% off: the customer pays ₹106.20 = ₹90 + ₹8.10 + ₹8.10
    const result = calculateBill(
      bill([
        line({
          unitPricePaise: 11800,
          priceIncludesTax: true,
          discount: { kind: 'percent', basisPoints: 1000 },
        }),
      ]),
    );
    expect(only(result.lines)).toMatchObject({
      amountPaise: 11800,
      itemDiscountPaise: 1180,
      billDiscountPaise: 0,
      taxablePaise: 9000,
      cgstPaise: 810,
      sgstPaise: 810,
      totalPaise: 10620,
    });
    expect(result.itemDiscountPaise).toBe(1180);
  });

  it('takes an amount discount off a tax-exclusive line', () => {
    const result = calculateBill(bill([line({ discount: { kind: 'amount', paise: 500 } })]));
    expect(only(result.lines)).toMatchObject({
      itemDiscountPaise: 500,
      taxablePaise: 9500,
      cgstPaise: 855,
      sgstPaise: 855,
      totalPaise: 11210,
    });
  });

  it.each<[number, number, number]>([
    [999, 1050, 105], // 10.5% of ₹9.99 = 104.895 paise
    [1000, 1050, 105],
    [10, 500, 1], // 0.5 paisa rounds up
    [9, 500, 0], // 0.45 paisa rounds down
    [10000, 10000, 10000], // 100% off
    [10000, 0, 0],
  ])('%i paise with %i bp off gives %i paise off', (unitPricePaise, basisPoints, off) => {
    const result = calculateBill(
      bill([line({ unitPricePaise, discount: { kind: 'percent', basisPoints } })]),
    );
    expect(only(result.lines).itemDiscountPaise).toBe(off);
  });

  it('charges no tax on a line given away free', () => {
    const result = calculateBill(
      bill([line({ discount: { kind: 'amount', paise: 10000 } })], INTER_STATE),
    );
    expect(only(result.lines)).toMatchObject({ taxablePaise: 0, igstPaise: 0, totalPaise: 0 });
  });

  it.each<Discount>([
    { kind: 'amount', paise: 10001 },
    { kind: 'amount', paise: -1 },
    { kind: 'amount', paise: 0.5 },
    { kind: 'percent', basisPoints: 10001 },
    { kind: 'percent', basisPoints: -1 },
    { kind: 'percent', basisPoints: 12.5 },
  ])('refuses the item discount %j on a ₹100 line', (discount) => {
    expect(() => calculateBill(bill([line({ discount })]))).toThrow(RangeError);
  });
});

describe('calculateBill: bill discounts', () => {
  const twoRates = [
    line({ unitPricePaise: 10000, rateBasisPoints: 1800, hsn: '3304' }),
    line({ unitPricePaise: 30000, rateBasisPoints: 500, hsn: '0401' }),
  ];

  it('shares an amount off the bill across lines with different rates, then taxes each line', () => {
    const result = calculateBill(bill(twoRates, { billDiscount: { kind: 'amount', paise: 1000 } }));
    const [first, second] = result.lines;
    expect(first).toMatchObject({ billDiscountPaise: 250, taxablePaise: 9750, cgstPaise: 878 });
    expect(first?.totalPaise).toBe(11506);
    expect(second).toMatchObject({ billDiscountPaise: 750, taxablePaise: 29250, cgstPaise: 731 });
    expect(second?.totalPaise).toBe(30712);
    expect(result).toMatchObject({
      billDiscountPaise: 1000,
      totalPaise: 42218,
      roundOffPaise: -18,
      grandTotalPaise: 42200,
    });
  });

  it('works out a percent off the bill once on the subtotal, then shares it', () => {
    // 10% of ₹9.99 is 99.9 paise → 100 paise; 10% of each ₹3.33 line separately would give only 99
    const threeLines = [1, 2, 3].map(() => line({ unitPricePaise: 333, rateBasisPoints: 0 }));
    const result = calculateBill(
      bill(threeLines, { billDiscount: { kind: 'percent', basisPoints: 1000 } }),
    );
    expect(result.billDiscountPaise).toBe(100);
    expect(result.lines.map((l) => l.billDiscountPaise)).toEqual([34, 33, 33]);
  });

  it('shares one paisa to the first of equal lines', () => {
    const threeLines = [1, 2, 3].map(() => line({ rateBasisPoints: 0 }));
    const result = calculateBill(bill(threeLines, { billDiscount: { kind: 'amount', paise: 1 } }));
    expect(result.lines.map((l) => l.billDiscountPaise)).toEqual([1, 0, 0]);
  });

  it('shares by the amount left after each item discount', () => {
    const lines = [line({ discount: { kind: 'percent', basisPoints: 10000 } }), line()];
    const result = calculateBill(bill(lines, { billDiscount: { kind: 'amount', paise: 500 } }));
    expect(result.lines.map((l) => l.billDiscountPaise)).toEqual([0, 500]);
  });

  it('keeps a tax-inclusive bill exactly the discount cheaper', () => {
    const inclusive = [
      line({ unitPricePaise: 11800, priceIncludesTax: true }),
      line({ unitPricePaise: 5250, priceIncludesTax: true, rateBasisPoints: 500 }),
    ];
    const full = calculateBill(bill(inclusive));
    const discounted = calculateBill(
      bill(inclusive, { billDiscount: { kind: 'amount', paise: 1700 } }),
    );
    expect(full.totalPaise - discounted.totalPaise).toBe(1700);
  });

  it.each<Discount>([
    { kind: 'amount', paise: 40001 },
    { kind: 'percent', basisPoints: 10001 },
    { kind: 'amount', paise: -5 },
  ])('refuses the bill discount %j on a ₹400 bill', (billDiscount) => {
    expect(() => calculateBill(bill(twoRates, { billDiscount }))).toThrow(RangeError);
  });

  it('refuses an amount off an empty bill', () => {
    expect(() => calculateBill(bill([], { billDiscount: { kind: 'amount', paise: 1 } }))).toThrow(
      RangeError,
    );
  });

  it('allows a 100% bill discount', () => {
    const result = calculateBill(
      bill(twoRates, { billDiscount: { kind: 'percent', basisPoints: 10000 } }),
    );
    expect(result).toMatchObject({ taxablePaise: 0, cgstPaise: 0, grandTotalPaise: 0 });
  });
});

describe('calculateBill: place of supply', () => {
  it('charges CGST + SGST within a state', () => {
    const result = calculateBill(bill([line()]));
    expect(result).toMatchObject({ tax: 'cgst-sgst', stateTaxName: 'SGST' });
  });

  it('charges IGST across states', () => {
    const result = calculateBill(bill([line()], INTER_STATE));
    expect(result).toMatchObject({ tax: 'igst', cgstPaise: 0, sgstPaise: 0, igstPaise: 1800 });
  });

  it.each(['04', '26', '31', '35', '38', '97'])(
    'calls the state half UTGST in Union Territory %s',
    (code) => {
      const result = calculateBill(
        bill([line()], { supplierStateCode: code, placeOfSupplyStateCode: code }),
      );
      expect(result).toMatchObject({ tax: 'cgst-sgst', stateTaxName: 'UTGST', sgstPaise: 900 });
    },
  );

  it.each(['07', '34', '01', '27'])(
    'keeps SGST in %s (a state or a UT with a legislature)',
    (code) => {
      const result = calculateBill(
        bill([line()], { supplierStateCode: code, placeOfSupplyStateCode: code }),
      );
      expect(result.stateTaxName).toBe('SGST');
    },
  );

  it.each(['9', '099', 'UP', '', ' 09', '0a', '25', '96', '99'])(
    'refuses the state code %j',
    (code) => {
      expect(() => calculateBill(bill([line()], { placeOfSupplyStateCode: code }))).toThrow(
        RangeError,
      );
      expect(() => calculateBill(bill([line()], { supplierStateCode: code }))).toThrow(RangeError);
    },
  );
});

describe('calculateBill: composition and unregistered businesses', () => {
  it.each(['composition', 'unregistered'] as const)(
    'a %s business charges no tax, whatever the price basis or place of supply',
    (scheme) => {
      const lines = [
        line({ priceIncludesTax: false }),
        line({ priceIncludesTax: true, unitPricePaise: 11800 }),
      ];
      const result = calculateBill(bill(lines, { scheme, ...INTER_STATE }));
      expect(result).toMatchObject({
        tax: 'none',
        taxablePaise: 21800,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 21800,
        grandTotalPaise: 21800,
      });
      expect(result.lines.map((l) => l.rateBasisPoints)).toEqual([0, 0]);
      expect(result.byRate).toEqual([
        {
          rateBasisPoints: 0,
          taxablePaise: 21800,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          totalPaise: 21800,
        },
      ]);
    },
  );

  it('still rounds off and takes discounts', () => {
    const result = calculateBill(
      bill([line({ unitPricePaise: 10099, discount: { kind: 'amount', paise: 49 } })], {
        scheme: 'composition',
        billDiscount: { kind: 'percent', basisPoints: 1000 },
      }),
    );
    expect(result).toMatchObject({
      itemDiscountPaise: 49,
      billDiscountPaise: 1005,
      totalPaise: 9045,
      roundOffPaise: -45,
      grandTotalPaise: 9000,
    });
  });
});

describe('calculateBill: round-off to the nearest rupee', () => {
  it.each<[number, number, number]>([
    [10049, -49, 10000],
    [10050, 50, 10100],
    [10051, 49, 10100],
    [10000, 0, 10000],
    [10099, 1, 10100],
    [49, -49, 0],
    [50, 50, 100],
    [0, 0, 0],
  ])('a total of %i paise rounds by %i to %i', (total, roundOff, grandTotal) => {
    const result = calculateBill(bill([line({ unitPricePaise: total, rateBasisPoints: 0 })]));
    expect(result.totalPaise).toBe(total);
    expect(result.roundOffPaise).toBe(roundOff); // toBe also tells 0 from -0
    expect(result.grandTotalPaise).toBe(grandTotal);
  });

  it('gives an empty bill zero everywhere', () => {
    expect(calculateBill(bill([]))).toMatchObject({
      lines: [],
      amountPaise: 0,
      totalPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 0,
      byRate: [],
      byHsn: [],
    });
  });
});

describe('calculateBill: summaries by rate and by HSN', () => {
  const lines = [
    line({ unitPricePaise: 10000, rateBasisPoints: 1800, hsn: '1006' }),
    line({ unitPricePaise: 20000, rateBasisPoints: 500, hsn: '0401' }),
    line({ unitPricePaise: 5000, rateBasisPoints: 1800, hsn: '3304' }),
    line({ unitPricePaise: 1000, rateBasisPoints: 1800, hsn: '1006' }),
  ];
  const sum = (taxable: number, half: number) => ({
    taxablePaise: taxable,
    cgstPaise: half,
    sgstPaise: half,
    igstPaise: 0,
    totalPaise: taxable + 2 * half,
  });

  it('groups by rate, lowest first', () => {
    expect(calculateBill(bill(lines)).byRate).toEqual([
      { rateBasisPoints: 500, ...sum(20000, 500) },
      { rateBasisPoints: 1800, ...sum(16000, 1440) },
    ]);
  });

  it('groups by HSN code and rate, sorted by rate then code', () => {
    expect(calculateBill(bill(lines)).byHsn).toEqual([
      { hsn: '0401', rateBasisPoints: 500, ...sum(20000, 500) },
      { hsn: '1006', rateBasisPoints: 1800, ...sum(11000, 990) },
      { hsn: '3304', rateBasisPoints: 1800, ...sum(5000, 450) },
    ]);
  });

  it('keeps one HSN code sold at two rates apart', () => {
    const twoRates = [
      line({ hsn: '6109', rateBasisPoints: 500 }),
      line({ hsn: '6109', rateBasisPoints: 1800 }),
    ];
    expect(calculateBill(bill(twoRates)).byHsn.map((s) => s.rateBasisPoints)).toEqual([500, 1800]);
  });

  it('keeps the totals equal to the sum of the lines', () => {
    const result = calculateBill(bill(lines));
    expect(result).toMatchObject({
      amountPaise: 36000,
      taxablePaise: 36000,
      cgstPaise: 1940,
      sgstPaise: 1940,
      igstPaise: 0,
      totalPaise: 39880,
    });
  });

  it('copies each line’s HSN code and rate into its result', () => {
    const result = calculateBill(bill(lines));
    expect(result.lines.map((l) => [l.hsn, l.rateBasisPoints])).toEqual([
      ['1006', 1800],
      ['0401', 500],
      ['3304', 1800],
      ['1006', 1800],
    ]);
  });
});

describe('calculateBill: bad input', () => {
  it.each<[string, Partial<BillLineInput>]>([
    ['a negative price', { unitPricePaise: -1 }],
    ['a price in fractions of a paisa', { unitPricePaise: 1.5 }],
    ['an unsafe price', { unitPricePaise: 2 ** 53 }],
    ['a quantity of 0', { quantityThousandths: 0 }],
    ['a negative quantity', { quantityThousandths: -1000 }],
    ['a fractional quantity', { quantityThousandths: 0.5 }],
    ['a negative rate', { rateBasisPoints: -1 }],
    ['a rate over 100%', { rateBasisPoints: 10001 }],
    ['a fractional rate', { rateBasisPoints: 1.5 }],
    ['a NaN price', { unitPricePaise: Number.NaN }],
  ])('refuses %s', (_name, overrides) => {
    expect(() => calculateBill(bill([line(overrides)]))).toThrow(RangeError);
  });

  it('refuses an amount past the safe range', () => {
    const huge = line({ unitPricePaise: Number.MAX_SAFE_INTEGER, quantityThousandths: 2000 });
    expect(() => calculateBill(bill([huge]))).toThrow(RangeError);
  });

  it('refuses a bill whose total is past the safe range, even when each line is safe', () => {
    const big = line({ unitPricePaise: 2 ** 52, rateBasisPoints: 0 });
    expect(() => calculateBill(bill([big, big, big]))).toThrow(RangeError);
  });

  it('refuses an unknown scheme from untyped code', () => {
    const input = { ...bill([line()]), scheme: 'exempt' } as unknown as BillInput;
    expect(() => calculateBill(input)).toThrow(RangeError);
  });
});

/** mulberry32: a tiny seeded generator, so the random carts are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('calculateBill: invariants over generated carts', () => {
  const random = seeded(20261118);
  const int = (max: number) => Math.floor(random() * (max + 1));
  const pick = <T>(items: readonly T[]): T => items[int(items.length - 1)] as T;
  const RATES = [0, 25, 300, 500, 1800, 4000];

  const carts = Array.from({ length: 400 }, (): BillInput => {
    const lines = Array.from({ length: int(8) }, (): BillLineInput => {
      const unitPricePaise = int(500000);
      const quantityThousandths = 1 + int(50000);
      const floorAmount = Math.floor((unitPricePaise * quantityThousandths) / 1000);
      const discount = pick<Discount | undefined>([
        undefined,
        { kind: 'percent', basisPoints: int(10000) },
        { kind: 'amount', paise: int(floorAmount) },
      ]);
      return {
        unitPricePaise,
        quantityThousandths,
        rateBasisPoints: pick(RATES),
        priceIncludesTax: random() < 0.5,
        hsn: pick(['1006', '0401', '3304']),
        ...(discount ? { discount } : {}),
      };
    });
    return {
      scheme: pick(['regular', 'regular', 'regular', 'composition', 'unregistered'] as const),
      supplierStateCode: '09',
      placeOfSupplyStateCode: pick(['09', '27']),
      lines,
      ...(random() < 0.5 ? { billDiscount: { kind: 'percent', basisPoints: int(3000) } } : {}),
    };
  });

  const total = <T>(items: readonly T[], field: (item: T) => number) =>
    items.reduce((sum, item) => sum + field(item), 0);

  it.each(carts.map((cart, index) => [index, cart] as const))('cart %i', (_index, cart) => {
    const result = calculateBill(cart);

    expect(result.lines).toHaveLength(cart.lines.length);
    for (const [index, l] of result.lines.entries()) {
      const input = cart.lines[index];
      if (input === undefined) throw new Error(`No input for line ${String(index)}`);
      const net = l.amountPaise - l.itemDiscountPaise - l.billDiscountPaise;
      expect(net).toBeGreaterThanOrEqual(0);
      expect(l.totalPaise).toBe(l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise);
      expect(l.cgstPaise).toBe(l.sgstPaise);
      if (result.tax === 'none' || input.priceIncludesTax) {
        expect(l.totalPaise).toBe(net);
      } else {
        expect(l.taxablePaise).toBe(net);
      }
      if (result.tax !== 'none' && input.priceIncludesTax) {
        // The taxable value is within one paisa of the exact net ÷ (1 + rate).
        const exact = (net * 10000) / (10000 + l.rateBasisPoints);
        expect(Math.abs(l.taxablePaise - exact)).toBeLessThanOrEqual(1);
      }
    }

    expect(result.amountPaise).toBe(total(result.lines, (l) => l.amountPaise));
    expect(result.itemDiscountPaise).toBe(total(result.lines, (l) => l.itemDiscountPaise));
    expect(result.billDiscountPaise).toBe(total(result.lines, (l) => l.billDiscountPaise));
    expect(result.taxablePaise).toBe(total(result.lines, (l) => l.taxablePaise));
    expect(result.cgstPaise).toBe(total(result.lines, (l) => l.cgstPaise));
    expect(result.igstPaise).toBe(total(result.lines, (l) => l.igstPaise));
    expect(result.totalPaise).toBe(total(result.lines, (l) => l.totalPaise));
    expect(result.roundOffPaise).toBeGreaterThanOrEqual(-49);
    expect(result.roundOffPaise).toBeLessThanOrEqual(50);
    expect(result.grandTotalPaise % 100).toBe(0);
    expect(result.grandTotalPaise).toBe(result.totalPaise + result.roundOffPaise);

    for (const summary of [result.byRate, result.byHsn]) {
      expect(total(summary, (s) => s.taxablePaise)).toBe(result.taxablePaise);
      expect(total(summary, (s) => s.sgstPaise)).toBe(result.sgstPaise);
      expect(total(summary, (s) => s.igstPaise)).toBe(result.igstPaise);
      expect(total(summary, (s) => s.totalPaise)).toBe(result.totalPaise);
    }
  });
});
