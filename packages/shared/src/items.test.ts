import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { fieldErrors, type FieldErrors } from './fields.js';
import {
  barcodeSchema,
  categorySchema,
  ean13CheckDigit,
  GST_RATES,
  inStoreBarcode,
  inStoreSerial,
  itemQuerySchema,
  itemUpdateSchema,
  newItemSchema,
  packPrice,
  unitSchema,
} from './items.js';

function errorsOf(schema: z.ZodType, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  return result.success ? {} : fieldErrors(result.error);
}

const UNIT_ID = '0195f3a0-0000-7000-8000-000000000001';
const BRANCH_ID = '0195f3a0-0000-7000-8000-000000000002';
const PACK_ID = '0195f3a0-0000-7000-8000-000000000003';

// Atta sold loose by the kg, with a 50 kg bag bought and sold.
const item = {
  kind: 'goods',
  name: '  Aashirvaad Atta ',
  hindiName: 'आशीर्वाद आटा',
  code: 'ATTA',
  categoryId: null,
  brand: 'Aashirvaad',
  stockUnit: 'kg',
  sellingPrice: 5_200,
  wholesalePrice: 4_900,
  purchasePrice: 4_500,
  mrp: 5_500,
  priceIncludesTax: true,
  gstRate: 500,
  hsn: '1101',
  packs: [] as unknown[],
  levels: [] as unknown[],
  barcodes: ['8901725181222'],
};

const pack = {
  id: null,
  unitCode: 'bag',
  unitId: null,
  size: 50_000,
  sellingPrice: 250_000,
  mrp: null,
  soldAsPack: true,
  boughtAsPack: true,
};

describe('GST_RATES (G1, 2026-11-19)', () => {
  it('are 0, 0.25, 3, 5, 18 and 40% in basis points', () => {
    expect(GST_RATES).toEqual([0, 25, 300, 500, 1800, 4000]);
  });
});

