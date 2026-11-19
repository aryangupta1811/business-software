// The item form's values and the API body they become (design §7). Inputs hold text, so money
// is typed in rupees and quantities in the stock unit; the shared schema then checks the body
// exactly as the API will (ADR 0036), and its error codes land under the field they're about.
import {
  calculateBill,
  isBuiltInUnit,
  itemUpdateSchema,
  newItemSchema,
  packSizeFor,
  parseRupees,
  type ItemKind,
  type ItemsContext,
  type ItemView,
  type Paise,
} from '@business-software/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

export interface PackForm {
  id: string | null;
  /** `b:box` for a built-in unit, `u:<id>` for the owner's own, '' while unpicked. */
  unit: string;
  /** How many stock units one pack holds, typed ("12", "0.5"). */
  size: string;
  sellingPrice: string;
  mrp: string;
  soldAsPack: boolean;
  boughtAsPack: boolean;
}

export interface ItemForm {
  kind: ItemKind;
  name: string;
  hindiName: string;
  code: string;
  categoryId: string;
  brand: string;
  stockUnit: string;
  sellingPrice: string;
  wholesalePrice: string;
  purchasePrice: string;
  mrp: string;
  priceIncludesTax: boolean;
  gstRate: string;
  hsn: string;
  packs: PackForm[];
  /** One per branch, in the context's branch order. */
  levels: { branchId: string; level: string }[];
  /** New items only: codes saved with the item. Later ones are added one by one. */
  barcodes: { code: string }[];
}

const QUANTITY = /^(\d*)(?:\.(\d{0,3}))?$/;

