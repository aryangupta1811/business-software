import type { ItemsContext, ItemView } from '@business-software/shared';
import { describe, expect, test } from 'vitest';
import {
  emptyItemForm,
  fixedPackSize,
  formatQuantity,
  itemBody,
  itemFormFrom,
  itemResolver,
  margin,
  parseQuantity,
  priceWithTax,
  rupeesText,
  type ItemForm,
} from './item-form';

const BRANCH = '0b6f6f3e-3a3b-4c4d-8e8f-000000000001';
const PACK = '0b6f6f3e-3a3b-4c4d-8e8f-000000000002';

const context: ItemsContext = {
  canViewCost: true,
  canManage: true,
  needsGst: true,
  features: ['multiple_units'],
  branches: [{ id: BRANCH, name: 'Main' }],
};

const atta: ItemView = {
  id: '0b6f6f3e-3a3b-4c4d-8e8f-000000000003',
  kind: 'goods',
  name: 'Aashirvaad Atta',
  hindiName: 'आशीर्वाद आटा',
  code: 'ATTA',
  categoryId: null,
  brand: 'Aashirvaad',
  stockUnit: 'kg',
  sellingPrice: 5_200,
  wholesalePrice: null,
  purchasePrice: 4_500,
  mrp: 5_500,
  priceIncludesTax: true,
  gstRate: 500,
  hsn: '1101',
  archived: false,
  version: 3,
  packs: [
    {
      id: PACK,
      unitCode: 'bag',
      unitId: null,
      unitName: null,
      size: 50_000,
      sellingPrice: 250_000,
      mrp: null,
      soldAsPack: true,
      boughtAsPack: true,
    },
  ],
  barcodes: [],
  levels: [{ branchId: BRANCH, lowStockLevel: 12_500 }],
};

const filled = (overrides: Partial<ItemForm> = {}): ItemForm => ({
  ...itemFormFrom(atta, context),
  ...overrides,
});

