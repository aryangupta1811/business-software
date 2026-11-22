import { describe, expect, it } from 'vitest';
import {
  INVOICE_NUMBER_MAX_LENGTH,
  INVOICE_PREFIX_PATTERN,
  documentFor,
  financialYear,
  invoiceLabel,
  invoiceNumber,
  needsBuyerDetails,
  stockQuantity,
} from './invoice.js';

describe('financialYear', () => {
  it('runs April to March', () => {
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYear('2026-01-15')).toBe('2025-26');
  });

  it('writes the century turn as two digits', () => {
    expect(financialYear('2099-12-31')).toBe('2099-00');
  });

  it('refuses anything that is not a date', () => {
    expect(() => financialYear('2026-13-01')).toThrow(RangeError);
    expect(() => financialYear('26-04-01')).toThrow(RangeError);
  });
});

describe('invoiceLabel (00 #61)', () => {
  it("is the business's prefix with one branch", () => {
    expect(invoiceLabel({ prefix: 'ABC', branchCode: 'HO', branchCount: 1 })).toBe('ABC');
    expect(invoiceLabel({ prefix: null, branchCode: 'HO', branchCount: 1 })).toBeNull();
  });

  it("is the branch's code with two or more", () => {
    expect(invoiceLabel({ prefix: 'ABC', branchCode: 'AND', branchCount: 2 })).toBe('AND');
  });
});

describe('invoiceNumber (00 #61, CGST Rule 46(b))', () => {
  it('is label, short year and the number, with no padding', () => {
    expect(invoiceNumber({ label: 'ABC', financialYear: '2026-27', sequence: 42 })).toBe(
      'ABC/26-27/42',
    );
    expect(invoiceNumber({ label: null, financialYear: '2026-27', sequence: 1 })).toBe('26-27/1');
  });

  it('fits 16 characters with a 4-character label up to 99,999', () => {
    const longest = invoiceNumber({ label: 'ABCD', financialYear: '2026-27', sequence: 99_999 });
    expect(longest).toBe('ABCD/26-27/99999');
    expect(longest).toHaveLength(INVOICE_NUMBER_MAX_LENGTH);
  });

  it('refuses a number longer than the law allows', () => {
    expect(() =>
      invoiceNumber({ label: 'ABCD', financialYear: '2026-27', sequence: 100_000 }),
    ).toThrow(RangeError);
  });

  it('refuses a label or sequence that could not have come from the rules', () => {
    expect(() => invoiceNumber({ label: 'AB/C', financialYear: '2026-27', sequence: 1 })).toThrow(
      RangeError,
    );
    expect(() => invoiceNumber({ label: 'ABC', financialYear: '2026-27', sequence: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('INVOICE_PREFIX_PATTERN', () => {
  it('takes 1 to 4 capital letters or digits', () => {
    expect(INVOICE_PREFIX_PATTERN.test('A')).toBe(true);
    expect(INVOICE_PREFIX_PATTERN.test('AB12')).toBe(true);
    expect(INVOICE_PREFIX_PATTERN.test('ABCDE')).toBe(false);
    expect(INVOICE_PREFIX_PATTERN.test('ab')).toBe(false);
    expect(INVOICE_PREFIX_PATTERN.test('A-B')).toBe(false);
  });
});

describe('documentFor (00 #6)', () => {
  it("follows the business's GST status", () => {
    expect(documentFor('regular')).toBe('tax_invoice');
    expect(documentFor('composition')).toBe('bill_of_supply');
    expect(documentFor('unregistered')).toBe('bill');
  });
});

describe('stockQuantity', () => {
  it('is the quantity itself when sold in the stock unit', () => {
    expect(stockQuantity(1_250, null)).toBe(1_250);
  });

  it('is quantity × pack size for a pack', () => {
    // 2 bags of 25 kg = 50 kg.
    expect(stockQuantity(2_000, 25_000)).toBe(50_000);
    // Half a pack of 0.333 kg is 0.1665 kg: rounded half up to 0.167.
    expect(stockQuantity(500, 333)).toBe(167);
  });
});

describe('needsBuyerDetails (Rule 46, 02 #26)', () => {
  const check = (scheme: 'regular' | 'composition' | 'unregistered', taxablePaise: number) =>
    needsBuyerDetails({ scheme, taxablePaise, buyerGstin: null });

  it('starts at ₹50,000 of taxable value on a tax invoice', () => {
    expect(check('regular', 4_999_999)).toBe(false);
    expect(check('regular', 5_000_000)).toBe(true);
  });

  it('never asks for a registered buyer or a business without tax invoices', () => {
    expect(
      needsBuyerDetails({
        scheme: 'regular',
        taxablePaise: 9_000_000,
        buyerGstin: '27AAAAA0000A1Z5',
      }),
    ).toBe(false);
    expect(check('composition', 9_000_000)).toBe(false);
    expect(check('unregistered', 9_000_000)).toBe(false);
  });
});