describe('newItemSchema', () => {
  it('trims a good item and keeps the rest as sent', () => {
    expect(newItemSchema.parse(item)).toEqual({ ...item, name: 'Aashirvaad Atta' });
  });

  it('turns blank optional text into null', () => {
    const parsed = newItemSchema.parse({ ...item, hindiName: ' ', code: '', brand: '', hsn: '' });
    expect(parsed).toMatchObject({ hindiName: null, code: null, brand: null, hsn: null });
  });

  it('allows the purchase price to be left out (a caller who may not see it)', () => {
    const withoutCost: Partial<typeof item> = { ...item };
    delete withoutCost.purchasePrice;
    expect(newItemSchema.parse(withoutCost)).not.toHaveProperty('purchasePrice');
  });

  it('keeps the zero-width joiner Hindi spelling needs', () => {
    const name = 'क्\u200dष';
    expect(newItemSchema.parse({ ...item, hindiName: name }).hindiName).toBe(name);
  });

  it.each([
    [{ name: '' }, { name: 'required' }],
    [{ name: 'x'.repeat(101) }, { name: 'too_long' }],
    [{ name: 'Atta\u0000' }, { name: 'control_character' }],
    [{ name: 'Atta\u202e' }, { name: 'control_character' }],
    [{ kind: 'gift' }, { kind: 'invalid' }],
    [{ kind: null }, { kind: 'choose' }],
    [{ stockUnit: 'crate' }, { stockUnit: 'invalid' }],
    [{ code: 'AT TA' }, { code: 'invalid' }],
    [{ code: 'x'.repeat(21) }, { code: 'too_long' }],
    [{ categoryId: 'not-a-uuid' }, { categoryId: 'invalid' }],
    [{ sellingPrice: -1 }, { sellingPrice: 'too_small' }],
    [{ sellingPrice: 10.5 }, { sellingPrice: 'invalid' }],
    [{ sellingPrice: '5200' }, { sellingPrice: 'invalid' }],
    [{ sellingPrice: 10_000_000_001 }, { sellingPrice: 'too_big' }],
    [{ mrp: 0 }, { mrp: 'too_small' }],
    [{ priceIncludesTax: 'yes' }, { priceIncludesTax: 'invalid' }],
    [{ gstRate: 1200 }, { gstRate: 'invalid' }],
    [{ gstRate: 2800 }, { gstRate: 'invalid' }],
    [{ hsn: '110' }, { hsn: 'invalid' }],
    [{ hsn: '11011' }, { hsn: 'invalid' }],
    [{ barcodes: ['12 34'] }, { 'barcodes.0': 'invalid' }],
    [{ barcodes: ['123'] }, { 'barcodes.0': 'invalid' }],
    [{ barcodes: ['12345', '12345'] }, { 'barcodes.1': 'duplicate' }],
    [{ colour: 'red' }, { colour: 'unknown_field' }],
  ])('refuses %j', (change, errors) => {
    expect(errorsOf(newItemSchema, { ...item, ...change })).toEqual(errors);
  });

  it.each([0, 25, 300, 500, 1800, 4000, null])('accepts GST rate %j', (gstRate) => {
    expect(errorsOf(newItemSchema, { ...item, gstRate })).toEqual({});
  });

  it.each(['1101', '110100', '11010000'])('accepts HSN %s for goods', (hsn) => {
    expect(errorsOf(newItemSchema, { ...item, hsn })).toEqual({});
  });

  describe('MRP (Module 01 #3; owner answer 2)', () => {
    it('allows a price equal to the MRP', () => {
      expect(errorsOf(newItemSchema, { ...item, sellingPrice: 5_500 })).toEqual({});
    });

    it('refuses a selling or wholesale price above it', () => {
      expect(
        errorsOf(newItemSchema, { ...item, sellingPrice: 5_501, wholesalePrice: 5_600 }),
      ).toEqual({ sellingPrice: 'above_mrp', wholesalePrice: 'above_mrp' });
    });

    it('needs a tax-inclusive price when there is an MRP', () => {
      expect(errorsOf(newItemSchema, { ...item, priceIncludesTax: false })).toEqual({
        priceIncludesTax: 'mrp_needs_inclusive_price',
      });
      expect(errorsOf(newItemSchema, { ...item, priceIncludesTax: false, mrp: null })).toEqual({});
    });
  });

  describe('a service (owner answer 7)', () => {
    const service = {
      ...item,
      kind: 'service',
      name: 'Screen repair',
      hindiName: null,
      mrp: null,
      hsn: '998719',
      barcodes: [],
    };

    it('takes a SAC code from 99', () => {
      expect(errorsOf(newItemSchema, service)).toEqual({});
      expect(errorsOf(newItemSchema, { ...service, hsn: '1101' })).toEqual({ hsn: 'invalid' });
      expect(errorsOf(newItemSchema, { ...item, hsn: '998719' })).toEqual({});
    });

    it('has no MRP, packs or low-stock levels', () => {
      expect(
        errorsOf(newItemSchema, {
          ...service,
          mrp: 100,
          packs: [pack],
          levels: [{ branchId: BRANCH_ID, lowStockLevel: 0 }],
        }),
      ).toEqual({ mrp: 'not_for_service', packs: 'not_for_service', levels: 'not_for_service' });
    });
  });

  describe('packs (Module 01 #2, #16)', () => {
    const withPacks = (...packs: unknown[]) => ({ ...item, packs });

    it('accepts a bag of 50 kg and an owner unit', () => {
      expect(
        errorsOf(
          newItemSchema,
          withPacks(pack, {
            ...pack,
            unitCode: null,
            unitId: UNIT_ID,
            size: 10_000,
            sellingPrice: null,
          }),
        ),
      ).toEqual({});
    });

    it('needs exactly one of a built-in unit and an owner unit', () => {
      expect(errorsOf(newItemSchema, withPacks({ ...pack, unitCode: null }))).toEqual({
        'packs.0.unitCode': 'choose',
      });
      expect(errorsOf(newItemSchema, withPacks({ ...pack, unitId: UNIT_ID }))).toEqual({
        'packs.0.unitCode': 'choose',
      });
    });

    it('refuses the same unit twice, or the stock unit itself', () => {
      expect(errorsOf(newItemSchema, withPacks(pack, pack))).toEqual({
        'packs.1.unitCode': 'duplicate',
      });
      expect(errorsOf(newItemSchema, withPacks({ ...pack, unitCode: 'kg' }))).toEqual({
        'packs.0.unitCode': 'same_as_stock_unit',
      });
    });

    it('holds a fixed unit to its size and refuses one of another kind', () => {
      const pieces = { ...item, stockUnit: 'piece', mrp: null };
      const dozen = { ...pack, unitCode: 'dozen', sellingPrice: null };
      expect(errorsOf(newItemSchema, { ...pieces, packs: [{ ...dozen, size: 12_000 }] })).toEqual(
        {},
      );
      expect(errorsOf(newItemSchema, { ...pieces, packs: [{ ...dozen, size: 10_000 }] })).toEqual({
        'packs.0.size': 'size_mismatch',
      });
      expect(errorsOf(newItemSchema, { ...pieces, packs: [{ ...dozen, unitCode: 'kg' }] })).toEqual(
        {
          'packs.0.unitCode': 'unit_mismatch',
        },
      );
    });

    it('refuses a size of 0', () => {
      expect(errorsOf(newItemSchema, withPacks({ ...pack, size: 0 }))).toEqual({
        'packs.0.size': 'too_small',
      });
    });

    it("keeps a pack's price under its own MRP or the item's MRP × size", () => {
      // 50 kg × ₹55 MRP = ₹2,750.
      expect(errorsOf(newItemSchema, withPacks({ ...pack, sellingPrice: 275_000 }))).toEqual({});
      expect(errorsOf(newItemSchema, withPacks({ ...pack, sellingPrice: 275_001 }))).toEqual({
        'packs.0.sellingPrice': 'above_mrp',
      });
      expect(
        errorsOf(newItemSchema, withPacks({ ...pack, sellingPrice: 260_000, mrp: 255_000 })),
      ).toEqual({ 'packs.0.sellingPrice': 'above_mrp' });
      // No own price: size × the item's price, checked against the pack's MRP.
      expect(
        errorsOf(newItemSchema, withPacks({ ...pack, sellingPrice: null, mrp: 259_999 })),
      ).toEqual({ 'packs.0.sellingPrice': 'above_mrp' });
    });

    it('needs a tax-inclusive price for a pack MRP', () => {
      expect(
        errorsOf(newItemSchema, {
          ...item,
          mrp: null,
          priceIncludesTax: false,
          packs: [{ ...pack, mrp: 300_000 }],
        }),
      ).toEqual({ 'packs.0.mrp': 'mrp_needs_inclusive_price' });
    });

    it('refuses two packs with the same id', () => {
      expect(
        errorsOf(
          newItemSchema,
          withPacks({ ...pack, id: PACK_ID }, { ...pack, id: PACK_ID, unitCode: 'box' }),
        ),
      ).toEqual({ 'packs.1.id': 'duplicate' });
    });
  });

  it('refuses two levels for one branch', () => {
    const level = { branchId: BRANCH_ID, lowStockLevel: 5_000 };
    expect(errorsOf(newItemSchema, { ...item, levels: [level, level] })).toEqual({
      'levels.1.branchId': 'duplicate',
    });
    expect(errorsOf(newItemSchema, { ...item, levels: [{ ...level, lowStockLevel: -1 }] })).toEqual(
      {
        'levels.0.lowStockLevel': 'too_small',
      },
    );
  });
});

