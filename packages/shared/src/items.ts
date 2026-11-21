// Items (Module 01 #1–3, #8, #16; design `docs/plans/2026-11-19-p1.7-items-design.md`). The
// forms and the API parse the same schemas (ADR 0036). Money is whole paise, rates basis points
// and quantities thousandths of the item's stock unit (ADR 0008).
import { z } from 'zod';
import type { Feature } from './business.js';
import { optionalText, text, uuid } from './fields.js';
import type { Paise } from './money.js';
import { BUILT_IN_UNITS, isBuiltInUnit, packSizeFor, type BuiltInUnit } from './units.js';

/**
 * Today's GST rates in basis points (owner's answer to G1, 2026-11-19): 0, 0.25 (rough
 * diamonds), 3 (gold, silver), 5, 18 and 40%. The 12% and 28% slabs ended on 22 September 2025
 * (GST 2.0). Checked against secondary sources only: confirm with CBIC's rate notifications
 * before the first real use. The engine itself accepts any rate (P1.12); items pick from here.
 */
export const GST_RATES = [0, 25, 300, 500, 1800, 4000] as const;
export type GstRate = (typeof GST_RATES)[number];

/** A service (repair charge, delivery fee) has no stock, MRP or packs, and a SAC code. */
export const ITEM_KINDS = ['goods', 'service'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** ₹10 crore: far above any one item's price, far below 2^53. */
const MAX_PAISE = 10_000_000_000;
/** A billion units: far above any stock, far below 2^53. */
const MAX_THOUSANDTHS = 1_000_000_000_000;

const paise = () =>
  z.int({ error: 'invalid' }).min(0, { error: 'too_small' }).max(MAX_PAISE, { error: 'too_big' });
const positivePaise = () =>
  z.int({ error: 'invalid' }).min(1, { error: 'too_small' }).max(MAX_PAISE, { error: 'too_big' });
const thousandths = (min: number) =>
  z
    .int({ error: 'invalid' })
    .min(min, { error: 'too_small' })
    .max(MAX_THOUSANDTHS, { error: 'too_big' });
// Nothing picked says `choose`; a value that isn't one of the options says `invalid`.
const choose = (issue: { input?: unknown }) =>
  issue.input === undefined || issue.input === null || issue.input === '' ? 'choose' : 'invalid';
const builtInUnit = () => z.enum(BUILT_IN_UNITS, { error: choose });

/** Goods: HSN 4, 6 or 8 digits (the GST engine's rule). Services: SAC, 6 digits from 99. */
const HSN = /^(?:\d{4}|\d{6}|\d{8})$/;
const SAC = /^99\d{4}$/;
/** What a scanner reads: printable ASCII, no spaces. */
const BARCODE = /^[!-~]{4,48}$/;
const SHORT_CODE = /^[!-~]{1,20}$/;

const optionalPattern = (max: number, pattern: RegExp) =>
  optionalText(max).refine((value) => value === null || pattern.test(value), {
    error: 'invalid',
  });

export const barcode = () =>
  z
    .string({ error: 'required' })
    .trim()
    .min(1, { error: 'required' })
    .regex(BARCODE, { error: 'invalid' });

/** A pack of an item (box = 12 piece, bag = 50 kg): a built-in unit or the owner's own. */
const packSchema = z.strictObject({
  /** The pack's id when it already exists; null for a new one. */
  id: uuid().nullable(),
  unitCode: builtInUnit().nullable(),
  unitId: uuid().nullable(),
  /** Thousandths of the item's stock unit in one pack. */
  size: thousandths(1),
  /** Null: size × the item's price. */
  sellingPrice: paise().nullable(),
  mrp: positivePaise().nullable(),
  soldAsPack: z.boolean({ error: 'invalid' }),
  boughtAsPack: z.boolean({ error: 'invalid' }),
});
export type PackInput = z.infer<typeof packSchema>;

const levelSchema = z.strictObject({
  branchId: uuid(),
  lowStockLevel: thousandths(0),
});

const itemShape = {
  kind: z.enum(ITEM_KINDS, { error: choose }),
  name: text(100),
  hindiName: optionalText(100),
  code: optionalPattern(20, SHORT_CODE),
  categoryId: uuid().nullable(),
  brand: optionalText(60),
  stockUnit: builtInUnit(),
  sellingPrice: paise(),
  wholesalePrice: paise().nullable(),
  /** Left out by callers without `items.view_cost`; the stored value is then kept. */
  purchasePrice: paise().nullable().optional(),
  mrp: positivePaise().nullable(),
  priceIncludesTax: z.boolean({ error: 'invalid' }),
  gstRate: z
    .int({ error: 'invalid' })
    .refine((rate) => (GST_RATES as readonly number[]).includes(rate), { error: 'invalid' })
    .nullable(),
  hsn: optionalText(8),
  packs: z.array(packSchema, { error: 'invalid' }).max(20, { error: 'too_many' }),
  levels: z.array(levelSchema, { error: 'invalid' }).max(100, { error: 'too_many' }),
};

type ItemFields = z.infer<z.ZodObject<typeof itemShape>>;

/** A pack's price from the item's price per stock unit: size × price, half up. */
export function packPrice(sizeThousandths: number, unitPricePaise: Paise): Paise {
  const product = BigInt(sizeThousandths) * BigInt(unitPricePaise);
  return Number((2n * product + 1000n) / 2000n);
}

function issue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: 'custom', path, message });
}

