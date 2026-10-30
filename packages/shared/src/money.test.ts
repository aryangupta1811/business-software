import { describe, expect, it } from 'vitest';
import { parseRupees } from './money.js';

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
