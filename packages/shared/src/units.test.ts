import { describe, expect, it } from 'vitest';
import { BUILT_IN_UNITS, isBuiltInUnit, packSizeFor, toStockQuantity } from './units.js';

describe('built-in units (Module 01 #16)', () => {
  it('are the twelve the owner chose, in order', () => {
    expect(BUILT_IN_UNITS).toEqual([
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
    ]);
  });

  it('knows what is built in', () => {
    expect(isBuiltInUnit('kg')).toBe(true);
    expect(isBuiltInUnit('crate')).toBe(false);
    expect(isBuiltInUnit('toString')).toBe(false);
  });
});

describe('toStockQuantity: a quantity in another unit as thousandths of the stock unit', () => {
  it.each([
    // 250 g of atta kept in kg is 0.250 kg.
    [250_000, 'g', 'kg', 250],
    [1_000, 'kg', 'g', 1_000_000],
    [500_000, 'ml', 'litre', 500],
    [2_000, 'litre', 'ml', 2_000_000],
    [1_000, 'dozen', 'piece', 12_000],
    [3_000, 'pair', 'piece', 6_000],
    [6_000, 'piece', 'dozen', 500],
    [1_500, 'kg', 'kg', 1_500],
  ] as const)('%i thousandths of %s in %s → %i', (quantity, from, to, expected) => {
    expect(toStockQuantity(quantity, from, to)).toBe(expected);
  });

  it.each([
    ['g', 'piece'], // different things
    ['metre', 'foot'], // no exact conversion
    ['box', 'piece'], // a box's size belongs to each item
    ['piece', 'box'],
    ['kg', 'litre'],
  ] as const)('refuses %s → %s', (from, to) => {
    expect(toStockQuantity(1_000, from, to)).toBeNull();
  });

  it('refuses a result that is not a whole number of thousandths', () => {
    // 1 g is 0.001 kg, but 0.5 g is 0.0005 kg.
    expect(toStockQuantity(1_000, 'g', 'kg')).toBe(1);
    expect(toStockQuantity(500, 'g', 'kg')).toBeNull();
    // 1 piece is a twelfth of a dozen.
    expect(toStockQuantity(1_000, 'piece', 'dozen')).toBeNull();
  });

  it('refuses a quantity that is not a positive safe whole number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
      expect(toStockQuantity(bad, 'kg', 'g')).toBeNull();
    }
  });
});

describe('packSizeFor: the fixed size of a built-in pack unit, if it has one', () => {
  it('is the fixed conversion between units of one kind', () => {
    expect(packSizeFor('dozen', 'piece')).toBe(12_000);
    expect(packSizeFor('kg', 'g')).toBe(1_000_000);
  });

  it('is free for box, pack and bag', () => {
    expect(packSizeFor('box', 'piece')).toBe('free');
    expect(packSizeFor('bag', 'kg')).toBe('free');
  });

  it('is impossible between units of different kinds, or in a smaller unit', () => {
    expect(packSizeFor('kg', 'piece')).toBe('impossible');
    expect(packSizeFor('foot', 'metre')).toBe('impossible');
    // A size is whole thousandths of the stock unit: 1 g of a kg item is 1, but a piece is a
    // twelfth of a dozen, which isn't.
    expect(packSizeFor('g', 'kg')).toBe(1);
    expect(packSizeFor('piece', 'dozen')).toBe('impossible');
  });
});
