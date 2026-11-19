// Units (Module 01 #2, #16; ADR 0008). The twelve built-in units are constants, not rows, so
// every business has exactly the same ones. Quantities are whole thousandths of a unit
// (0.250 kg → 250); an item counts its stock, prices and levels in one built-in `stock unit`.

export const BUILT_IN_UNITS = [
  'kg',
  'g',
  'litre',
  'ml',
  'piece',
  'box',
  'dozen',
  'pack',
  'bag',
  'metre',
  'foot',
  'pair',
] as const;
export type BuiltInUnit = (typeof BUILT_IN_UNITS)[number];

/**
 * What each unit measures and how many thousandths of that kind's base unit it is. Metre and
 * foot are kinds of their own: 0.3048 m isn't a whole number of thousandths, and nobody sells
 * one length in the other. Box, pack and bag have no fixed size: each item says what its box
 * holds.
 */
const UNIT_SIZES: Record<BuiltInUnit, { kind: string; base: number | null }> = {
  g: { kind: 'mass', base: 1_000 },
  kg: { kind: 'mass', base: 1_000_000 },
  ml: { kind: 'volume', base: 1_000 },
  litre: { kind: 'volume', base: 1_000_000 },
  piece: { kind: 'count', base: 1_000 },
  pair: { kind: 'count', base: 2_000 },
  dozen: { kind: 'count', base: 12_000 },
  metre: { kind: 'metre', base: 1_000 },
  foot: { kind: 'foot', base: 1_000 },
  box: { kind: 'pack', base: null },
  pack: { kind: 'pack', base: null },
  bag: { kind: 'pack', base: null },
};

export function isBuiltInUnit(value: unknown): value is BuiltInUnit {
  return typeof value === 'string' && (BUILT_IN_UNITS as readonly string[]).includes(value);
}

/**
 * How many thousandths of `to` one whole `from` is, when both are the same kind with fixed
 * sizes and the answer is a whole number; otherwise null.
 */
function thousandthsPerUnit(from: BuiltInUnit, to: BuiltInUnit): number | null {
  const a = UNIT_SIZES[from];
  const b = UNIT_SIZES[to];
  if (a.kind !== b.kind || a.base === null || b.base === null) return null;
  const size = (a.base * 1_000) / b.base;
  return Number.isInteger(size) && size >= 1 ? size : null;
}

/**
 * A quantity in `from` (thousandths) as thousandths of the stock unit `to`: 250 000 thousandths
 * of a g (250 g) is 250 thousandths of a kg. Null when the units don't convert, or the answer
 * isn't whole thousandths (0.5 g in kg), so a sale can never round stock.
 */
export function toStockQuantity(
  quantity: number,
  from: BuiltInUnit,
  to: BuiltInUnit,
): number | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
  if (from === to) return quantity;
  const a = UNIT_SIZES[from];
  const b = UNIT_SIZES[to];
  if (a.kind !== b.kind || a.base === null || b.base === null) return null;
  const numerator = BigInt(quantity) * BigInt(a.base);
  const denominator = BigInt(b.base);
  if (numerator % denominator !== 0n) return null;
  const result = Number(numerator / denominator);
  return Number.isSafeInteger(result) ? result : null;
}

/**
 * The size, in thousandths of the stock unit, that a built-in unit must have as a pack of an
 * item: a fixed number (a dozen of a piece item is 12 000), `free` for box, pack and bag, or
 * `impossible` (a kg of a piece item).
 */
export function packSizeFor(
  pack: BuiltInUnit,
  stockUnit: BuiltInUnit,
): number | 'free' | 'impossible' {
  if (UNIT_SIZES[pack].base === null) return 'free';
  return thousandthsPerUnit(pack, stockUnit) ?? 'impossible';
}