describe('itemUpdateSchema', () => {
  const update: Partial<typeof item> & { version: number } = { ...item, version: 3 };
  delete update.barcodes;

  it('needs the version it was read at, and takes no barcodes', () => {
    expect(errorsOf(itemUpdateSchema, update)).toEqual({});
    expect(errorsOf(itemUpdateSchema, { ...update, version: 0 })).toEqual({ version: 'invalid' });
    expect(errorsOf(itemUpdateSchema, { ...update, barcodes: [] })).toEqual({
      barcodes: 'unknown_field',
    });
  });

  it('applies the same rules as a new item', () => {
    expect(errorsOf(itemUpdateSchema, { ...update, sellingPrice: 9_999 })).toEqual({
      sellingPrice: 'above_mrp',
    });
  });
});

describe('small schemas', () => {
  it('barcode', () => {
    expect(barcodeSchema.parse({ code: ' 8901725181222 ', packId: null })).toEqual({
      code: '8901725181222',
      packId: null,
    });
    // No code: the server makes the next in-store one.
    expect(barcodeSchema.parse({ code: null, packId: null })).toEqual({ code: null, packId: null });
    expect(errorsOf(barcodeSchema, { code: '', packId: null })).toEqual({ code: 'required' });
  });

  it('category', () => {
    expect(errorsOf(categorySchema, { name: '' })).toEqual({ name: 'required' });
  });

  it('own unit: not a built-in name, any case', () => {
    const crate = { name: 'Crate', hindiName: null, baseUnit: 'piece', defaultSize: 24_000 };
    expect(errorsOf(unitSchema, crate)).toEqual({});
    expect(errorsOf(unitSchema, { ...crate, name: 'Dozen' })).toEqual({ name: 'built_in' });
    expect(errorsOf(unitSchema, { ...crate, defaultSize: 0 })).toEqual({
      defaultSize: 'too_small',
    });
  });

  it('item query', () => {
    expect(itemQuerySchema.parse({ q: ' atta ', archived: 'true' })).toEqual({
      q: 'atta',
      archived: 'true',
    });
    expect(errorsOf(itemQuerySchema, { page: '2' })).toEqual({ page: 'unknown_field' });
  });
});

