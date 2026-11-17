import { describe, expect, it } from 'vitest';
import { allocatePaise, formatPaise, parseRupees } from './money.js';

describe('parseRupees', () => {
  it.each([
    ['125', 12500],
    ['125.5', 12550],
    ['125.50', 12550],
    ['0.05', 5],
    ['0', 0],
    ['007', 700],
    ['.5', 50],
    ['125.', 12500],
    [' 125.50 ', 12550],
    ['\t125\n', 12500], // pasted from a spreadsheet cell
    // Floating-point traps: 0.29 * 100 = 28.999999999999996 and 1.1 * 100 = 110.00000000000001
    ['0.29', 29],
    ['1.1', 110],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('reads %j as %i paise', (input, paise) => {
    expect(parseRupees(input)).toBe(paise);
  });

  it.each([
    '',
    '   ',
    '.',
    '1.005',
    '12.555',
    '12.500',
    '-5',
    '+5',
    '1,250',
    '₹125',
    '12 .5',
    '1e3',
    'abc',
    '0x10',
    'Infinity',
    'NaN',
    '१२५',
    '90071992547409.92',
  ])('refuses %j', (input) => {
    expect(parseRupees(input)).toBeNull();
  });
});

describe('formatPaise', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [12550, '₹125.50'],
    [12345678, '₹1,23,456.78'],
    [98765432100, '₹98,76,54,321.00'],
    [Number.MAX_SAFE_INTEGER, '₹9,00,71,99,25,47,409.91'],
    [-125000, '-₹1,250.00'],
    [-5, '-₹0.05'], // the sign must not end up inside the zero-padding
    [-0, '₹0.00'],
  ])('shows %i paise as %s', (paise, text) => {
    expect(formatPaise(paise)).toBe(text);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('throws for %d', (paise) => {
    expect(() => formatPaise(paise)).toThrow(RangeError);
  });

  it('says why it refuses an amount past the safe range', () => {
    expect(() => formatPaise(2 ** 53)).toThrow(
      'Not a safe whole number of paise: 9007199254740992',
    );
  });
});

describe('allocatePaise', () => {
  it.each<[number, number[], number[]]>([
    [100, [1, 1], [50, 50]],
    [100, [1, 1, 1], [34, 33, 33]], // the leftover paisa goes to the earliest of the tied lines
    [1, [5, 5, 5], [1, 0, 0]],
    [2, [1, 1, 1], [1, 1, 0]],
    [10, [3, 7], [3, 7]],
    [10, [1, 2], [3, 7]], // 3.33 and 6.67: the larger remainder (0.67) takes the leftover
    [7, [0, 5, 0, 5], [0, 4, 0, 3]],
    [0, [3, 4], [0, 0]],
    [0, [0, 0], [0, 0]],
    [0, [], []],
    [5000, [10000, 20000, 70000], [500, 1000, 3500]],
    [999, [1, 1000000], [0, 999]],
  ])('shares %i paise by %j as %j', (total, weights, shares) => {
    expect(allocatePaise(total, weights)).toEqual(shares);
  });

  it('always hands out exactly the total', () => {
    const weights = [1, 2, 3, 5, 8, 13, 21];
    for (let total = 0; total <= 500; total += 1) {
      const shares = allocatePaise(total, weights);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
    }
  });

  it('stays exact when total × weight is far past the safe range', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(allocatePaise(big, [big, big])).toEqual([4503599627370496, 4503599627370495]);
  });

  it('throws when there is something to share but nothing to share it by', () => {
    expect(() => allocatePaise(1, [0, 0])).toThrow(RangeError);
    expect(() => allocatePaise(1, [])).toThrow(RangeError);
  });

  it.each<[number, number[]]>([
    [-1, [1]],
    [1.5, [1]],
    [2 ** 53, [1]],
    [1, [-1, 2]],
    [1, [0.5]],
    [1, [Number.NaN]],
  ])('throws for a total of %d with weights %j', (total, weights) => {
    expect(() => allocatePaise(total, weights)).toThrow(RangeError);
  });
});