// Rules across fields. Zod runs this even when a field's own check failed, so each rule only
// compares values whose own checks passed.
function itemRules(value: ItemFields, context: z.RefinementCtx): void {
  const isGoods = value.kind === 'goods';
  // A value that passed its own check: a price 0..max, an MRP or a size from 1.
  const inRange = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
  const price = (n: unknown): n is number => inRange(n, 0, MAX_PAISE);
  const mrp = (n: unknown): n is number => inRange(n, 1, MAX_PAISE);
  const size = (n: unknown): n is number => inRange(n, 1, MAX_THOUSANDTHS);

  if (value.kind === 'service') {
    if (value.mrp !== null) issue(context, ['mrp'], 'not_for_service');
    if (value.packs.length > 0) issue(context, ['packs'], 'not_for_service');
    if (value.levels.length > 0) issue(context, ['levels'], 'not_for_service');
  }

  // Module 01 #3: never above MRP. MRP includes every tax by law, so an item with an MRP keeps a
  // tax-inclusive price and the comparison is exact (owner's answer 2, 2026-11-19).
  if (isGoods && mrp(value.mrp)) {
    if (!value.priceIncludesTax) issue(context, ['priceIncludesTax'], 'mrp_needs_inclusive_price');
    if (price(value.sellingPrice) && value.sellingPrice > value.mrp) {
      issue(context, ['sellingPrice'], 'above_mrp');
    }
    if (price(value.wholesalePrice) && value.wholesalePrice > value.mrp) {
      issue(context, ['wholesalePrice'], 'above_mrp');
    }
  }

  const kindKnown = (ITEM_KINDS as readonly string[]).includes(value.kind);
  if (kindKnown && typeof value.hsn === 'string' && !(isGoods ? HSN : SAC).test(value.hsn)) {
    issue(context, ['hsn'], 'invalid');
  }

  const units = new Set<string>();
  const packIds = new Set<string>();
  // A service's packs are refused above; their details aren't checked.
  if (isGoods)
    value.packs.forEach((pack, index) => {
      const at = (field: string) => ['packs', index, field];
      if ((pack.unitCode === null) === (pack.unitId === null))
        issue(context, at('unitCode'), 'choose');
      const unit = pack.unitCode ?? pack.unitId;
      if (unit !== null) {
        if (units.has(unit)) issue(context, at('unitCode'), 'duplicate');
        units.add(unit);
      }
      if (pack.id !== null) {
        if (packIds.has(pack.id)) issue(context, at('id'), 'duplicate');
        packIds.add(pack.id);
      }
      if (
        pack.unitCode !== null &&
        isBuiltInUnit(pack.unitCode) &&
        isBuiltInUnit(value.stockUnit)
      ) {
        if (pack.unitCode === value.stockUnit) {
          issue(context, at('unitCode'), 'same_as_stock_unit');
        } else {
          const fixed = packSizeFor(pack.unitCode, value.stockUnit);
          if (fixed === 'impossible') issue(context, at('unitCode'), 'unit_mismatch');
          else if (fixed !== 'free' && size(pack.size) && pack.size !== fixed) {
            issue(context, at('size'), 'size_mismatch');
          }
        }
      }
      if (pack.mrp !== null && !value.priceIncludesTax) {
        issue(context, at('mrp'), 'mrp_needs_inclusive_price');
      }
      if (!size(pack.size)) return;
      const packSelling =
        pack.sellingPrice ??
        (price(value.sellingPrice) ? packPrice(pack.size, value.sellingPrice) : null);
      const packMrp = pack.mrp ?? (mrp(value.mrp) ? packPrice(pack.size, value.mrp) : null);
      if (price(packSelling) && mrp(packMrp) && packSelling > packMrp) {
        issue(context, at('sellingPrice'), 'above_mrp');
      }
    });

  const branches = new Set<string>();
  value.levels.forEach((level, index) => {
    if (branches.has(level.branchId)) issue(context, ['levels', index, 'branchId'], 'duplicate');
    branches.add(level.branchId);
  });
}