describe('packPrice: size × price per stock unit, half up', () => {
  it.each([
    [50_000, 5_200, 260_000], // 50 kg at ₹52
    [250, 5_200, 1_300], // 250 g at ₹52 a kg
    [333, 1_000, 333], // 0.333 × ₹10
    [1_500, 333, 500], // 1.5 × 333 = 499.5 → 500
    [1_500, 331, 497], // 496.5 → 497
  ])('%i thousandths × %i paise = %i', (size, price, expected) => {
    expect(packPrice(size, price)).toBe(expected);
  });
});

describe('in-store barcodes (Module 01 #8)', () => {
  it('computes EAN-13 check digits like published codes', () => {
    // GS1's textbook example, and a code with India's 890 prefix.
    expect(ean13CheckDigit('400638133393')).toBe('1');
    expect(ean13CheckDigit('890172518122')).toBe('2');
  });

  it('makes codes in the in-store range with a valid check digit', () => {
    expect(inStoreBarcode(1)).toBe('2000000000015');
    expect(inStoreBarcode(99_999_999_999)).toMatch(/^299999999999\d$/);
    expect(() => inStoreBarcode(0)).toThrow(RangeError);
    expect(() => inStoreBarcode(100_000_000_000)).toThrow(RangeError);
  });

  it('reads the serial back only from its own codes', () => {
    expect(inStoreSerial(inStoreBarcode(42))).toBe(42);
    expect(inStoreSerial('2000000000016')).toBeNull(); // wrong check digit
    expect(inStoreSerial('8901725181222')).toBeNull(); // a manufacturer's code
    expect(inStoreSerial('2000000000008')).toBeNull(); // serial 0
  });
});
