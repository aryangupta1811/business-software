import { describe, expect, it } from 'vitest';
import { formatPaise, parseRupees } from './money.js';

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
    [-0, '₹0.00'],
  ])('shows %i paise as %s', (paise, text) => {
    expect(formatPaise(paise)).toBe(text);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('throws for %d', (paise) => {
    expect(() => formatPaise(paise)).toThrow(RangeError);
  });
});