/** `POST /api/items`: the item, its packs and levels, and barcodes for the stock unit. */
export const newItemSchema = z
  .strictObject({
    ...itemShape,
    barcodes: z.array(barcode(), { error: 'invalid' }).max(10, { error: 'too_many' }),
  })
  .superRefine((value, context) => {
    itemRules(value, context);
    const seen = new Set<string>();
    value.barcodes.forEach((code, index) => {
      if (seen.has(code)) issue(context, ['barcodes', index], 'duplicate');
      seen.add(code);
    });
  });
export type NewItemInput = z.infer<typeof newItemSchema>;

/** `PUT /api/items/:id`: the whole item with the version it was read at. */
export const itemUpdateSchema = z
  .strictObject({ ...itemShape, version: z.int({ error: 'invalid' }).min(1, { error: 'invalid' }) })
  .superRefine(itemRules);
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;

/**
 * `POST /api/items/:id/barcodes`: a code for the item's stock unit or one of its packs. A null
 * code asks the server to make the next in-store code (#8), so two counters can't get the same.
 */
export const barcodeSchema = z.strictObject({
  code: barcode().nullable(),
  packId: uuid().nullable(),
});
export type BarcodeInput = z.infer<typeof barcodeSchema>;

export const categorySchema = z.strictObject({ name: text(60) });
export type CategoryInput = z.infer<typeof categorySchema>;

/** The owner's own unit (#16): 1 crate = 24 piece. */
export const unitSchema = z.strictObject({
  name: text(30).refine((name) => !isBuiltInUnit(name.toLowerCase()), { error: 'built_in' }),
  hindiName: optionalText(30),
  baseUnit: builtInUnit(),
  /** Thousandths of the base unit; an item can change it for itself (owner's answer 3). */
  defaultSize: thousandths(1),
});
export type UnitInput = z.infer<typeof unitSchema>;

/** The item list's filters (`GET /api/items`). */
export const itemQuerySchema = z.strictObject({
  q: optionalText(100).optional(),
  category: uuid().optional(),
  archived: z.enum(['true', 'false'], { error: 'invalid' }).optional(),
  /** Only items at or below their low-stock level at the caller's branch (P1.8). */
  low: z.enum(['true', 'false'], { error: 'invalid' }).optional(),
  after: z.string().max(400, { error: 'too_long' }).optional(),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

// ---- Barcodes made in the shop (#8) ----

/** The EAN-13 check digit for the first 12 digits (weights 1 and 3 alternately). */
export function ean13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new RangeError(`Not 12 digits: ${JSON.stringify(first12)}`);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12.charAt(i)) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/** An in-store code: EAN-13 starting with 2 (GS1's in-store range), a serial and a check digit. */
export function inStoreBarcode(serial: number): string {
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > 99_999_999_999) {
    throw new RangeError(`In-store serial out of range: ${String(serial)}`);
  }
  const first12 = `2${String(serial).padStart(11, '0')}`;
  return first12 + ean13CheckDigit(first12);
}