/** "12.5" in the stock unit → 12500 thousandths; null for anything that isn't plainly a number. */
export function parseQuantity(input: string): number | null {
  const match = QUANTITY.exec(input.trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;
  const amount = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

/** 12500 → "12.5": thousandths as the quantity a person types. */
export function formatQuantity(thousandths: number): string {
  const whole = Math.trunc(thousandths / 1000);
  const fraction = String(thousandths % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

/** 12550 paise → "125.50", as typed into a rupee field. */
export function rupeesText(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  const digits = String(paise).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** The fixed number of stock units in a pack (12 for dozen → piece), as text; null if free. */
export function fixedPackSize(unit: string, stockUnit: string): string | null {
  const code = unit.startsWith('b:') ? unit.slice(2) : null;
  if (code === null || !isBuiltInUnit(code) || !isBuiltInUnit(stockUnit)) return null;
  const size = packSizeFor(code, stockUnit);
  return typeof size === 'number' ? formatQuantity(size) : null;
}

export function emptyItemForm(context: ItemsContext, barcode?: string): ItemForm {
  return {
    kind: 'goods',
    name: '',
    hindiName: '',
    code: '',
    categoryId: '',
    brand: '',
    stockUnit: 'piece',
    sellingPrice: '',
    wholesalePrice: '',
    purchasePrice: '',
    mrp: '',
    priceIncludesTax: true,
    gstRate: '',
    hsn: '',
    packs: [],
    levels: context.branches.map(({ id }) => ({ branchId: id, level: '' })),
    barcodes: barcode === undefined ? [] : [{ code: barcode }],
  };
}

export function itemFormFrom(item: ItemView, context: ItemsContext): ItemForm {
  const level = (branchId: string) =>
    item.levels.find((row) => row.branchId === branchId)?.lowStockLevel ?? 0;
  return {
    kind: item.kind,
    name: item.name,
    hindiName: item.hindiName ?? '',
    code: item.code ?? '',
    categoryId: item.categoryId ?? '',
    brand: item.brand ?? '',
    stockUnit: item.stockUnit,
    sellingPrice: rupeesText(item.sellingPrice),
    wholesalePrice: rupeesText(item.wholesalePrice),
    purchasePrice: rupeesText(item.purchasePrice),
    mrp: rupeesText(item.mrp),
    priceIncludesTax: item.priceIncludesTax,
    gstRate: item.gstRate === null ? '' : String(item.gstRate),
    hsn: item.hsn ?? '',
    packs: item.packs.map((pack) => ({
      id: pack.id,
      unit: pack.unitCode === null ? `u:${pack.unitId ?? ''}` : `b:${pack.unitCode}`,
      size: formatQuantity(pack.size),
      sellingPrice: rupeesText(pack.sellingPrice),
      mrp: rupeesText(pack.mrp),
      soldAsPack: pack.soldAsPack,
      boughtAsPack: pack.boughtAsPack,
    })),
    levels: context.branches.map(({ id }) => ({
      branchId: id,
      level: level(id) === 0 ? '' : formatQuantity(level(id)),
    })),
    barcodes: [],
  };
}

// A blank optional field is null. Text that isn't a number goes through as it was typed, so
// the schema answers `invalid` for it rather than the form guessing.
const text = (value: string) => (value.trim() === '' ? null : value);
const money = (value: string) => (value.trim() === '' ? null : (parseRupees(value) ?? value));
const quantity = (value: string) => (value.trim() === '' ? null : (parseQuantity(value) ?? value));

/**
 * The body for `POST /api/items` (no `version`) or `PUT /api/items/:id`. A service sends no
 * MRP, packs or levels (so saving one archives its old packs); the purchase price is left out
 * for a caller who may not see it, so the stored one is kept.
 */
export function itemBody(
  form: ItemForm,
  context: ItemsContext,
  version?: number,
): Record<string, unknown> {
  const goods = form.kind === 'goods';
  return {
    kind: form.kind,
    name: form.name,
    hindiName: text(form.hindiName),
    code: text(form.code),
    categoryId: text(form.categoryId),
    brand: text(form.brand),
    stockUnit: form.stockUnit,
    sellingPrice: money(form.sellingPrice),
    wholesalePrice: money(form.wholesalePrice),
    ...(context.canViewCost && { purchasePrice: money(form.purchasePrice) }),
    mrp: goods ? money(form.mrp) : null,
    priceIncludesTax: form.priceIncludesTax,
    gstRate: form.gstRate === '' ? null : Number(form.gstRate),
    hsn: text(form.hsn),
    packs: goods
      ? form.packs.map((pack) => ({
          id: pack.id,
          unitCode: pack.unit.startsWith('b:') ? pack.unit.slice(2) : null,
          unitId: pack.unit.startsWith('u:') ? pack.unit.slice(2) : null,
          size: quantity(pack.size),
          sellingPrice: money(pack.sellingPrice),
          mrp: money(pack.mrp),
          soldAsPack: pack.soldAsPack,
          boughtAsPack: pack.boughtAsPack,
        }))
      : [],
    // Every branch is sent; a blank level is 0 (no alert), which is what leaving it out means.
    levels: goods
      ? form.levels.map(({ branchId, level }) => ({
          branchId,
          lowStockLevel: quantity(level) ?? 0,
        }))
      : [],
    ...(version === undefined
      ? { barcodes: form.barcodes.map(({ code }) => code.trim()).filter((code) => code !== '') }
      : { version }),
  };
}

/** Where a body's error belongs on the form: a pack's unit id and unit code are one picker. */
function formPath(path: readonly PropertyKey[]): string {
  const parts = path.map(String);
  if (parts[0] === 'packs' && ['unitCode', 'unitId', 'id'].includes(parts[2] ?? '')) {
    parts[2] = 'unit';
  }
  if (parts[0] === 'levels' && parts[2] === 'lowStockLevel') parts[2] = 'level';
  if (parts[0] === 'barcodes' && parts.length === 2) parts.push('code');
  return parts.join('.');
}

/** Puts `{ message: code }` at a dotted path in React Hook Form's nested errors. */
function place(errors: Record<string, unknown>, path: string, code: string): void {
  const keys = path.split('.');
  let node = errors;
  keys.slice(0, -1).forEach((key) => {
    node[key] ??= {};
    node = node[key] as Record<string, unknown>;
  });
  const last = keys.at(-1) ?? '';
  node[last] ??= { type: 'server', message: code };
}

/** Shows codes the API answered (or the schema found) under their fields; first one wins. */
export function fieldErrors(codes: Record<string, string>): FieldErrors<ItemForm> {
  const errors: Record<string, unknown> = {};
  for (const [path, code] of Object.entries(codes)) place(errors, path, code);
  return errors as FieldErrors<ItemForm>;
}

/**
 * The form's resolver: builds the body and checks it with the API's own schema. A blank
 * selling price says `required`, and a regular GST business also needs a rate and an HSN (G5).
 */
export function itemResolver(
  context: ItemsContext,
  version?: number,
): Resolver<ItemForm, unknown, Record<string, unknown>> {
  return (form) => {
    const body = itemBody(form, context, version);
    const schema = version === undefined ? newItemSchema : itemUpdateSchema;
    const result = schema.safeParse(body);
    const codes: Record<string, string> = {};
    if (form.sellingPrice.trim() === '') codes.sellingPrice = 'required';
    if (context.needsGst && form.gstRate === '') codes.gstRate = 'required';
    if (context.needsGst && form.hsn.trim() === '') codes.hsn = 'required';
    for (const issue of result.error?.issues ?? []) {
      const path = formPath(issue.path);
      codes[path] ??= issue.message;
    }
    if (Object.keys(codes).length === 0) return { values: body, errors: {} };
    return { values: {}, errors: fieldErrors(codes) };
  };
}

/** The selling price with and without GST, for one stock unit, from the GST engine. */
export function priceWithTax(
  form: Pick<ItemForm, 'sellingPrice' | 'gstRate' | 'priceIncludesTax'>,
): { taxable: Paise; tax: Paise; total: Paise } | null {
  const price = parseRupees(form.sellingPrice);
  if (price === null || form.gstRate === '') return null;
  // The engine refuses amounts past its limits; while someone is still typing, show nothing.
  let bill;
  try {
    bill = calculateBill({
      scheme: 'regular',
      supplierStateCode: '07',
      placeOfSupplyStateCode: '07',
      lines: [
        {
          unitPricePaise: price,
          quantityThousandths: 1000,
          rateBasisPoints: Number(form.gstRate),
          priceIncludesTax: form.priceIncludesTax,
          hsn: '0000',
        },
      ],
    });
  } catch {
    return null;
  }
  return {
    taxable: bill.taxablePaise,
    tax: bill.totalPaise - bill.taxablePaise,
    total: bill.totalPaise,
  };
}

/** Selling price less purchase price, and that as a share of the selling price (basis points). */
export function margin(
  form: Pick<ItemForm, 'sellingPrice' | 'purchasePrice'>,
): { amount: Paise; basisPoints: number } | null {
  const selling = parseRupees(form.sellingPrice);
  const cost = parseRupees(form.purchasePrice);
  if (selling === null || cost === null || selling === 0) return null;
  const amount = selling - cost;
  return { amount, basisPoints: Math.round((amount * 10_000) / selling) };
}