/** Runs the resolver and returns `{ path: code }` for each error, flattened. */
async function errorsOf(form: ItemForm, ctx = context, version?: number) {
  const result = await itemResolver(ctx, version)(form, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  const flat: Record<string, string> = {};
  const walk = (node: unknown, path: string) => {
    if (typeof node !== 'object' || node === null) return;
    if ('message' in node && typeof node.message === 'string') {
      flat[path] = node.message;
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
  };
  walk(result.errors, '');
  return flat;
}

describe('quantities and rupees as typed', () => {
  test('reads a quantity to the thousandth, and nothing else', () => {
    expect(parseQuantity('12.5')).toBe(12_500);
    expect(parseQuantity(' 0.25 ')).toBe(250);
    expect(parseQuantity('3')).toBe(3_000);
    expect(parseQuantity('1.2345')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });

  test('shows thousandths and paise the way they would be typed', () => {
    expect(formatQuantity(12_500)).toBe('12.5');
    expect(formatQuantity(50_000)).toBe('50');
    expect(formatQuantity(250)).toBe('0.25');
    expect(rupeesText(5_200)).toBe('52.00');
    expect(rupeesText(5)).toBe('0.05');
    expect(rupeesText(null)).toBe('');
  });

  test('knows the fixed size of a pack in a unit that converts', () => {
    expect(fixedPackSize('b:dozen', 'piece')).toBe('12');
    expect(fixedPackSize('b:g', 'kg')).toBe('0.001');
    expect(fixedPackSize('b:box', 'piece')).toBeNull();
    expect(fixedPackSize(`u:${PACK}`, 'piece')).toBeNull();
  });
});

describe('the body sent to the API', () => {
  test('round-trips a saved item into the same update body', () => {
    expect(itemBody(itemFormFrom(atta, context), context, atta.version)).toEqual({
      kind: 'goods',
      name: 'Aashirvaad Atta',
      hindiName: 'आशीर्वाद आटा',
      code: 'ATTA',
      categoryId: null,
      brand: 'Aashirvaad',
      stockUnit: 'kg',
      sellingPrice: 5_200,
      wholesalePrice: null,
      purchasePrice: 4_500,
      mrp: 5_500,
      priceIncludesTax: true,
      gstRate: 500,
      hsn: '1101',
      packs: [
        {
          id: PACK,
          unitCode: 'bag',
          unitId: null,
          size: 50_000,
          sellingPrice: 250_000,
          mrp: null,
          soldAsPack: true,
          boughtAsPack: true,
        },
      ],
      levels: [{ branchId: BRANCH, lowStockLevel: 12_500 }],
      version: 3,
    });
  });

  test('leaves the purchase price out for a caller who may not see it', () => {
    const body = itemBody(filled(), { ...context, canViewCost: false }, 3);
    expect(body).not.toHaveProperty('purchasePrice');
  });

  test('a service sends no MRP, packs or levels', () => {
    const body = itemBody(filled({ kind: 'service' }), context, 3);
    expect(body).toMatchObject({ mrp: null, packs: [], levels: [] });
  });

  test('a new item sends its barcodes, blanks dropped, and no version', () => {
    const form = { ...emptyItemForm(context, '8901234567890'), name: 'Pen' };
    form.barcodes.push({ code: ' ' });
    const body = itemBody(form, context);
    expect(body.barcodes).toEqual(['8901234567890']);
    expect(body).not.toHaveProperty('version');
  });
});

describe('the form’s checks, the same as the API’s', () => {
  test('a saved item passes', async () => {
    expect(await errorsOf(filled(), context, 3)).toEqual({});
  });

  test('puts each field’s own code under it', async () => {
    expect(
      await errorsOf(filled({ name: '', wholesalePrice: 'abc', gstRate: '1200' }), context, 3),
    ).toEqual({ name: 'required', wholesalePrice: 'invalid', gstRate: 'invalid' });
  });

  // Rules across fields run once every field passes its own check, as on the API.
  test('puts each rule across fields under the field to fix', async () => {
    expect(
      await errorsOf(
        filled({ sellingPrice: '60', priceIncludesTax: false, hsn: '12' }),
        context,
        3,
      ),
    ).toEqual({
      sellingPrice: 'above_mrp',
      priceIncludesTax: 'mrp_needs_inclusive_price',
      hsn: 'invalid',
    });
  });

  test('a pack’s unit problems land on its unit picker, its size on its size', async () => {
    const pack = (unit: string, size: string) => ({ ...filled().packs[0]!, id: null, unit, size });
    expect(
      await errorsOf(
        filled({ packs: [pack('b:kg', '1'), pack('b:g', '5'), pack('b:piece', '1')] }),
        context,
        3,
      ),
    ).toMatchObject({
      'packs.0.unit': 'same_as_stock_unit',
      'packs.1.size': 'size_mismatch',
      'packs.2.unit': 'unit_mismatch',
    });
  });

  test('a blank selling price, GST rate and HSN are required for a regular business (G5)', async () => {
    const blank = { ...filled(), sellingPrice: '', gstRate: '', hsn: '' };
    expect(await errorsOf(blank, context, 3)).toMatchObject({
      sellingPrice: 'required',
      gstRate: 'required',
      hsn: 'required',
    });
    const unregistered = await errorsOf(blank, { ...context, needsGst: false }, 3);
    expect(unregistered).not.toHaveProperty('gstRate');
    expect(unregistered).not.toHaveProperty('hsn');
  });
});

describe('what the form shows as you type', () => {
  test('the price with and without GST, from the GST engine', () => {
    expect(priceWithTax({ sellingPrice: '118', gstRate: '1800', priceIncludesTax: true })).toEqual({
      taxable: 10_000,
      tax: 1_800,
      total: 11_800,
    });
    expect(priceWithTax({ sellingPrice: '100', gstRate: '500', priceIncludesTax: false })).toEqual({
      taxable: 10_000,
      tax: 500,
      total: 10_500,
    });
    expect(priceWithTax({ sellingPrice: '', gstRate: '500', priceIncludesTax: true })).toBeNull();
    expect(priceWithTax({ sellingPrice: '10', gstRate: '', priceIncludesTax: true })).toBeNull();
  });

  test('the margin on the selling price', () => {
    expect(margin({ sellingPrice: '52', purchasePrice: '45' })).toEqual({
      amount: 700,
      basisPoints: 1346,
    });
    expect(margin({ sellingPrice: '52', purchasePrice: '' })).toBeNull();
  });
});