/** The serial of a code `inStoreBarcode` made, or null for any other code. */
export function inStoreSerial(code: string): number | null {
  if (!/^2\d{12}$/.test(code) || ean13CheckDigit(code.slice(0, 12)) !== code.charAt(12)) {
    return null;
  }
  const serial = Number(code.slice(1, 12));
  return serial >= 1 ? serial : null;
}

// ---- What the API answers ----

export interface PackView {
  id: string;
  unitCode: BuiltInUnit | null;
  unitId: string | null;
  /** The owner's unit's name, for a pack in one of the owner's units. */
  unitName: string | null;
  size: number;
  sellingPrice: Paise | null;
  mrp: Paise | null;
  soldAsPack: boolean;
  boughtAsPack: boolean;
}

export interface BarcodeView {
  id: string;
  code: string;
  packId: string | null;
  inStore: boolean;
}

export interface LevelView {
  branchId: string;
  lowStockLevel: number;
}

export interface ItemView {
  id: string;
  kind: ItemKind;
  name: string;
  hindiName: string | null;
  code: string | null;
  categoryId: string | null;
  brand: string | null;
  stockUnit: BuiltInUnit;
  sellingPrice: Paise;
  wholesalePrice: Paise | null;
  /** Absent, not null, for a caller without `items.view_cost`. */
  purchasePrice?: Paise | null;
  mrp: Paise | null;
  priceIncludesTax: boolean;
  gstRate: number | null;
  hsn: string | null;
  archived: boolean;
  version: number;
  packs: PackView[];
  barcodes: BarcodeView[];
  levels: LevelView[];
}

export interface ItemRow {
  id: string;
  kind: ItemKind;
  name: string;
  hindiName: string | null;
  code: string | null;
  categoryId: string | null;
  brand: string | null;
  stockUnit: BuiltInUnit;
  sellingPrice: Paise;
  /** Absent for a caller without `items.view_cost`. */
  purchasePrice?: Paise | null;
  mrp: Paise | null;
  gstRate: number | null;
  archived: boolean;
  /** Stock at the caller's branch (P1.8); absent for a caller without `stock.view`. */
  stock?: number;
  /** At or below the branch's low-stock level (Module 07 #4); absent with `stock`. */
  low?: boolean;
}

export interface ItemPage {
  items: ItemRow[];
  /** Pass as `after` for the next page; null on the last one. */
  next: string | null;
}

export interface BarcodeMatch {
  item: ItemView;
  /** The pack the code belongs to, or null for the stock unit. */
  packId: string | null;
}

export interface CategoryView {
  id: string;
  name: string;
  archived: boolean;
}

/**
 * What the Items page needs to know before it shows a form (`GET /api/items/context`). Until
 * P1.5 gives the web the caller's permissions, this is where the page learns them.
 */
export interface ItemsContext {
  /** `items.view_cost`: the purchase price column and field show. */
  canViewCost: boolean;
  /** `items.manage`: the add, edit, archive and barcode controls show. */
  canManage: boolean;
  /** `stock.view`: the stock column, the low-stock filter and the item's stock card show (P1.8). */
  canViewStock: boolean;
  /** `stock.adjust`: opening stock and adjustments can be made (Module 01 #11). */
  canAdjustStock: boolean;
  /** The caller's branch: where opening stock and adjustments land. */
  branchId: string;
  /** A regular GST business: every item needs a GST rate and an HSN code (G5). */
  needsGst: boolean;
  /** Switched-on features: `multiple_units` shows packs, `wholesale_price` the wholesale price. */
  features: Feature[];
  /** The branches a low-stock level can be set for. */
  branches: { id: string; name: string }[];
}

export interface UnitView {
  id: string;
  name: string;
  hindiName: string | null;
  baseUnit: BuiltInUnit;
  defaultSize: number;
  archived: boolean;
}
