import { describe, expect, it } from 'vitest';
import { amount, formatDate, formatDateTime, formatQuantity, formatRate } from './format.js';

describe('formatQuantity', () => {
  it.each([
    [3_000, '3'],
    [2_500, '2.5'],
    [250, '0.25'],
    [1, '0.001'],
    [10_050, '10.05'],
    [0, '0'],
  ])('%i thousandths is %s', (thousandths, shown) => {
    expect(formatQuantity(thousandths)).toBe(shown);
  });
});

describe('formatRate', () => {
  it.each([
    [1_200, '12%'],
    [250, '2.5%'],
    [75, '0.75%'],
    [0, '0%'],
    [12_50, '12.5%'],
  ])('%i basis points is %s', (basisPoints, shown) => {
    expect(formatRate(basisPoints)).toBe(shown);
  });

  it('halves a rate into CGST and SGST without a floating-point tail', () => {
    expect(formatRate(1_800 / 2)).toBe('9%');
    expect(formatRate(150 / 2)).toBe('0.75%');
    expect(formatRate(25 / 2)).toBe('0.125%');
  });
});

describe('amount', () => {
  it('writes rupees with Indian grouping and no sign', () => {
    expect(amount(12_345_678)).toBe('1,23,456.78');
    expect(amount(5)).toBe('0.05');
    expect(amount(-12)).toBe('-0.12');
  });
});

describe('formatDate and formatDateTime', () => {
  it('writes a business date day first', () => {
    expect(formatDate('2026-11-23')).toBe('23-11-2026');
  });

  it('reads a moment as the clock in India shows it', () => {
    expect(formatDateTime('2026-11-23T08:35:00.000Z')).toEqual({
      date: '23-11-2026',
      time: '2:05 PM',
    });
  });

  it('moves to the next day past 18:30 UTC, and writes midnight and noon as 12', () => {
    expect(formatDateTime('2026-11-23T18:30:00.000Z')).toEqual({
      date: '24-11-2026',
      time: '12:00 AM',
    });
    expect(formatDateTime('2026-11-23T06:30:00.000Z')).toEqual({
      date: '23-11-2026',
      time: '12:00 PM',
    });
  });
});
